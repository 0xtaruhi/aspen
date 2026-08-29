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
use vlfd_rs::{Board, IoConfig, IoTransferWindow, Licence};

use crate::hardware::types::{
    HardwareAccessConfigV1, HardwareDataSignalCatalogEntryV1, HardwareDataSignalCatalogV1,
    HardwareDataStreamConfigV1,
};

use super::*;

mod decode;
mod lifecycle;
mod schedule;

use lifecycle::DecodeWorker;
use schedule::{StreamRateWindowSample, StreamScheduleAnchor};

pub(super) const UNMAPPED_SIGNAL_ID: u16 = u16::MAX;
const VLFD_CUSTOMER_ID: u16 = 0xf805;

struct PendingStreamTransfer {
    config_generation: u64,
    target_hz: f64,
    waveform_enabled: bool,
    queue_capacity: usize,
    words_per_cycle: usize,
    min_batch_cycles: u16,
    max_wait_us: u32,
    frame_cycles: usize,
    frame_words: usize,
    write_buffer: Vec<u16>,
    read_buffer: Vec<u16>,
}

impl HardwareRuntime {
    pub(super) fn io_config_from_stream_config(config: &HardwareDataStreamConfigV1) -> IoConfig {
        IoConfig {
            clock_high_delay: config.vericomm_clock_high_delay,
            clock_low_delay: config.vericomm_clock_low_delay,
            ..IoConfig::new(Licence::CustomerId(VLFD_CUSTOMER_ID))
        }
    }

    pub(super) fn run_data_stream_loop(
        self: Arc<Self>,
        app: AppHandle,
        stop_flag: Arc<AtomicBool>,
        data_stream_config: Arc<Mutex<HardwareDataStreamConfigV1>>,
        access: HardwareAccessConfigV1,
    ) {
        let (free_buffer_tx, free_buffer_rx) = mpsc::sync_channel(STREAM_BUFFER_POOL_CAPACITY);
        let decode_worker = match DecodeWorker::spawn(
            Arc::clone(&self),
            app.clone(),
            Arc::clone(&stop_flag),
            free_buffer_tx.clone(),
        ) {
            Ok(worker) => worker,
            Err(err) => {
                self.record_data_stream_error(err);
                return;
            }
        };

        let initial_stream_config = match data_stream_config.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => {
                self.record_data_stream_error("failed to acquire data stream config mutex");
                if let Err(err) = decode_worker.shutdown() {
                    self.record_data_stream_error(err);
                }
                return;
            }
        };

        let selector = match driver::board_selector(&access.selector) {
            Ok(selector) => selector,
            Err(err) => {
                self.record_data_stream_error(err);
                if let Err(err) = decode_worker.shutdown() {
                    self.record_data_stream_error(err);
                }
                return;
            }
        };
        let mut board = match Board::open_selected(&selector) {
            Ok(board) => board,
            Err(err) => {
                self.record_data_stream_error(err.to_string());
                if let Err(err) = decode_worker.shutdown() {
                    self.record_data_stream_error(err);
                }
                return;
            }
        };

        let fifo_words =
            usize::from(board.config().fifo_size()).max(usize::from(DATA_DEFAULT_WORDS_PER_CYCLE));
        let io_config = Self::io_config_from_stream_config(&initial_stream_config);
        let mut io = match board.configure_io(&io_config) {
            Ok(io) => io,
            Err(err) => {
                self.record_data_stream_error(err.to_string());
                if let Err(err) = decode_worker.shutdown() {
                    self.record_data_stream_error(err);
                }
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
                Err(_) => {
                    self.record_data_stream_error("failed to acquire data stream config mutex");
                    break;
                }
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
            let target_hz = config.target_hz.max(DATA_MIN_TARGET_HZ);
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
                self.record_data_stream_error(format!(
                    "Configured {words_per_cycle} words per cycle exceed FIFO capacity of {fifo_words} words"
                ));
                break;
            }
            let queue_capacity = (fifo_words / words_per_cycle).max(1);
            let min_batch_cycles = usize::from(config.min_batch_cycles.max(1)).min(queue_capacity);
            let max_wait = Duration::from_micros(u64::from(config.max_wait_us));
            let effective_batch_cycles =
                Self::effective_batch_cycles(target_hz, min_batch_cycles, queue_capacity, max_wait);
            let state_snapshot = match self.snapshot() {
                Ok(snapshot) => snapshot,
                Err(err) => {
                    self.record_data_stream_error(err);
                    break;
                }
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
                if decode_worker
                    .send(StreamDecodeMessage::SignalIds(
                        signal_ids.clone(),
                        config_generation,
                    ))
                    .is_err()
                {
                    self.record_data_stream_error("decode thread disconnected");
                    break;
                }
                signal_ids_signature = next_signal_ids_signature;
                waveform_config_generation = config_generation;

                let snapshot_interval = Self::device_snapshot_interval_for_state(&state_snapshot);
                if decode_worker
                    .send(StreamDecodeMessage::DeviceSnapshotInterval(
                        snapshot_interval,
                    ))
                    .is_err()
                {
                    self.record_data_stream_error("decode thread disconnected");
                    break;
                }
                let output_decoders =
                    Self::compile_output_decoders(&state_snapshot, &output_signal_order);
                if decode_worker
                    .send(StreamDecodeMessage::OutputDecoders(output_decoders))
                    .is_err()
                {
                    self.record_data_stream_error("decode thread disconnected");
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
            while can_submit && unscheduled_cycles > 0 && !stop_flag.load(Ordering::Relaxed) {
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
                            self.record_data_stream_error(err.to_string());
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

                let Some(mut write_buffer) = free_write_buffers.pop() else {
                    break;
                };
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
                    self.record_data_stream_error(err.to_string());
                    break 'stream;
                }
                pending_transfers.push_back(PendingStreamTransfer {
                    config_generation,
                    target_hz: config.target_hz,
                    waveform_enabled: config.waveform_enabled,
                    queue_capacity,
                    words_per_cycle,
                    min_batch_cycles: config.min_batch_cycles,
                    max_wait_us: config.max_wait_us,
                    frame_cycles,
                    frame_words,
                    write_buffer,
                    read_buffer,
                });
                in_flight_cycles = in_flight_cycles.saturating_add(frame_cycles as u64);
                unscheduled_cycles = unscheduled_cycles.saturating_sub(frame_cycles as u64);
            }

            if stop_flag.load(Ordering::Relaxed) {
                break;
            }

            let Some(mut pending_transfer) = pending_transfers.pop_front() else {
                continue;
            };

            // Honor stop requests before starting another blocking USB receive.
            // Any in-flight transfers will be cancelled when the rolling window
            // is dropped during stream shutdown.
            if stop_flag.load(Ordering::Relaxed) {
                pending_transfers.push_front(pending_transfer);
                break;
            }

            let Some(window) = transfer_window.as_mut() else {
                free_write_buffers.push(pending_transfer.write_buffer);
                let _ = free_buffer_tx.try_send(pending_transfer.read_buffer);
                self.record_data_stream_error("stream window missing for pending transfer");
                break;
            };

            if let Err(err) = window
                .receive_into(&mut pending_transfer.read_buffer[..pending_transfer.frame_words])
            {
                free_write_buffers.push(pending_transfer.write_buffer);
                let _ = free_buffer_tx.try_send(pending_transfer.read_buffer);
                self.record_data_stream_error(err.to_string());
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

            let delivered_or_in_flight_cycles = completed_cycles.saturating_add(in_flight_cycles);
            let remaining_backlog =
                refreshed_expected_cycles.saturating_sub(delivered_or_in_flight_cycles);
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

            if decode_worker
                .send(StreamDecodeMessage::Batch(batch_message))
                .is_err()
            {
                self.record_data_stream_error("decode thread disconnected");
                break;
            }

            if let Err(err) = self.update_data_stream_status(|status| {
                status.running = true;
                status.target_hz = pending_transfer.target_hz;
                status.actual_hz = actual_hz;
                status.transfer_rate_hz = transfer_rate_hz;
                status.sequence = sequence;
                status.dropped_samples = dropped_samples;
                status.queue_fill = remaining_backlog.min(u64::from(u16::MAX)) as u16;
                status.queue_capacity =
                    pending_transfer.queue_capacity.min(usize::from(u16::MAX)) as u16;
                status.last_batch_at_ms = generated_at_ms;
                status.last_batch_cycles =
                    pending_transfer.frame_cycles.min(usize::from(u16::MAX)) as u16;
                status.words_per_cycle =
                    pending_transfer.words_per_cycle.min(usize::from(u16::MAX)) as u16;
                status.min_batch_cycles = pending_transfer.min_batch_cycles;
                status.max_wait_us = pending_transfer.max_wait_us;
                status.configured_signal_count = input_signal_order
                    .iter()
                    .chain(output_signal_order.iter())
                    .filter(|signal| !signal.trim().is_empty())
                    .count()
                    .min(u16::MAX as usize) as u16;
                status.last_error = None;
            }) {
                eprintln!("failed to publish data stream status: {err}");
            }

            if pending_transfers.is_empty() {
                transfer_window = None;
            }
        }

        drop(transfer_window);
        if let Err(err) = io.finish() {
            self.record_data_stream_error(format!("failed to finish I/O session: {err}"));
        }
        if let Err(err) = board.close() {
            self.record_data_stream_error(format!("failed to close board: {err}"));
        }
        if let Err(err) = decode_worker.shutdown() {
            self.record_data_stream_error(err);
        }
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

    pub(super) fn validate_target_hz(rate_hz: f64) -> Result<(), String> {
        if !rate_hz.is_finite() || rate_hz <= 0.0 {
            return Err("Target frequency must be a finite value greater than zero".to_string());
        }

        Ok(())
    }
}
