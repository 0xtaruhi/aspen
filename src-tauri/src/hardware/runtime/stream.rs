use std::{
    collections::{HashMap, VecDeque},
    hash::{Hash, Hasher},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};
use vlfd_rs::{Board, IoConfig, IoTransferWindow};

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

struct PendingStreamTransfer {
    config_generation: u64,
    target_hz: f64,
    waveform_enabled: bool,
    queue_capacity: usize,
    words_per_cycle: usize,
    frame_cycles: usize,
    frame_words: usize,
    write_buffer: Vec<u16>,
    read_buffer: Vec<u16>,
}

impl HardwareRuntime {
    fn io_config_from_stream_config(config: &HardwareDataStreamConfigV1) -> IoConfig {
        IoConfig {
            clock_high_delay: config.vericomm_clock_high_delay,
            clock_low_delay: config.vericomm_clock_low_delay,
            ..IoConfig::default()
        }
    }

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
        let decode_runtime = Arc::clone(&self);
        let decode_buffer_tx = free_buffer_tx.clone();
        let decode_handle = match thread::Builder::new()
            .name("aspen-hardware-decode".to_string())
            .spawn(move || {
                decode_runtime.run_decode_loop(
                    decode_app,
                    decode_stop_flag,
                    decode_rx,
                    decode_buffer_tx,
                );
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

        let initial_stream_config = match data_stream_config.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => {
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error =
                        Some("failed to acquire data stream config mutex".to_string());
                });
                let _ = decode_tx.send(StreamDecodeMessage::Shutdown);
                let _ = decode_handle.join();
                return;
            }
        };

        let mut board = match Board::open() {
            Ok(board) => board,
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

        let fifo_words =
            usize::from(board.config().fifo_size()).max(usize::from(DATA_DEFAULT_WORDS_PER_CYCLE));
        let io_config = Self::io_config_from_stream_config(&initial_stream_config);
        let mut io = match board.configure_io(&io_config) {
            Ok(io) => io,
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

        for _ in 0..STREAM_BUFFER_POOL_CAPACITY {
            let _ = free_buffer_tx.try_send(vec![0u16; fifo_words]);
        }
        let mut transfer_window: Option<IoTransferWindow<'_, '_>> = None;
        let mut free_write_buffers = vec![vec![0u16; fifo_words]; STREAM_USB_PIPELINE_WINDOW];

        let mut completed_cycles = 0_u64;
        let mut in_flight_cycles = 0_u64;
        let mut sequence = 0_u64;
        let mut last_transfer_finished_at = Instant::now();
        let mut signal_catalog = SignalCatalog::default();
        let mut pending_catalog_updates: Vec<HardwareDataSignalCatalogEntryV1> = Vec::new();
        let mut signal_ids_signature = 0_u64;
        let mut waveform_config_generation = self.waveform_config_generation();
        let mut input_encoder_signature = 0_u64;
        let mut output_decoder_signature = 0_u64;
        let mut rate_window_samples = VecDeque::new();
        let mut schedule_anchor = StreamScheduleAnchor {
            recorded_at: last_transfer_finished_at,
            completed_cycles: 0,
            target_hz: DATA_DEFAULT_TARGET_HZ,
        };
        let dropped_samples = 0_u64;
        let mut input_encoders: Vec<Box<dyn InputDeviceEncoder>> = Vec::new();
        let mut pending_transfers = VecDeque::with_capacity(STREAM_USB_PIPELINE_WINDOW);

        'stream: while !stop_flag.load(Ordering::Relaxed) {
            let config = match data_stream_config.lock() {
                Ok(guard) => guard.clone(),
                Err(_) => break,
            };
            let config_generation = self.waveform_config_generation();

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
            let next_signal_ids_signature = Self::signal_ids_signature(&signal_ids);
            let next_output_decoder_signature =
                Self::output_decoder_signature(&state_snapshot, &output_signal_order);
            let decode_state_changed = signal_ids_signature != next_signal_ids_signature
                || waveform_config_generation != config_generation
                || output_decoder_signature != next_output_decoder_signature;

            if decode_state_changed && pending_transfers.is_empty() {
                if decode_tx
                    .send(StreamDecodeMessage::SignalIds(
                        signal_ids.clone(),
                        config_generation,
                    ))
                    .is_err()
                {
                    let _ = self.update_data_stream_status(|status| {
                        status.running = false;
                        status.last_error = Some("decode thread disconnected".to_string());
                    });
                    break;
                }
                signal_ids_signature = next_signal_ids_signature;
                waveform_config_generation = config_generation;

                let snapshot_interval = Self::device_snapshot_interval_for_state(&state_snapshot);
                if decode_tx
                    .send(StreamDecodeMessage::DeviceSnapshotInterval(
                        snapshot_interval,
                    ))
                    .is_err()
                {
                    let _ = self.update_data_stream_status(|status| {
                        status.running = false;
                        status.last_error = Some("decode thread disconnected".to_string());
                    });
                    break;
                }
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

            let expected_cycles = Self::expected_cycles_from_anchor(&schedule_anchor, loop_now);
            let due_cycles =
                expected_cycles.saturating_sub(completed_cycles.saturating_add(in_flight_cycles));

            if due_cycles == 0 && pending_transfers.is_empty() {
                thread::sleep(DATA_IDLE_SLEEP);
                continue;
            }

            let time_since_last_transfer = last_transfer_finished_at.elapsed();
            if pending_transfers.is_empty()
                && due_cycles < effective_batch_cycles as u64
                && time_since_last_transfer < max_wait
            {
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

            let can_submit = !decode_state_changed || pending_transfers.is_empty();
            let mut unscheduled_cycles = due_cycles;
            while can_submit && unscheduled_cycles > 0 {
                let frame_cycles = if pending_transfers.is_empty() {
                    (unscheduled_cycles as usize).min(queue_capacity)
                } else if unscheduled_cycles < queue_capacity as u64 {
                    break;
                } else {
                    queue_capacity
                };
                let frame_words = frame_cycles * words_per_cycle;

                if pending_transfers.is_empty()
                    && transfer_window
                        .as_ref()
                        .map(|window| window.words() != frame_words)
                        .unwrap_or(true)
                {
                    transfer_window = None;
                    match io.transfer_window(frame_words, STREAM_USB_PIPELINE_WINDOW) {
                        Ok(window) => transfer_window = Some(window),
                        Err(err) => {
                            let _ = self.update_data_stream_status(|status| {
                                status.running = false;
                                status.last_error = Some(err.to_string());
                            });
                            break 'stream;
                        }
                    }
                }

                if transfer_window
                    .as_ref()
                    .map(|window| window.is_full())
                    .unwrap_or(false)
                {
                    break;
                }

                let mut write_buffer = free_write_buffers
                    .pop()
                    .expect("stream write buffer pool should match rolling window capacity");
                Self::fill_write_buffer(
                    &state_snapshot,
                    &input_encoders,
                    &mut write_buffer[..frame_words],
                    words_per_cycle,
                    frame_cycles,
                );
                let mut read_buffer = Self::acquire_decode_buffer(&free_buffer_rx, fifo_words);
                read_buffer[..frame_words].fill(0);
                let window = transfer_window
                    .as_mut()
                    .expect("stream window should be initialized before submit");
                if let Err(err) = window.submit(&write_buffer[..frame_words]) {
                    free_write_buffers.push(write_buffer);
                    let _ = free_buffer_tx.try_send(read_buffer);
                    let _ = self.update_data_stream_status(|status| {
                        status.running = false;
                        status.last_error = Some(err.to_string());
                    });
                    break 'stream;
                }
                pending_transfers.push_back(PendingStreamTransfer {
                    config_generation,
                    target_hz: config.target_hz,
                    waveform_enabled: config.waveform_enabled,
                    queue_capacity,
                    words_per_cycle,
                    frame_cycles,
                    frame_words,
                    write_buffer,
                    read_buffer,
                });
                in_flight_cycles = in_flight_cycles.saturating_add(frame_cycles as u64);
                unscheduled_cycles = unscheduled_cycles.saturating_sub(frame_cycles as u64);
            }

            let Some(mut pending_transfer) = pending_transfers.pop_front() else {
                continue;
            };

            let Some(window) = transfer_window.as_mut() else {
                free_write_buffers.push(pending_transfer.write_buffer);
                let _ = free_buffer_tx.try_send(pending_transfer.read_buffer);
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error =
                        Some("stream window missing for pending transfer".to_string());
                });
                break;
            };

            if let Err(err) = window
                .receive_into(&mut pending_transfer.read_buffer[..pending_transfer.frame_words])
            {
                free_write_buffers.push(pending_transfer.write_buffer);
                let _ = free_buffer_tx.try_send(pending_transfer.read_buffer);
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error = Some(err.to_string());
                });
                break;
            }

            let transfer_finished_at = Instant::now();
            last_transfer_finished_at = transfer_finished_at;
            let generated_at_ms = Self::now_millis();
            let refreshed_expected_cycles =
                Self::expected_cycles_from_anchor(&schedule_anchor, transfer_finished_at);
            in_flight_cycles =
                in_flight_cycles.saturating_sub(pending_transfer.frame_cycles as u64);
            completed_cycles =
                completed_cycles.saturating_add(pending_transfer.frame_cycles as u64);
            sequence = sequence.saturating_add(1);

            let remaining_backlog = refreshed_expected_cycles.saturating_sub(completed_cycles);
            let (actual_hz, transfer_rate_hz) = Self::windowed_stream_rates(
                &mut rate_window_samples,
                transfer_finished_at,
                completed_cycles,
                sequence,
            );

            let write_buffer = pending_transfer.write_buffer;
            let waveform_write_buffer = if pending_transfer.waveform_enabled {
                write_buffer[..pending_transfer.frame_words].to_vec()
            } else {
                Vec::new()
            };
            free_write_buffers.push(write_buffer);

            let batch_message = StreamDecodeBatch {
                config_generation: pending_transfer.config_generation,
                sequence,
                generated_at_ms,
                dropped_samples,
                target_hz: pending_transfer.target_hz,
                actual_hz,
                transfer_rate_hz,
                waveform_enabled: pending_transfer.waveform_enabled,
                queue_fill: remaining_backlog.min(u64::from(u16::MAX)) as u16,
                queue_capacity: pending_transfer.queue_capacity.min(usize::from(u16::MAX)) as u16,
                batch_cycles: pending_transfer.frame_cycles.min(usize::from(u16::MAX)) as u16,
                words_per_cycle: pending_transfer.words_per_cycle,
                batch_words: pending_transfer.frame_words,
                write_buffer: waveform_write_buffer,
                read_buffer: pending_transfer.read_buffer,
            };

            if let Err(mpsc::SendError(StreamDecodeMessage::Batch(batch_message))) =
                decode_tx.send(StreamDecodeMessage::Batch(batch_message))
            {
                let _ = free_buffer_tx.try_send(batch_message.read_buffer);
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error = Some("decode thread disconnected".to_string());
                });
                break;
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
                status.last_batch_cycles =
                    pending_transfer.frame_cycles.min(usize::from(u16::MAX)) as u16;
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

            if pending_transfers.is_empty() {
                transfer_window = None;
            }
        }

        let _ = decode_tx.send(StreamDecodeMessage::Shutdown);
        drop(decode_tx);
        drop(transfer_window);
        let _ = io.finish();
        let _ = board.close();
        let _ = decode_handle.join();
    }

    fn run_decode_loop(
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
                        && (!batch.write_buffer.is_empty() || !batch.read_buffer.is_empty())
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
                        if !snapshot.devices.is_empty() {
                            let _ = app.emit("hardware:device_snapshot", snapshot);
                        }
                        last_device_snapshot_at = Instant::now();
                        output_dirty = false;
                    }

                    let _ = free_buffer_tx.try_send(batch.read_buffer);
                }
                Ok(StreamDecodeMessage::Shutdown) => {
                    Self::emit_pending_signal_updates(
                        &app,
                        &mut last_latest_by_signal,
                        &mut pending_signal_meta,
                        &mut pending_signal_updates,
                    );
                    if output_dirty && !output_decoders.is_empty() {
                        let snapshot =
                            Self::flush_output_decoders(&mut output_decoders, Self::now_millis());
                        if !snapshot.devices.is_empty() {
                            let _ = app.emit("hardware:device_snapshot", snapshot);
                        }
                    }
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
                        if !snapshot.devices.is_empty() {
                            let _ = app.emit("hardware:device_snapshot", snapshot);
                        }
                        last_device_snapshot_at = Instant::now();
                        output_dirty = false;
                    }
                    if stop_flag.load(Ordering::Relaxed) {
                        Self::emit_pending_signal_updates(
                            &app,
                            &mut last_latest_by_signal,
                            &mut pending_signal_meta,
                            &mut pending_signal_updates,
                        );
                        if output_dirty && !output_decoders.is_empty() {
                            let snapshot = Self::flush_output_decoders(
                                &mut output_decoders,
                                Self::now_millis(),
                            );
                            if !snapshot.devices.is_empty() {
                                let _ = app.emit("hardware:device_snapshot", snapshot);
                            }
                        }
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

    pub(super) fn append_waveform_samples(
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

    pub(super) fn trim_waveform_buffers_to_tail(
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
}
