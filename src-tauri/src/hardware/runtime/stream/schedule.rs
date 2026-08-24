use super::*;

#[derive(Clone, Copy)]
pub(super) struct StreamRateWindowSample {
    pub(super) recorded_at: Instant,
    pub(super) completed_cycles: u64,
    pub(super) sequence: u64,
}

#[derive(Clone, Copy)]
pub(super) struct StreamScheduleAnchor {
    pub(super) recorded_at: Instant,
    pub(super) completed_cycles: u64,
    pub(super) target_hz: f64,
}

impl HardwareRuntime {
    pub(super) fn sleep_for_batch(
        target_hz: f64,
        due_cycles: u64,
        target_batch_cycles: usize,
        time_since_last_transfer: Duration,
        max_wait: Duration,
    ) -> Duration {
        let wait_for_batch = if due_cycles >= target_batch_cycles as u64 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(
                (target_batch_cycles as u64 - due_cycles) as f64
                    / target_hz.max(DATA_DEFAULT_TARGET_HZ),
            )
        };
        DATA_IDLE_SLEEP
            .min(wait_for_batch)
            .min(max_wait.saturating_sub(time_since_last_transfer))
    }

    pub(in crate::hardware::runtime) fn effective_batch_cycles(
        target_hz: f64,
        min_batch_cycles: usize,
        queue_capacity: usize,
        max_wait: Duration,
    ) -> usize {
        let ideal_batch_cycles =
            (target_hz.max(DATA_DEFAULT_TARGET_HZ) * max_wait.as_secs_f64()).ceil() as usize;
        ideal_batch_cycles.clamp(min_batch_cycles, queue_capacity)
    }

    pub(super) fn expected_cycles_from_anchor(
        anchor: &StreamScheduleAnchor,
        recorded_at: Instant,
    ) -> u64 {
        Self::expected_cycles_for_elapsed(
            anchor.completed_cycles,
            recorded_at.saturating_duration_since(anchor.recorded_at),
            anchor.target_hz,
        )
    }

    pub(in crate::hardware::runtime) fn expected_cycles_for_elapsed(
        anchor_completed_cycles: u64,
        elapsed: Duration,
        target_hz: f64,
    ) -> u64 {
        let elapsed_cycles =
            (elapsed.as_secs_f64() * target_hz.max(DATA_DEFAULT_TARGET_HZ)).floor() as u64;

        anchor_completed_cycles.saturating_add(elapsed_cycles)
    }

    pub(super) fn target_hz_changed(previous_hz: f64, next_hz: f64) -> bool {
        (previous_hz - next_hz).abs() > f64::EPSILON
    }

    pub(super) fn signal_ids_signature(signal_ids: &[u16]) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        signal_ids.hash(&mut hasher);
        hasher.finish()
    }

    pub(super) fn active_signal_order(
        signal_order: &[String],
        words_per_cycle: u16,
    ) -> Vec<String> {
        let max_signal_count = usize::from(words_per_cycle.max(1)) * 16;
        signal_order
            .iter()
            .take(max_signal_count)
            .map(|signal| signal.trim().to_string())
            .collect()
    }

    pub(super) fn windowed_stream_rates(
        rate_window_samples: &mut VecDeque<StreamRateWindowSample>,
        recorded_at: Instant,
        completed_cycles: u64,
        sequence: u64,
    ) -> (f64, f64) {
        rate_window_samples.push_back(StreamRateWindowSample {
            recorded_at,
            completed_cycles,
            sequence,
        });

        while rate_window_samples.len() > 1 {
            let Some(next_sample) = rate_window_samples.get(1) else {
                break;
            };

            if recorded_at.saturating_duration_since(next_sample.recorded_at) < DATA_RATE_WINDOW {
                break;
            }

            rate_window_samples.pop_front();
        }

        let Some(baseline_sample) = rate_window_samples.front() else {
            return (0.0, 0.0);
        };

        let elapsed_seconds = recorded_at
            .saturating_duration_since(baseline_sample.recorded_at)
            .as_secs_f64();
        if elapsed_seconds <= f64::EPSILON {
            return (0.0, 0.0);
        }

        let cycle_delta = completed_cycles.saturating_sub(baseline_sample.completed_cycles);
        let transfer_delta = sequence.saturating_sub(baseline_sample.sequence);

        (
            cycle_delta as f64 / elapsed_seconds,
            transfer_delta as f64 / elapsed_seconds,
        )
    }
}
