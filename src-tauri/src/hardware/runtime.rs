use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
#[cfg(test)]
use std::{
    collections::VecDeque,
    hash::{Hash, Hasher},
};

use tauri::{AppHandle, Emitter};
use vlfd_rs::{Device, IoSettings};

use super::driver;
use super::types::{
    CanvasDeviceType, HardwareActionV1, HardwareArtifactSnapshot, HardwareDataBatchBinaryV1,
    HardwareDataSignalCatalogEntryV1, HardwareDataSignalCatalogV1, HardwareDataStreamConfigV1,
    HardwareDataStreamStatusV1, HardwareEventReason, HardwareEventV1, HardwarePhase,
    HardwareSignalAggregateByIdV1, HardwareStateV1,
};

const DATA_IDLE_SLEEP: Duration = Duration::from_millis(1);
const DATA_MAX_UPDATES_PER_BATCH: usize = 256;
const DATA_DEFAULT_WORDS_PER_CYCLE: u16 = 4;
const DATA_DEFAULT_TARGET_HZ: f64 = 1.0;

struct HardwareDataStreamSession {
    stop_flag: Arc<AtomicBool>,
    handle: thread::JoinHandle<()>,
}

#[cfg(test)]
struct HardwareDataSample {
    values: Vec<(u16, bool)>,
}

#[cfg(test)]
#[derive(Default)]
struct SignalTopologyCache {
    signature: u64,
    routes: Vec<SignalRoute>,
}

#[cfg(test)]
struct SignalRoute {
    signal: String,
    signal_id: u16,
    source_index: Option<usize>,
    fallback_index: Option<usize>,
}

#[derive(Default)]
struct SignalCatalog {
    by_signal: HashMap<String, u16>,
    next_id: u16,
}

impl SignalCatalog {
    fn id_for_signal(
        &mut self,
        signal: &str,
        pending_catalog_updates: &mut Vec<HardwareDataSignalCatalogEntryV1>,
    ) -> u16 {
        if let Some(id) = self.by_signal.get(signal) {
            return *id;
        }

        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.by_signal.insert(signal.to_string(), id);
        pending_catalog_updates.push(HardwareDataSignalCatalogEntryV1 {
            signal_id: id,
            signal: signal.to_string(),
        });
        id
    }
}

#[derive(Clone)]
struct HardwareDataAggregate {
    latest: bool,
    high_count: u32,
    total_count: u32,
    edge_count: u16,
    previous: Option<bool>,
}

impl HardwareDataAggregate {
    fn new() -> Self {
        Self {
            latest: false,
            high_count: 0,
            total_count: 0,
            edge_count: 0,
            previous: None,
        }
    }

    fn ingest(&mut self, value: bool) {
        if let Some(previous) = self.previous {
            if previous != value {
                self.edge_count = self.edge_count.saturating_add(1);
            }
        }

        self.previous = Some(value);
        self.latest = value;
        if value {
            self.high_count += 1;
        }
        self.total_count += 1;
    }

    fn into_signal(self, signal_id: u16) -> HardwareSignalAggregateByIdV1 {
        let high_ratio = if self.total_count == 0 {
            0.0
        } else {
            self.high_count as f32 / self.total_count as f32
        };

        HardwareSignalAggregateByIdV1 {
            signal_id,
            latest: self.latest,
            high_ratio,
            edge_count: self.edge_count,
        }
    }
}

pub struct HardwareRuntime {
    state: Mutex<HardwareStateV1>,
    data_stream: Mutex<Option<HardwareDataStreamSession>>,
    data_stream_config: Arc<Mutex<HardwareDataStreamConfigV1>>,
    data_stream_status: Mutex<HardwareDataStreamStatusV1>,
}

impl Default for HardwareRuntime {
    fn default() -> Self {
        Self {
            state: Mutex::new(HardwareStateV1::default()),
            data_stream: Mutex::new(None),
            data_stream_config: Arc::new(Mutex::new(HardwareDataStreamConfigV1::default())),
            data_stream_status: Mutex::new(HardwareDataStreamStatusV1 {
                running: false,
                target_hz: DATA_DEFAULT_TARGET_HZ,
                sequence: 0,
                dropped_samples: 0,
                queue_fill: 0,
                queue_capacity: 0,
                last_batch_at_ms: 0,
                words_per_cycle: DATA_DEFAULT_WORDS_PER_CYCLE,
                configured_signal_count: 0,
                last_error: None,
            }),
        }
    }
}

impl HardwareRuntime {
    pub fn snapshot(&self) -> Result<HardwareStateV1, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "failed to acquire hardware state mutex".to_string())?
            .clone();
        Ok(state)
    }

    pub fn data_stream_status(&self) -> Result<HardwareDataStreamStatusV1, String> {
        self.data_stream_status
            .lock()
            .map_err(|_| "failed to acquire data stream status mutex".to_string())
            .map(|status| status.clone())
    }

    pub fn configure_data_stream(
        &self,
        config: HardwareDataStreamConfigV1,
    ) -> Result<HardwareDataStreamStatusV1, String> {
        Self::validate_stream_config(&config)?;

        {
            let mut guard = self
                .data_stream_config
                .lock()
                .map_err(|_| "failed to acquire data stream config mutex".to_string())?;
            *guard = config.clone();
        }

        self.update_data_stream_status(|status| {
            status.target_hz = config.target_hz;
            status.words_per_cycle = config.words_per_cycle;
            status.configured_signal_count = config.signal_order.len() as u16;
            status.last_error = None;
        })?;

        self.data_stream_status()
    }

    pub fn set_data_stream_rate(&self, rate_hz: f64) -> Result<HardwareDataStreamStatusV1, String> {
        Self::validate_target_hz(rate_hz)?;

        {
            let mut guard = self
                .data_stream_config
                .lock()
                .map_err(|_| "failed to acquire data stream config mutex".to_string())?;
            guard.target_hz = rate_hz;
        }

        self.update_data_stream_status(|status| {
            status.target_hz = rate_hz;
            status.last_error = None;
        })?;

        self.data_stream_status()
    }

    pub fn start_data_stream(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        let config = {
            self.data_stream_config
                .lock()
                .map_err(|_| "failed to acquire data stream config mutex".to_string())?
                .clone()
        };
        Self::validate_stream_config(&config)?;

        let stale_session = {
            let mut guard = self
                .data_stream
                .lock()
                .map_err(|_| "failed to acquire data stream mutex".to_string())?;

            match guard.as_ref() {
                Some(session) if session.handle.is_finished() => guard.take(),
                Some(_) => return Ok(()),
                None => None,
            }
        };

        if let Some(session) = stale_session {
            let _ = session.handle.join();
        }

        {
            let mut guard = self
                .data_stream
                .lock()
                .map_err(|_| "failed to acquire data stream mutex".to_string())?;

            if guard.is_some() {
                return Ok(());
            }

            let stop_flag = Arc::new(AtomicBool::new(false));
            let runtime = Arc::clone(self);
            let stop_for_thread = Arc::clone(&stop_flag);
            let app_handle = app.clone();
            let config_handle = Arc::clone(&self.data_stream_config);

            let handle = thread::Builder::new()
                .name("aspen-hardware-data-stream".to_string())
                .spawn(move || {
                    runtime.run_data_stream_loop(app_handle, stop_for_thread, config_handle);
                })
                .map_err(|err| err.to_string())?;

            *guard = Some(HardwareDataStreamSession { stop_flag, handle });
        }

        self.update_data_stream_status(|status| {
            status.running = true;
            status.target_hz = config.target_hz;
            status.queue_fill = 0;
            status.last_batch_at_ms = 0;
            status.sequence = 0;
            status.dropped_samples = 0;
            status.words_per_cycle = config.words_per_cycle;
            status.configured_signal_count = config.signal_order.len() as u16;
            status.last_error = None;
        })
    }

    pub fn stop_data_stream(&self) -> Result<(), String> {
        let session = {
            let mut guard = self
                .data_stream
                .lock()
                .map_err(|_| "failed to acquire data stream mutex".to_string())?;

            guard.take()
        };

        if let Some(session) = session {
            session.stop_flag.store(true, Ordering::Relaxed);
            let _ = session.handle.join();
        }

        self.update_data_stream_status(|status| {
            status.running = false;
            status.queue_fill = 0;
            status.last_error = None;
        })
    }

    pub fn mark_device_disconnected(
        &self,
        app: &AppHandle,
        reason: HardwareEventReason,
    ) -> Result<HardwareStateV1, String> {
        self.apply_state_update(app, reason, |state| {
            state.phase = HardwarePhase::DeviceDisconnected;
            state.device = None;
            state.last_error = Some("Device disconnected".to_string());
            state.op_id = None;
        })
    }

    pub async fn dispatch(
        &self,
        app: &AppHandle,
        action: HardwareActionV1,
        reason: HardwareEventReason,
    ) -> Result<HardwareStateV1, String> {
        match action {
            HardwareActionV1::Probe => self.dispatch_probe(app, reason).await,
            HardwareActionV1::GenerateBitstream {
                source_name,
                source_code,
                output_path,
            } => {
                self.dispatch_generate(app, reason, source_name, source_code, output_path)
                    .await
            }
            HardwareActionV1::ProgramBitstream { bitstream_path } => {
                self.dispatch_program(app, reason, bitstream_path).await
            }
            HardwareActionV1::UpsertCanvasDevice { device } => {
                self.apply_state_update(app, reason, |state| {
                    if let Some(existing) = state
                        .canvas_devices
                        .iter_mut()
                        .find(|item| item.id == device.id)
                    {
                        *existing = device;
                    } else {
                        state.canvas_devices.push(device);
                    }
                })
            }
            HardwareActionV1::RemoveCanvasDevice { id } => {
                self.apply_state_update(app, reason, |state| {
                    state.canvas_devices.retain(|item| item.id != id);
                })
            }
            HardwareActionV1::SetCanvasDevicePosition { id, x, y } => {
                self.apply_state_update(app, reason, |state| {
                    if let Some(device) = state.canvas_devices.iter_mut().find(|item| item.id == id)
                    {
                        device.x = x;
                        device.y = y;
                    }
                })
            }
            HardwareActionV1::BindCanvasSignal { id, signal_name } => {
                self.apply_state_update(app, reason, |state| {
                    let Some(target_index) = Self::find_canvas_device_index(state, &id) else {
                        return;
                    };

                    state.canvas_devices[target_index].state.bound_signal = signal_name;
                    Self::reconcile_bound_signal(state, target_index);
                })
            }
            HardwareActionV1::SetCanvasSwitchState { id, is_on } => {
                self.apply_state_update(app, reason, |state| {
                    let Some(source_index) = Self::find_canvas_device_index(state, &id) else {
                        return;
                    };

                    state.canvas_devices[source_index].state.is_on = is_on;
                    let source = &state.canvas_devices[source_index];
                    if !Self::device_drives_signal(source.r#type) {
                        return;
                    }

                    let Some(signal) = source.state.bound_signal.clone() else {
                        return;
                    };

                    Self::propagate_signal_to_subscribers(state, source_index, &signal, is_on);
                })
            }
            HardwareActionV1::ClearError => self.apply_state_update(app, reason, |state| {
                state.last_error = None;
                if state.phase == HardwarePhase::Error {
                    state.phase = if state.device.is_some() {
                        HardwarePhase::DeviceReady
                    } else {
                        HardwarePhase::Idle
                    };
                }
            }),
        }
    }

    async fn dispatch_probe(
        &self,
        app: &AppHandle,
        reason: HardwareEventReason,
    ) -> Result<HardwareStateV1, String> {
        self.apply_state_update(app, reason, |state| {
            state.phase = HardwarePhase::Probing;
            state.op_id = Some(Self::next_operation_id("probe"));
            state.last_error = None;
        })?;

        let probe_result = tauri::async_runtime::spawn_blocking(driver::probe_device)
            .await
            .map_err(|err| err.to_string())?;

        match probe_result {
            Ok(device) => self.apply_state_update(app, reason, |state| {
                let phase = if !device.config.pcb_connected {
                    HardwarePhase::DeviceDisconnected
                } else if device.config.programmed {
                    HardwarePhase::Programmed
                } else if state.artifact.is_some() {
                    HardwarePhase::BitstreamReady
                } else {
                    HardwarePhase::DeviceReady
                };

                state.phase = phase;
                state.device = Some(device);
                state.last_error = None;
                state.op_id = None;
            }),
            Err(message) => {
                let phase = Self::probe_failure_phase(&message);
                self.apply_state_update(app, reason, |state| {
                    state.phase = phase;
                    state.device = None;
                    state.last_error = Some(message.clone());
                    state.op_id = None;
                })?;
                Err(message)
            }
        }
    }

    async fn dispatch_generate(
        &self,
        app: &AppHandle,
        reason: HardwareEventReason,
        source_name: String,
        source_code: String,
        output_path: Option<String>,
    ) -> Result<HardwareStateV1, String> {
        if source_code.trim().is_empty() {
            let message = "Cannot generate bitstream from empty source".to_string();
            self.apply_state_update(app, reason, |state| {
                state.phase = HardwarePhase::Error;
                state.last_error = Some(message.clone());
                state.op_id = None;
            })?;
            return Err(message);
        }

        self.apply_state_update(app, reason, |state| {
            state.phase = HardwarePhase::Generating;
            state.op_id = Some(Self::next_operation_id("generate"));
            state.last_error = None;
        })?;

        let generated_result = tauri::async_runtime::spawn_blocking(move || {
            driver::generate_bitstream(&source_name, &source_code, output_path.as_deref())
        })
        .await
        .map_err(|err| err.to_string())?;

        match generated_result {
            Ok(artifact) => self.apply_state_update(app, reason, |state| {
                state.phase = HardwarePhase::BitstreamReady;
                state.artifact = Some(artifact);
                state.last_error = None;
                state.op_id = None;
            }),
            Err(message) => {
                self.apply_state_update(app, reason, |state| {
                    state.phase = HardwarePhase::Error;
                    state.last_error = Some(message.clone());
                    state.op_id = None;
                })?;
                Err(message)
            }
        }
    }

    async fn dispatch_program(
        &self,
        app: &AppHandle,
        reason: HardwareEventReason,
        bitstream_path: Option<String>,
    ) -> Result<HardwareStateV1, String> {
        let artifact_path = {
            let guard = self
                .state
                .lock()
                .map_err(|_| "failed to acquire hardware state mutex".to_string())?;
            guard
                .artifact
                .as_ref()
                .map(|artifact| artifact.path.clone())
        };

        let target_path = bitstream_path.or(artifact_path).ok_or_else(|| {
            "No bitstream path provided and no generated artifact found".to_string()
        })?;

        self.apply_state_update(app, reason, |state| {
            state.phase = HardwarePhase::Programming;
            state.op_id = Some(Self::next_operation_id("program"));
            state.last_error = None;
            if state.artifact.is_none() {
                state.artifact = Some(HardwareArtifactSnapshot {
                    path: target_path.clone(),
                    bytes: 0,
                });
            }
        })?;

        let program_result = tauri::async_runtime::spawn_blocking(move || {
            driver::program_bitstream(&target_path)?;
            driver::probe_device()
        })
        .await
        .map_err(|err| err.to_string())?;

        match program_result {
            Ok(device) => self.apply_state_update(app, reason, |state| {
                state.phase = if device.config.programmed {
                    HardwarePhase::Programmed
                } else {
                    HardwarePhase::DeviceReady
                };
                state.device = Some(device);
                state.last_error = None;
                state.op_id = None;
            }),
            Err(message) => {
                self.apply_state_update(app, reason, |state| {
                    state.phase = HardwarePhase::Error;
                    state.last_error = Some(message.clone());
                    state.op_id = None;
                })?;
                Err(message)
            }
        }
    }

    fn apply_state_update<F>(
        &self,
        app: &AppHandle,
        reason: HardwareEventReason,
        mutator: F,
    ) -> Result<HardwareStateV1, String>
    where
        F: FnOnce(&mut HardwareStateV1),
    {
        let next_state = {
            let mut guard = self
                .state
                .lock()
                .map_err(|_| "failed to acquire hardware state mutex".to_string())?;
            mutator(&mut guard);
            guard.version = 1;
            guard.updated_at_ms = Self::now_millis();
            guard.clone()
        };

        self.emit_state(app, &next_state, reason)?;
        Ok(next_state)
    }

    fn emit_state(
        &self,
        app: &AppHandle,
        state: &HardwareStateV1,
        reason: HardwareEventReason,
    ) -> Result<(), String> {
        app.emit(
            "hardware:state_changed",
            HardwareEventV1 {
                version: 1,
                state: state.clone(),
                reason,
            },
        )
        .map_err(|err| err.to_string())
    }

    fn now_millis() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }

    fn next_operation_id(prefix: &str) -> String {
        format!("{}-{}", prefix, Self::now_millis())
    }

    fn update_data_stream_status<F>(&self, mutator: F) -> Result<(), String>
    where
        F: FnOnce(&mut HardwareDataStreamStatusV1),
    {
        let mut guard = self
            .data_stream_status
            .lock()
            .map_err(|_| "failed to acquire data stream status mutex".to_string())?;
        mutator(&mut guard);
        Ok(())
    }

    fn run_data_stream_loop(
        self: Arc<Self>,
        app: AppHandle,
        stop_flag: Arc<AtomicBool>,
        data_stream_config: Arc<Mutex<HardwareDataStreamConfigV1>>,
    ) {
        let mut device = match Device::connect() {
            Ok(device) => device,
            Err(err) => {
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error = Some(err.to_string());
                });
                return;
            }
        };

        if let Err(err) = device.enter_io_mode(&IoSettings::default()) {
            let _ = self.update_data_stream_status(|status| {
                status.running = false;
                status.last_error = Some(err.to_string());
            });
            let _ = device.close();
            return;
        }

        let fifo_words =
            usize::from(device.config().fifo_size()).max(usize::from(DATA_DEFAULT_WORDS_PER_CYCLE));
        let started_at = Instant::now();
        let mut completed_cycles = 0_u64;
        let mut sequence = 0_u64;
        let mut last_latest_by_signal: HashMap<u16, bool> = HashMap::new();
        let mut signal_catalog = SignalCatalog::default();
        let mut pending_catalog_updates: Vec<HardwareDataSignalCatalogEntryV1> = Vec::new();

        while !stop_flag.load(Ordering::Relaxed) {
            let config = match data_stream_config.lock() {
                Ok(guard) => guard.clone(),
                Err(_) => break,
            };

            let signal_order =
                Self::active_signal_order(&config.signal_order, config.words_per_cycle);
            let signal_ids = signal_order
                .iter()
                .map(|signal| signal_catalog.id_for_signal(signal, &mut pending_catalog_updates))
                .collect::<Vec<_>>();

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
            let queue_capacity = (fifo_words / words_per_cycle).max(1);
            let expected_cycles = (started_at.elapsed().as_secs_f64()
                * config.target_hz.max(DATA_DEFAULT_TARGET_HZ))
            .floor() as u64;
            let due_cycles = expected_cycles.saturating_sub(completed_cycles);

            if due_cycles == 0 {
                thread::sleep(DATA_IDLE_SLEEP);
                continue;
            }

            let batch_cycles = due_cycles.min(queue_capacity as u64) as usize;
            let state_snapshot = match self.snapshot() {
                Ok(snapshot) => snapshot,
                Err(_) => break,
            };
            let mut write_buffer = Self::build_write_buffer(
                &state_snapshot,
                &signal_order,
                batch_cycles,
                words_per_cycle,
            );
            let mut read_buffer = vec![0u16; batch_cycles * words_per_cycle];

            if let Err(err) = device.transfer_io(&mut write_buffer, &mut read_buffer) {
                let _ = self.update_data_stream_status(|status| {
                    status.running = false;
                    status.last_error = Some(err.to_string());
                });
                break;
            }

            completed_cycles = completed_cycles.saturating_add(batch_cycles as u64);
            sequence = sequence.saturating_add(1);

            let generated_at_ms = Self::now_millis();
            let updates = Self::filter_changed_updates(
                Self::aggregate_read_buffer(&read_buffer, &signal_ids, words_per_cycle),
                &mut last_latest_by_signal,
            );
            let remaining_backlog = expected_cycles.saturating_sub(completed_cycles);
            let payload = Self::encode_binary_batch(
                sequence,
                generated_at_ms,
                0,
                remaining_backlog.min(u64::from(u16::MAX)) as u16,
                queue_capacity.min(usize::from(u16::MAX)) as u16,
                &updates,
            );

            let _ = app.emit(
                "hardware:data_batch_bin",
                HardwareDataBatchBinaryV1 {
                    version: 1,
                    payload,
                },
            );

            let _ = self.update_data_stream_status(|status| {
                status.running = true;
                status.target_hz = config.target_hz;
                status.sequence = sequence;
                status.dropped_samples = 0;
                status.queue_fill = remaining_backlog.min(u64::from(u16::MAX)) as u16;
                status.queue_capacity = queue_capacity.min(usize::from(u16::MAX)) as u16;
                status.last_batch_at_ms = generated_at_ms;
                status.words_per_cycle = config.words_per_cycle;
                status.configured_signal_count = signal_order.len() as u16;
                status.last_error = None;
            });
        }

        let _ = device.exit_io_mode();
        let _ = device.close();
    }

    fn validate_stream_config(config: &HardwareDataStreamConfigV1) -> Result<(), String> {
        Self::validate_target_hz(config.target_hz)?;

        if config.words_per_cycle == 0 {
            return Err("Words per cycle must be greater than zero".to_string());
        }

        let max_signal_count = usize::from(config.words_per_cycle) * 16;
        if config.signal_order.len() > max_signal_count {
            return Err(format!(
                "Configured {} signals exceed packet capacity of {} bits",
                config.signal_order.len(),
                max_signal_count
            ));
        }

        Ok(())
    }

    fn validate_target_hz(rate_hz: f64) -> Result<(), String> {
        if !rate_hz.is_finite() || rate_hz <= 0.0 {
            return Err("Target frequency must be a finite value greater than zero".to_string());
        }

        Ok(())
    }

    fn active_signal_order(signal_order: &[String], words_per_cycle: u16) -> Vec<String> {
        let max_signal_count = usize::from(words_per_cycle.max(1)) * 16;
        let mut active = Vec::with_capacity(signal_order.len().min(max_signal_count));

        for signal in signal_order {
            if active.len() >= max_signal_count {
                break;
            }

            if active.iter().any(|existing| existing == signal) {
                continue;
            }

            active.push(signal.clone());
        }

        active
    }

    fn build_write_buffer(
        state: &HardwareStateV1,
        signal_order: &[String],
        batch_cycles: usize,
        words_per_cycle: usize,
    ) -> Vec<u16> {
        let mut cycle_words = vec![0u16; words_per_cycle];

        for (signal_index, signal) in signal_order.iter().enumerate() {
            if !Self::signal_source_value(state, signal).unwrap_or(false) {
                continue;
            }

            let word_index = signal_index / 16;
            let bit_index = signal_index % 16;
            if let Some(word) = cycle_words.get_mut(word_index) {
                *word |= 1u16 << bit_index;
            }
        }

        let mut buffer = vec![0u16; batch_cycles * words_per_cycle];
        for chunk in buffer.chunks_exact_mut(words_per_cycle) {
            chunk.copy_from_slice(&cycle_words);
        }
        buffer
    }

    fn aggregate_read_buffer(
        read_buffer: &[u16],
        signal_ids: &[u16],
        words_per_cycle: usize,
    ) -> Vec<HardwareSignalAggregateByIdV1> {
        let signal_count = signal_ids.len().min(words_per_cycle * 16);
        if signal_count == 0 {
            return Vec::new();
        }

        let mut aggregates = (0..signal_count)
            .map(|_| HardwareDataAggregate::new())
            .collect::<Vec<_>>();

        for cycle in read_buffer.chunks_exact(words_per_cycle) {
            for (signal_index, aggregate) in aggregates.iter_mut().enumerate().take(signal_count) {
                let word_index = signal_index / 16;
                let bit_index = signal_index % 16;
                let value = cycle
                    .get(word_index)
                    .map(|word| (word & (1u16 << bit_index)) != 0)
                    .unwrap_or(false);
                aggregate.ingest(value);
            }
        }

        let mut updates = aggregates
            .into_iter()
            .enumerate()
            .map(|(signal_index, aggregate)| aggregate.into_signal(signal_ids[signal_index]))
            .collect::<Vec<_>>();

        if updates.len() > DATA_MAX_UPDATES_PER_BATCH {
            updates.truncate(DATA_MAX_UPDATES_PER_BATCH);
        }

        updates
    }

    #[cfg(test)]
    fn collect_data_sample(
        &self,
        topology_cache: &mut SignalTopologyCache,
        signal_catalog: &mut SignalCatalog,
        pending_catalog_updates: &mut Vec<HardwareDataSignalCatalogEntryV1>,
    ) -> HardwareDataSample {
        let values = match self.state.lock() {
            Ok(state) => {
                Self::refresh_signal_topology_cache(
                    &state,
                    topology_cache,
                    signal_catalog,
                    pending_catalog_updates,
                );

                let mut values = Vec::with_capacity(topology_cache.routes.len());
                for route in &topology_cache.routes {
                    let index = route.source_index.or(route.fallback_index);
                    if let Some(index) = index {
                        values.push((route.signal_id, state.canvas_devices[index].state.is_on));
                    }
                }
                values
            }
            Err(_) => Vec::new(),
        };

        HardwareDataSample { values }
    }

    #[cfg(test)]
    fn aggregate_data_samples(
        queue: &mut VecDeque<HardwareDataSample>,
    ) -> Vec<HardwareSignalAggregateByIdV1> {
        let mut aggregated: HashMap<u16, HardwareDataAggregate> = HashMap::new();

        while let Some(sample) = queue.pop_front() {
            for (signal_id, value) in sample.values {
                aggregated
                    .entry(signal_id)
                    .or_insert_with(HardwareDataAggregate::new)
                    .ingest(value);
            }
        }

        let mut updates: Vec<HardwareSignalAggregateByIdV1> = aggregated
            .into_iter()
            .map(|(signal_id, aggregate)| aggregate.into_signal(signal_id))
            .collect();
        if updates.len() > DATA_MAX_UPDATES_PER_BATCH {
            updates.sort_by(|left, right| left.signal_id.cmp(&right.signal_id));
            updates.truncate(DATA_MAX_UPDATES_PER_BATCH);
        }
        updates
    }

    fn filter_changed_updates(
        mut updates: Vec<HardwareSignalAggregateByIdV1>,
        last_latest_by_signal: &mut HashMap<u16, bool>,
    ) -> Vec<HardwareSignalAggregateByIdV1> {
        updates.retain(|update| {
            let previous_latest = last_latest_by_signal.insert(update.signal_id, update.latest);
            update.edge_count > 0
                || previous_latest
                    .map(|value| value != update.latest)
                    .unwrap_or(true)
        });
        updates
    }

    #[cfg(test)]
    fn refresh_signal_topology_cache(
        state: &HardwareStateV1,
        topology_cache: &mut SignalTopologyCache,
        signal_catalog: &mut SignalCatalog,
        pending_catalog_updates: &mut Vec<HardwareDataSignalCatalogEntryV1>,
    ) {
        let signature = Self::signal_topology_signature(state);
        if topology_cache.signature == signature {
            return;
        }

        #[derive(Default)]
        struct RouteDraft {
            source_index: Option<usize>,
            fallback_index: Option<usize>,
        }

        let mut drafts: HashMap<String, RouteDraft> = HashMap::new();

        for (index, device) in state.canvas_devices.iter().enumerate() {
            let Some(signal) = device.state.bound_signal.as_ref() else {
                continue;
            };

            let draft = drafts.entry(signal.clone()).or_default();
            if Self::device_drives_signal(device.r#type) && draft.source_index.is_none() {
                draft.source_index = Some(index);
            }

            if Self::device_receives_signal(device.r#type) && draft.fallback_index.is_none() {
                draft.fallback_index = Some(index);
            }
        }

        let mut routes = Vec::with_capacity(drafts.len());
        for (signal, draft) in drafts {
            let signal_id = signal_catalog.id_for_signal(&signal, pending_catalog_updates);
            routes.push(SignalRoute {
                signal,
                signal_id,
                source_index: draft.source_index,
                fallback_index: draft.fallback_index,
            });
        }

        routes.sort_by(|left, right| left.signal.cmp(&right.signal));
        topology_cache.signature = signature;
        topology_cache.routes = routes;
    }

    #[cfg(test)]
    fn signal_topology_signature(state: &HardwareStateV1) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        state.canvas_devices.len().hash(&mut hasher);
        for device in &state.canvas_devices {
            device.id.hash(&mut hasher);
            device.r#type.hash(&mut hasher);
            device.state.bound_signal.hash(&mut hasher);
        }
        hasher.finish()
    }

    fn encode_binary_batch(
        sequence: u64,
        generated_at_ms: u64,
        dropped_samples: u64,
        queue_fill: u16,
        queue_capacity: u16,
        updates: &[HardwareSignalAggregateByIdV1],
    ) -> Vec<u8> {
        let updates_count = updates.len() as u16;
        let mut payload = Vec::with_capacity(30 + updates.len() * 9);
        payload.extend_from_slice(&sequence.to_le_bytes());
        payload.extend_from_slice(&generated_at_ms.to_le_bytes());
        payload.extend_from_slice(&dropped_samples.to_le_bytes());
        payload.extend_from_slice(&queue_fill.to_le_bytes());
        payload.extend_from_slice(&queue_capacity.to_le_bytes());
        payload.extend_from_slice(&updates_count.to_le_bytes());

        for update in updates {
            payload.extend_from_slice(&update.signal_id.to_le_bytes());
            payload.push(u8::from(update.latest));
            payload.extend_from_slice(&update.high_ratio.to_le_bytes());
            payload.extend_from_slice(&update.edge_count.to_le_bytes());
        }

        payload
    }

    fn probe_failure_phase(message: &str) -> HardwarePhase {
        let lowered = message.to_ascii_lowercase();
        if lowered.contains("not found")
            || lowered.contains("not connected")
            || lowered.contains("no device")
            || lowered.contains("disconnected")
        {
            HardwarePhase::DeviceDisconnected
        } else {
            HardwarePhase::Error
        }
    }

    fn find_canvas_device_index(state: &HardwareStateV1, id: &str) -> Option<usize> {
        state.canvas_devices.iter().position(|item| item.id == id)
    }

    fn device_drives_signal(device_type: CanvasDeviceType) -> bool {
        matches!(
            device_type,
            CanvasDeviceType::Switch
                | CanvasDeviceType::Button
                | CanvasDeviceType::Keypad
                | CanvasDeviceType::SmallKeypad
                | CanvasDeviceType::RotaryButton
                | CanvasDeviceType::Ps2Keyboard
        )
    }

    fn device_receives_signal(device_type: CanvasDeviceType) -> bool {
        matches!(
            device_type,
            CanvasDeviceType::Led
                | CanvasDeviceType::TextLcd
                | CanvasDeviceType::GraphicLcd
                | CanvasDeviceType::SegmentDisplay
                | CanvasDeviceType::FourDigitSegmentDisplay
                | CanvasDeviceType::Led4x4Matrix
                | CanvasDeviceType::Led8x8Matrix
                | CanvasDeviceType::Led16x16Matrix
        )
    }

    fn signal_source_value(state: &HardwareStateV1, signal: &str) -> Option<bool> {
        state
            .canvas_devices
            .iter()
            .find(|candidate| {
                Self::device_drives_signal(candidate.r#type)
                    && candidate.state.bound_signal.as_deref() == Some(signal)
            })
            .map(|candidate| candidate.state.is_on)
    }

    fn propagate_signal_to_subscribers(
        state: &mut HardwareStateV1,
        source_index: usize,
        signal: &str,
        value: bool,
    ) {
        for (candidate_index, candidate) in state.canvas_devices.iter_mut().enumerate() {
            if candidate_index == source_index {
                continue;
            }

            if Self::device_receives_signal(candidate.r#type)
                && candidate.state.bound_signal.as_deref() == Some(signal)
            {
                candidate.state.is_on = value;
            }
        }
    }

    fn reconcile_bound_signal(state: &mut HardwareStateV1, target_index: usize) {
        let target = &state.canvas_devices[target_index];
        let target_type = target.r#type;
        let target_value = target.state.is_on;
        let target_signal = target.state.bound_signal.clone();

        let Some(signal) = target_signal else {
            return;
        };

        if Self::device_drives_signal(target_type) {
            Self::propagate_signal_to_subscribers(state, target_index, &signal, target_value);
            return;
        }

        if Self::device_receives_signal(target_type) {
            if let Some(value) = Self::signal_source_value(state, &signal) {
                state.canvas_devices[target_index].state.is_on = value;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::types::{CanvasDeviceSnapshot, CanvasDeviceStateSnapshot};

    fn sample(values: &[(u16, bool)]) -> HardwareDataSample {
        HardwareDataSample {
            values: values.to_vec(),
        }
    }

    #[test]
    fn aggregate_data_samples_tracks_latest_ratio_and_edges() {
        let mut queue = VecDeque::from([
            sample(&[(1, false), (2, true)]),
            sample(&[(1, true), (2, true)]),
            sample(&[(1, true), (2, false)]),
        ]);

        let updates = HardwareRuntime::aggregate_data_samples(&mut queue);
        assert_eq!(updates.len(), 2);

        let sig_a = updates.iter().find(|item| item.signal_id == 1).unwrap();
        assert!(sig_a.latest);
        assert_eq!(sig_a.edge_count, 1);
        assert!((sig_a.high_ratio - (2.0 / 3.0)).abs() < 0.0001);

        let sig_b = updates.iter().find(|item| item.signal_id == 2).unwrap();
        assert!(!sig_b.latest);
        assert_eq!(sig_b.edge_count, 1);
        assert!((sig_b.high_ratio - (2.0 / 3.0)).abs() < 0.0001);

        assert!(queue.is_empty());
    }

    #[test]
    fn aggregate_data_samples_caps_payload_size() {
        let mut values = Vec::new();
        for index in 0..(DATA_MAX_UPDATES_PER_BATCH + 10) {
            values.push((index as u16, (index % 2) == 0));
        }

        let mut queue = VecDeque::from([HardwareDataSample { values }]);
        let updates = HardwareRuntime::aggregate_data_samples(&mut queue);
        assert_eq!(updates.len(), DATA_MAX_UPDATES_PER_BATCH);
    }

    #[test]
    fn collect_data_sample_prefers_drivers_and_keeps_receiver_fallback() {
        let runtime = HardwareRuntime::default();

        {
            let mut state = runtime.state.lock().unwrap();
            let switch = state
                .canvas_devices
                .iter_mut()
                .find(|item| item.r#type == CanvasDeviceType::Switch)
                .unwrap();
            switch.state.bound_signal = Some("sig_driven".to_string());
            switch.state.is_on = true;

            let led = state
                .canvas_devices
                .iter_mut()
                .find(|item| item.r#type == CanvasDeviceType::Led)
                .unwrap();
            led.state.bound_signal = Some("sig_driven".to_string());
            led.state.is_on = false;

            state.canvas_devices.push(CanvasDeviceSnapshot {
                id: "led-extra".to_string(),
                r#type: CanvasDeviceType::Led,
                x: 0.0,
                y: 0.0,
                label: "LED Extra".to_string(),
                state: CanvasDeviceStateSnapshot {
                    is_on: true,
                    color: Some("green".to_string()),
                    bound_signal: Some("sig_receiver".to_string()),
                },
            });
        }

        let mut topology_cache = SignalTopologyCache::default();
        let mut signal_catalog = SignalCatalog::default();
        let mut pending_catalog_updates = Vec::new();

        let sample = runtime.collect_data_sample(
            &mut topology_cache,
            &mut signal_catalog,
            &mut pending_catalog_updates,
        );

        assert_eq!(sample.values.len(), 2);
        let by_id: HashMap<u16, bool> = sample.values.into_iter().collect();
        let driven_id = signal_catalog.by_signal.get("sig_driven").copied().unwrap();
        let receiver_id = signal_catalog
            .by_signal
            .get("sig_receiver")
            .copied()
            .unwrap();

        assert_eq!(by_id.get(&driven_id), Some(&true));
        assert_eq!(by_id.get(&receiver_id), Some(&true));
    }

    #[test]
    fn filter_changed_updates_skips_steady_windows() {
        let mut last_latest = HashMap::new();

        let first = HardwareRuntime::filter_changed_updates(
            vec![
                HardwareSignalAggregateByIdV1 {
                    signal_id: 1,
                    latest: true,
                    high_ratio: 1.0,
                    edge_count: 0,
                },
                HardwareSignalAggregateByIdV1 {
                    signal_id: 2,
                    latest: false,
                    high_ratio: 0.0,
                    edge_count: 0,
                },
            ],
            &mut last_latest,
        );
        assert_eq!(first.len(), 2);

        let second = HardwareRuntime::filter_changed_updates(
            vec![
                HardwareSignalAggregateByIdV1 {
                    signal_id: 1,
                    latest: true,
                    high_ratio: 1.0,
                    edge_count: 0,
                },
                HardwareSignalAggregateByIdV1 {
                    signal_id: 2,
                    latest: false,
                    high_ratio: 0.0,
                    edge_count: 0,
                },
            ],
            &mut last_latest,
        );
        assert!(second.is_empty());

        let third = HardwareRuntime::filter_changed_updates(
            vec![HardwareSignalAggregateByIdV1 {
                signal_id: 1,
                latest: true,
                high_ratio: 0.5,
                edge_count: 2,
            }],
            &mut last_latest,
        );
        assert_eq!(third.len(), 1);
    }
}
