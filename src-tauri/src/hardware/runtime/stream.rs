use std::{
    collections::{HashMap, VecDeque},
    hash::{Hash, Hasher},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError, TrySendError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};
use vlfd_rs::{Device, IoSettings};

use crate::hardware::types::{
    HardwareDataSignalCatalogEntryV1, HardwareDataSignalCatalogV1, HardwareDataStreamConfigV1,
};

use super::*;

pub(super) const UNMAPPED_SIGNAL_ID: u16 = u16::MAX;

#[derive(Clone, Copy)]
struct StreamRateWindowSample {
    recorded_at: Instant,
    completed_cycles: u64,
    sequence: u64,
}

#[derive(Clone, Copy)]
struct StreamScheduleAnchor {
    recorded_at: Instant,
    completed_cycles: u64,
    target_hz: f64,
}

impl HardwareRuntime {
    pub(super) fn run_data_stream_loop(
        self: Arc<Self>,
        app: AppHandle,
        stop_flag: Arc<AtomicBool>,
        data_stream_config: Arc<Mutex<HardwareDataStreamConfigV1>>,
    ) {
        let (decode_tx, decode_rx) = mpsc::sync_channel(STREAM_DECODE_QUEUE_CAPACITY);
        let (free_buffer_tx, free_buffer_rx) = mpsc::sync_channel(STREAM_BUFFER_POOL_CAPACITY);
        let decode_stop_flag = Arc::clone(&stop_flag);
        let decode_app = app.clone();
        let decode_buffer_tx = free_buffer_tx.clone();
        let decode_handle = match thread::Builder::new()
            .name("aspen-hardware-decode".to_string())
            .spawn(move || {
                Self::run_decode_loop(decode_app, decode_stop_flag, decode_rx, decode_buffer_tx);
            }) {
            Ok(handle) => handle,
            Err(err) => {
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error = Some(err.to_string());
                });
                return;
            }
        };

        let mut device = match Device::connect() {
            Ok(device) => device,
            Err(err) => {
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error = Some(err.to_string());
                });
                let _ = decode_tx.send(StreamDecodeMessage::Shutdown);
                let _ = decode_handle.join();
                return;
            }
        };

        if let Err(err) = device.enter_io_mode(&IoSettings::default()) {
            let _ = self.update_data_stream_status(|status| {
                status.running = false;
                status.last_error = Some(err.to_string());
            });
            let _ = device.close();
            let _ = decode_tx.send(StreamDecodeMessage::Shutdown);
            let _ = decode_handle.join();
            return;
        }

        let fifo_words =
            usize::from(device.config().fifo_size()).max(usize::from(DATA_DEFAULT_WORDS_PER_CYCLE));
        for _ in 0..STREAM_BUFFER_POOL_CAPACITY {
            let _ = free_buffer_tx.try_send(vec![0u16; fifo_words]);
        }
        let mut completed_cycles = 0_u64;
        let mut sequence = 0_u64;
        let mut last_transfer_finished_at = Instant::now();
        let mut signal_catalog = SignalCatalog::default();
        let mut pending_catalog_updates: Vec<HardwareDataSignalCatalogEntryV1> = Vec::new();
        let mut signal_ids_signature = 0_u64;
        let mut input_encoder_signature = 0_u64;
        let mut output_decoder_signature = 0_u64;
        let mut rate_window_samples = VecDeque::new();
        let mut schedule_anchor = StreamScheduleAnchor {
            recorded_at: last_transfer_finished_at,
            completed_cycles: 0,
            target_hz: DATA_DEFAULT_TARGET_HZ,
        };
        let mut write_buffer = vec![0u16; fifo_words];
        let mut cycle_words = vec![0u16; fifo_words];
        let mut dropped_samples = 0_u64;
        let mut input_encoders: Vec<Box<dyn InputDeviceEncoder>> = Vec::new();

        while !stop_flag.load(Ordering::Relaxed) {
            let config = match data_stream_config.lock() {
                Ok(guard) => guard.clone(),
                Err(_) => break,
            };

            let input_signal_order =
                Self::active_signal_order(&config.input_signal_order, config.words_per_cycle);
            let output_signal_order =
                Self::active_signal_order(&config.output_signal_order, config.words_per_cycle);
            let signal_ids = output_signal_order
                .iter()
                .map(|signal| {
                    if signal.trim().is_empty() {
                        UNMAPPED_SIGNAL_ID
                    } else {
                        signal_catalog.id_for_signal(signal, &mut pending_catalog_updates)
                    }
                })
                .collect::<Vec<_>>();
            let target_hz = config.target_hz.max(DATA_DEFAULT_TARGET_HZ);
            let loop_now = Instant::now();

            if Self::target_hz_changed(schedule_anchor.target_hz, target_hz) {
                schedule_anchor = StreamScheduleAnchor {
                    recorded_at: loop_now,
                    completed_cycles,
                    target_hz,
                };
                rate_window_samples.clear();
                rate_window_samples.push_back(StreamRateWindowSample {
                    recorded_at: loop_now,
                    completed_cycles,
                    sequence,
                });
            }

            if !pending_catalog_updates.is_empty() {
                let _ = app.emit(
                    "hardware:data_catalog",
                    HardwareDataSignalCatalogV1 {
                        version: 1,
                        generated_at_ms: Self::now_millis(),
                        entries: std::mem::take(&mut pending_catalog_updates),
                    },
                );
            }

            let next_signal_ids_signature = Self::signal_ids_signature(&signal_ids);
            if signal_ids_signature != next_signal_ids_signature {
                if decode_tx
                    .send(StreamDecodeMessage::SignalIds(signal_ids.clone()))
                    .is_err()
                {
                    let _ = self.update_data_stream_status(|status| {
                        status.running = false;
                        status.last_error = Some("decode thread disconnected".to_string());
                    });
                    break;
                }
                signal_ids_signature = next_signal_ids_signature;
            }

            let words_per_cycle = usize::from(config.words_per_cycle.max(1));
            if words_per_cycle > fifo_words {
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error = Some(format!(
                        "Configured {} words per cycle exceed FIFO capacity of {} words",
                        words_per_cycle, fifo_words
                    ));
                });
                break;
            }
            let queue_capacity = (fifo_words / words_per_cycle).max(1);
            let min_batch_cycles = usize::from(config.min_batch_cycles.max(1)).min(queue_capacity);
            let max_wait = Duration::from_micros(u64::from(config.max_wait_us));
            let effective_batch_cycles =
                Self::effective_batch_cycles(target_hz, min_batch_cycles, queue_capacity, max_wait);
            let expected_cycles = Self::expected_cycles_from_anchor(&schedule_anchor, loop_now);
            let due_cycles = expected_cycles.saturating_sub(completed_cycles);

            if due_cycles == 0 {
                thread::sleep(DATA_IDLE_SLEEP);
                continue;
            }

            let time_since_last_transfer = last_transfer_finished_at.elapsed();
            if due_cycles < effective_batch_cycles as u64 && time_since_last_transfer < max_wait {
                let sleep_for = Self::sleep_for_batch(
                    target_hz,
                    due_cycles,
                    effective_batch_cycles,
                    time_since_last_transfer,
                    max_wait,
                );
                if !sleep_for.is_zero() {
                    thread::sleep(sleep_for);
                }
                continue;
            }

            let batch_cycles = due_cycles.min(queue_capacity as u64).max(1) as usize;
            let batch_words = batch_cycles * words_per_cycle;
            let state_snapshot = match self.snapshot() {
                Ok(snapshot) => snapshot,
                Err(_) => break,
            };
            let next_input_encoder_signature =
                Self::input_encoder_signature(&state_snapshot, &input_signal_order);
            if input_encoder_signature != next_input_encoder_signature {
                input_encoders = Self::compile_input_encoders(&state_snapshot, &input_signal_order);
                input_encoder_signature = next_input_encoder_signature;
            }
            let next_output_decoder_signature =
                Self::output_decoder_signature(&state_snapshot, &output_signal_order);
            if output_decoder_signature != next_output_decoder_signature {
                let output_decoders =
                    Self::compile_output_decoders(&state_snapshot, &output_signal_order);
                if decode_tx
                    .send(StreamDecodeMessage::OutputDecoders(output_decoders))
                    .is_err()
                {
                    let _ = self.update_data_stream_status(|status| {
                        status.running = false;
                        status.last_error = Some("decode thread disconnected".to_string());
                    });
                    break;
                }
                output_decoder_signature = next_output_decoder_signature;
            }
            Self::fill_write_frame(
                &state_snapshot,
                &input_encoders,
                &mut cycle_words[..words_per_cycle],
            );
            Self::repeat_frame_into_buffer(
                &cycle_words[..words_per_cycle],
                &mut write_buffer[..batch_words],
            );
            let mut read_buffer = Self::acquire_decode_buffer(&free_buffer_rx, fifo_words);
            read_buffer[..batch_words].fill(0);

            if let Err(err) = device.transfer_io(
                &mut write_buffer[..batch_words],
                &mut read_buffer[..batch_words],
            ) {
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error = Some(err.to_string());
                });
                break;
            }

            completed_cycles = completed_cycles.saturating_add(batch_cycles as u64);
            sequence = sequence.saturating_add(1);
            let transfer_finished_at = Instant::now();
            last_transfer_finished_at = transfer_finished_at;
            let generated_at_ms = Self::now_millis();
            let refreshed_expected_cycles =
                Self::expected_cycles_from_anchor(&schedule_anchor, transfer_finished_at);
            let remaining_backlog = refreshed_expected_cycles.saturating_sub(completed_cycles);
            let (actual_hz, transfer_rate_hz) = Self::windowed_stream_rates(
                &mut rate_window_samples,
                transfer_finished_at,
                completed_cycles,
                sequence,
            );
            let batch_message = StreamDecodeBatch {
                sequence,
                generated_at_ms,
                dropped_samples,
                queue_fill: remaining_backlog.min(u64::from(u16::MAX)) as u16,
                queue_capacity: queue_capacity.min(usize::from(u16::MAX)) as u16,
                batch_cycles: batch_cycles.min(usize::from(u16::MAX)) as u16,
                words_per_cycle,
                batch_words,
                read_buffer,
            };
            match decode_tx.try_send(StreamDecodeMessage::Batch(batch_message)) {
                Ok(()) => {}
                Err(TrySendError::Full(StreamDecodeMessage::Batch(batch_message))) => {
                    dropped_samples =
                        dropped_samples.saturating_add(u64::from(batch_message.batch_cycles));
                    let _ = free_buffer_tx.try_send(batch_message.read_buffer);
                }
                Err(TrySendError::Disconnected(StreamDecodeMessage::Batch(batch_message))) => {
                    let _ = free_buffer_tx.try_send(batch_message.read_buffer);
                    let _ = self.update_data_stream_status(|status| {
                        status.running = false;
                        status.last_error = Some("decode thread disconnected".to_string());
                    });
                    break;
                }
                Err(_) => {}
            }

            let _ = self.update_data_stream_status(|status| {
                status.running = true;
                status.target_hz = config.target_hz;
                status.actual_hz = actual_hz;
                status.transfer_rate_hz = transfer_rate_hz;
                status.sequence = sequence;
                status.dropped_samples = dropped_samples;
                status.queue_fill = remaining_backlog.min(u64::from(u16::MAX)) as u16;
                status.queue_capacity = queue_capacity.min(usize::from(u16::MAX)) as u16;
                status.last_batch_at_ms = generated_at_ms;
                status.last_batch_cycles = batch_cycles.min(usize::from(u16::MAX)) as u16;
                status.words_per_cycle = config.words_per_cycle;
                status.min_batch_cycles = config.min_batch_cycles;
                status.max_wait_us = config.max_wait_us;
                status.configured_signal_count = input_signal_order
                    .iter()
                    .chain(output_signal_order.iter())
                    .filter(|signal| !signal.trim().is_empty())
                    .count()
                    .min(u16::MAX as usize) as u16;
                status.last_error = None;
            });
        }

        let _ = decode_tx.send(StreamDecodeMessage::Shutdown);
        drop(decode_tx);
        let _ = device.exit_io_mode();
        let _ = device.close();
        let _ = decode_handle.join();
    }

    fn run_decode_loop(
        app: AppHandle,
        stop_flag: Arc<AtomicBool>,
        decode_rx: Receiver<StreamDecodeMessage>,
        free_buffer_tx: SyncSender<Vec<u16>>,
    ) {
        let mut signal_ids = Vec::new();
        let mut last_latest_by_signal: HashMap<u16, bool> = HashMap::new();
        let mut output_decoders: Vec<Box<dyn OutputDeviceDecoder>> = Vec::new();
        let mut last_device_snapshot_at = Instant::now();
        let mut output_dirty = false;

        loop {
            match decode_rx.recv_timeout(DEVICE_SNAPSHOT_INTERVAL) {
                Ok(StreamDecodeMessage::SignalIds(next_signal_ids)) => {
                    signal_ids = next_signal_ids;
                    last_latest_by_signal.clear();
                }
                Ok(StreamDecodeMessage::OutputDecoders(next_decoders)) => {
                    output_decoders = next_decoders;
                    output_dirty = false;
                }
                Ok(StreamDecodeMessage::Batch(batch)) => {
                    let updates = Self::filter_changed_updates(
                        Self::aggregate_read_buffer(
                            &batch.read_buffer[..batch.batch_words],
                            &signal_ids,
                            batch.words_per_cycle,
                        ),
                        &mut last_latest_by_signal,
                    );
                    if !output_decoders.is_empty() {
                        Self::ingest_output_batch(
                            &batch.read_buffer[..batch.batch_words],
                            batch.words_per_cycle,
                            &mut output_decoders,
                        );
                        output_dirty = true;
                    }

                    let payload = Self::encode_binary_batch(
                        batch.sequence,
                        batch.generated_at_ms,
                        batch.dropped_samples,
                        batch.queue_fill,
                        batch.queue_capacity,
                        batch.batch_cycles,
                        &updates,
                    );
                    let _ = app.emit(
                        "hardware:data_batch_bin",
                        crate::hardware::types::HardwareDataBatchBinaryV1 {
                            version: 1,
                            payload,
                        },
                    );

                    if output_dirty && last_device_snapshot_at.elapsed() >= DEVICE_SNAPSHOT_INTERVAL
                    {
                        let snapshot = Self::flush_output_decoders(
                            &mut output_decoders,
                            batch.generated_at_ms,
                        );
                        if !snapshot.devices.is_empty() {
                            let _ = app.emit("hardware:device_snapshot", snapshot);
                        }
                        last_device_snapshot_at = Instant::now();
                        output_dirty = false;
                    }

                    let _ = free_buffer_tx.try_send(batch.read_buffer);
                }
                Ok(StreamDecodeMessage::Shutdown) => break,
                Err(RecvTimeoutError::Timeout) => {
                    if output_dirty
                        && !output_decoders.is_empty()
                        && last_device_snapshot_at.elapsed() >= DEVICE_SNAPSHOT_INTERVAL
                    {
                        let snapshot =
                            Self::flush_output_decoders(&mut output_decoders, Self::now_millis());
                        if !snapshot.devices.is_empty() {
                            let _ = app.emit("hardware:device_snapshot", snapshot);
                        }
                        last_device_snapshot_at = Instant::now();
                        output_dirty = false;
                    }
                    if stop_flag.load(Ordering::Relaxed) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    fn acquire_decode_buffer(free_buffer_rx: &Receiver<Vec<u16>>, fifo_words: usize) -> Vec<u16> {
        let mut buffer = match free_buffer_rx.try_recv() {
            Ok(buffer) => buffer,
            Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => vec![0u16; fifo_words],
        };

        if buffer.len() < fifo_words {
            buffer.resize(fifo_words, 0);
        }

        buffer
    }

    pub(super) fn validate_stream_config(
        config: &HardwareDataStreamConfigV1,
    ) -> Result<(), String> {
        Self::validate_target_hz(config.target_hz)?;

        if config.words_per_cycle == 0 {
            return Err("Words per cycle must be greater than zero".to_string());
        }

        if config.min_batch_cycles == 0 {
            return Err("Minimum batch cycles must be greater than zero".to_string());
        }

        let max_signal_count = usize::from(config.words_per_cycle) * 16;
        if config.input_signal_order.len() > max_signal_count {
            return Err(format!(
                "Configured {} input signals exceed packet capacity of {} bits",
                config.input_signal_order.len(),
                max_signal_count
            ));
        }

        if config.output_signal_order.len() > max_signal_count {
            return Err(format!(
                "Configured {} output signals exceed packet capacity of {} bits",
                config.output_signal_order.len(),
                max_signal_count
            ));
        }

        Ok(())
    }

    fn sleep_for_batch(
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

    pub(super) fn effective_batch_cycles(
        target_hz: f64,
        min_batch_cycles: usize,
        queue_capacity: usize,
        max_wait: Duration,
    ) -> usize {
        let ideal_batch_cycles =
            (target_hz.max(DATA_DEFAULT_TARGET_HZ) * max_wait.as_secs_f64()).ceil() as usize;
        ideal_batch_cycles.clamp(min_batch_cycles, queue_capacity)
    }

    fn expected_cycles_from_anchor(anchor: &StreamScheduleAnchor, recorded_at: Instant) -> u64 {
        Self::expected_cycles_for_elapsed(
            anchor.completed_cycles,
            recorded_at.saturating_duration_since(anchor.recorded_at),
            anchor.target_hz,
        )
    }

    pub(super) fn expected_cycles_for_elapsed(
        anchor_completed_cycles: u64,
        elapsed: Duration,
        target_hz: f64,
    ) -> u64 {
        let elapsed_cycles =
            (elapsed.as_secs_f64() * target_hz.max(DATA_DEFAULT_TARGET_HZ)).floor() as u64;

        anchor_completed_cycles.saturating_add(elapsed_cycles)
    }

    fn target_hz_changed(previous_hz: f64, next_hz: f64) -> bool {
        (previous_hz - next_hz).abs() > f64::EPSILON
    }

    fn signal_ids_signature(signal_ids: &[u16]) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        signal_ids.hash(&mut hasher);
        hasher.finish()
    }

    pub(super) fn validate_target_hz(rate_hz: f64) -> Result<(), String> {
        if !rate_hz.is_finite() || rate_hz <= 0.0 {
            return Err("Target frequency must be a finite value greater than zero".to_string());
        }

        Ok(())
    }

    fn active_signal_order(signal_order: &[String], words_per_cycle: u16) -> Vec<String> {
        let max_signal_count = usize::from(words_per_cycle.max(1)) * 16;
        signal_order
            .iter()
            .take(max_signal_count)
            .map(|signal| signal.trim().to_string())
            .collect()
    }

    fn windowed_stream_rates(
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

            let _ = rate_window_samples.pop_front();
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

    fn repeat_frame_into_buffer(frame_words: &[u16], buffer: &mut [u16]) {
        let words_per_cycle = frame_words.len();
        if words_per_cycle == 0 {
            return;
        }

        for chunk in buffer.chunks_exact_mut(words_per_cycle) {
            chunk.copy_from_slice(frame_words);
        }
    }
}
