use crate::hardware::types::HardwareCanvasDeviceTelemetry;

use super::*;

impl HardwareRuntime {
    pub(super) fn run_decode_loop(
        self: Arc<Self>,
        app: AppHandle,
        stop_flag: Arc<AtomicBool>,
        decode_rx: Receiver<StreamDecodeMessage>,
        free_buffer_tx: SyncSender<Vec<u16>>,
    ) {
        let mut signal_ids = Vec::new();
        let mut last_latest_by_signal: HashMap<u16, bool> = HashMap::new();
        let mut pending_signal_updates: HashMap<u16, HardwareDataAggregate> = HashMap::new();
        let mut pending_signal_meta = PendingSignalBatchMeta::default();
        let mut last_signal_publish_at = Instant::now();
        let mut waveform_generation = self.waveform_config_generation();
        let mut pending_waveform = PendingWaveformBatch::default();
        let mut output_decoders: Vec<Box<dyn OutputDeviceDecoder>> = Vec::new();
        let mut device_snapshot_interval = DEVICE_SNAPSHOT_INTERVAL;
        let mut last_device_snapshot_at = Instant::now();
        let mut output_dirty = false;

        loop {
            match decode_rx.recv_timeout(DEVICE_SNAPSHOT_INTERVAL) {
                Ok(StreamDecodeMessage::SignalIds(next_signal_ids, next_generation)) => {
                    signal_ids = next_signal_ids;
                    waveform_generation = next_generation;
                    last_latest_by_signal.clear();
                    pending_signal_updates.clear();
                    pending_signal_meta = PendingSignalBatchMeta::default();
                    pending_waveform = PendingWaveformBatch::default();
                    last_signal_publish_at = Instant::now();
                    let _ = self.clear_waveform_snapshot();
                }
                Ok(StreamDecodeMessage::DeviceSnapshotInterval(next_interval)) => {
                    device_snapshot_interval = next_interval;
                }
                Ok(StreamDecodeMessage::OutputDecoders(next_decoders)) => {
                    output_decoders = next_decoders;
                    output_dirty = false;
                }
                Ok(StreamDecodeMessage::Batch(batch)) => {
                    for (signal_id, aggregate) in Self::aggregate_read_buffer_windows(
                        &batch.read_buffer[..batch.batch_words],
                        &signal_ids,
                        batch.words_per_cycle,
                    ) {
                        pending_signal_updates
                            .entry(signal_id)
                            .or_insert_with(HardwareDataAggregate::new)
                            .merge(&aggregate);
                    }
                    pending_signal_meta.sequence = batch.sequence;
                    pending_signal_meta.generated_at_ms = batch.generated_at_ms;
                    pending_signal_meta.dropped_samples = batch.dropped_samples;
                    pending_signal_meta.actual_hz = batch.actual_hz;
                    pending_signal_meta.transfer_rate_hz = batch.transfer_rate_hz;
                    pending_signal_meta.queue_fill = batch.queue_fill;
                    pending_signal_meta.queue_capacity = batch.queue_capacity;
                    pending_signal_meta.batch_cycles = pending_signal_meta
                        .batch_cycles
                        .saturating_add(u32::from(batch.batch_cycles));

                    if !output_decoders.is_empty() {
                        Self::ingest_output_batch(
                            &batch.read_buffer[..batch.batch_words],
                            batch.words_per_cycle,
                            &mut output_decoders,
                        );
                        Self::finish_output_batch(
                            &mut output_decoders,
                            batch.generated_at_ms,
                            if batch.actual_hz > 0.0 {
                                batch.actual_hz
                            } else {
                                batch.target_hz
                            },
                        );
                        output_dirty = true;
                    }

                    if batch.config_generation != waveform_generation {
                        waveform_generation = batch.config_generation;
                        pending_waveform = PendingWaveformBatch::default();
                    }

                    if batch.config_generation != self.waveform_config_generation() {
                        let _ = self.clear_waveform_snapshot();
                    } else if batch.waveform_enabled
                        && batch.batch_words > 0
                        && batch.write_buffer.len() >= batch.batch_words
                        && batch.read_buffer.len() >= batch.batch_words
                    {
                        let waveform_rate_hz = if batch.actual_hz > 0.0 {
                            batch.actual_hz
                        } else {
                            batch.target_hz
                        };

                        if pending_waveform.words_per_cycle > 0
                            && pending_waveform.words_per_cycle != batch.words_per_cycle
                        {
                            pending_waveform = PendingWaveformBatch::default();
                            let _ = self.clear_waveform_snapshot();
                        }

                        let sampled_cycles = Self::append_waveform_samples(
                            &mut pending_waveform.write_buffer,
                            &mut pending_waveform.read_buffer,
                            &batch.write_buffer[..batch.batch_words],
                            &batch.read_buffer[..batch.batch_words],
                            batch.words_per_cycle,
                        );

                        if sampled_cycles > 0 {
                            pending_waveform.sequence = batch.sequence;
                            pending_waveform.generated_at_ms = batch.generated_at_ms;
                            pending_waveform.actual_hz = waveform_rate_hz;
                            pending_waveform.words_per_cycle = batch.words_per_cycle;
                            Self::trim_waveform_buffers_to_tail(
                                &mut pending_waveform.write_buffer,
                                &mut pending_waveform.read_buffer,
                                batch.words_per_cycle,
                                WAVEFORM_MAX_EXACT_BATCH_CYCLES,
                            );
                            pending_waveform.batch_cycles = (pending_waveform.write_buffer.len()
                                / batch.words_per_cycle)
                                .min(usize::from(u16::MAX))
                                as u32;
                            let _ = self.publish_waveform_snapshot(&pending_waveform);
                        }
                    } else if !pending_waveform.write_buffer.is_empty()
                        || !pending_waveform.read_buffer.is_empty()
                    {
                        pending_waveform = PendingWaveformBatch::default();
                        let _ = self.clear_waveform_snapshot();
                    }

                    if last_signal_publish_at.elapsed() >= SIGNAL_TELEMETRY_INTERVAL {
                        Self::emit_pending_signal_updates(
                            &app,
                            &mut last_latest_by_signal,
                            &mut pending_signal_meta,
                            &mut pending_signal_updates,
                        );
                        last_signal_publish_at = Instant::now();
                    }

                    if output_dirty && last_device_snapshot_at.elapsed() >= device_snapshot_interval
                    {
                        let snapshot = Self::flush_output_decoders(
                            &mut output_decoders,
                            batch.generated_at_ms,
                        );
                        Self::emit_device_snapshot(&app, snapshot);
                        last_device_snapshot_at = Instant::now();
                        output_dirty = false;
                    }

                    let _ = free_buffer_tx.try_send(batch.read_buffer);
                }
                Ok(StreamDecodeMessage::Shutdown) => {
                    Self::finalize_decode_output(
                        &app,
                        &mut last_latest_by_signal,
                        &mut pending_signal_meta,
                        &mut pending_signal_updates,
                        &mut output_decoders,
                        output_dirty,
                    );
                    break;
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !pending_signal_updates.is_empty()
                        && last_signal_publish_at.elapsed() >= SIGNAL_TELEMETRY_INTERVAL
                    {
                        Self::emit_pending_signal_updates(
                            &app,
                            &mut last_latest_by_signal,
                            &mut pending_signal_meta,
                            &mut pending_signal_updates,
                        );
                        last_signal_publish_at = Instant::now();
                    }

                    if output_dirty
                        && !output_decoders.is_empty()
                        && last_device_snapshot_at.elapsed() >= device_snapshot_interval
                    {
                        let snapshot =
                            Self::flush_output_decoders(&mut output_decoders, Self::now_millis());
                        Self::emit_device_snapshot(&app, snapshot);
                        last_device_snapshot_at = Instant::now();
                        output_dirty = false;
                    }
                    if stop_flag.load(Ordering::Relaxed) {
                        Self::finalize_decode_output(
                            &app,
                            &mut last_latest_by_signal,
                            &mut pending_signal_meta,
                            &mut pending_signal_updates,
                            &mut output_decoders,
                            output_dirty,
                        );
                        break;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    fn emit_device_snapshot(app: &AppHandle, snapshot: HardwareCanvasDeviceTelemetry) {
        if !snapshot.devices.is_empty() {
            let _ = app.emit("hardware:device_snapshot", snapshot);
        }
    }

    fn finalize_decode_output(
        app: &AppHandle,
        last_latest_by_signal: &mut HashMap<u16, bool>,
        pending_signal_meta: &mut PendingSignalBatchMeta,
        pending_signal_updates: &mut HashMap<u16, HardwareDataAggregate>,
        output_decoders: &mut [Box<dyn OutputDeviceDecoder>],
        output_dirty: bool,
    ) {
        Self::emit_pending_signal_updates(
            app,
            last_latest_by_signal,
            pending_signal_meta,
            pending_signal_updates,
        );
        if output_dirty && !output_decoders.is_empty() {
            let snapshot = Self::flush_output_decoders(output_decoders, Self::now_millis());
            Self::emit_device_snapshot(app, snapshot);
        }
    }

    pub(super) fn acquire_decode_buffer(
        free_buffer_rx: &Receiver<Vec<u16>>,
        fifo_words: usize,
    ) -> Vec<u16> {
        let mut buffer = match free_buffer_rx.try_recv() {
            Ok(buffer) => buffer,
            Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => vec![0u16; fifo_words],
        };

        if buffer.len() < fifo_words {
            buffer.resize(fifo_words, 0);
        }

        buffer
    }

    pub(in crate::hardware::runtime) fn append_waveform_samples(
        pending_write_buffer: &mut Vec<u16>,
        pending_read_buffer: &mut Vec<u16>,
        write_buffer: &[u16],
        read_buffer: &[u16],
        words_per_cycle: usize,
    ) -> usize {
        if words_per_cycle == 0 {
            return 0;
        }

        let mut sampled_cycles = 0usize;
        for (write_cycle, read_cycle) in write_buffer
            .chunks_exact(words_per_cycle)
            .zip(read_buffer.chunks_exact(words_per_cycle))
        {
            pending_write_buffer.extend_from_slice(write_cycle);
            pending_read_buffer.extend_from_slice(read_cycle);
            sampled_cycles = sampled_cycles.saturating_add(1);
        }

        sampled_cycles
    }

    pub(in crate::hardware::runtime) fn trim_waveform_buffers_to_tail(
        pending_write_buffer: &mut Vec<u16>,
        pending_read_buffer: &mut Vec<u16>,
        words_per_cycle: usize,
        max_cycles: usize,
    ) -> bool {
        if words_per_cycle == 0 || max_cycles == 0 {
            return false;
        }

        let max_words = words_per_cycle.saturating_mul(max_cycles);
        if pending_write_buffer.len() <= max_words || pending_read_buffer.len() <= max_words {
            return false;
        }

        let drop_words = pending_write_buffer.len().saturating_sub(max_words);
        *pending_write_buffer = pending_write_buffer.split_off(drop_words);
        *pending_read_buffer = pending_read_buffer.split_off(drop_words);
        true
    }

    fn publish_waveform_snapshot(
        &self,
        pending_waveform: &PendingWaveformBatch,
    ) -> Result<(), String> {
        if pending_waveform.write_buffer.is_empty()
            || pending_waveform.read_buffer.is_empty()
            || pending_waveform.words_per_cycle == 0
            || pending_waveform.batch_cycles == 0
        {
            return self.clear_waveform_snapshot();
        }

        let payload = Self::encode_binary_waveform_batch(
            pending_waveform.sequence,
            pending_waveform.generated_at_ms,
            pending_waveform.actual_hz,
            pending_waveform.words_per_cycle.min(usize::from(u16::MAX)) as u16,
            pending_waveform.batch_cycles.min(u32::from(u16::MAX)) as u16,
            WAVEFORM_BATCH_FLAG_REPLACE_EXISTING,
            &pending_waveform.write_buffer,
            &pending_waveform.read_buffer,
        );
        if payload.is_empty() {
            return self.clear_waveform_snapshot();
        }

        self.set_latest_waveform_batch(
            pending_waveform.sequence,
            crate::hardware::types::HardwareWaveformBatchBinaryV1 {
                version: 1,
                payload,
            },
        )
    }
}
