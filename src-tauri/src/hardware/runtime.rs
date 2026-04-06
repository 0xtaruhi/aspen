use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use tauri::{AppHandle, Emitter};

use super::driver;
use super::types::{
    HardwareActionV1, HardwareArtifactSnapshot, HardwareDataStreamConfigV1,
    HardwareDataStreamStatusV1, HardwareEventReason, HardwareEventV1, HardwarePhase,
    HardwareStateV1,
};

mod canvas;
mod input;
mod output;
mod registry;
mod shared;
mod stream;
mod telemetry;

#[cfg(test)]
mod tests;

use input::InputDeviceEncoder;
use output::OutputDeviceDecoder;

const DATA_IDLE_SLEEP: Duration = Duration::from_millis(1);
const DEVICE_SNAPSHOT_INTERVAL: Duration = Duration::from_millis(16);
const DEVICE_SNAPSHOT_INTERVAL_MEDIUM: Duration = Duration::from_millis(33);
const DEVICE_SNAPSHOT_INTERVAL_SLOW: Duration = Duration::from_millis(66);
const SIGNAL_TELEMETRY_INTERVAL: Duration = Duration::from_millis(16);
const STREAM_DECODE_QUEUE_CAPACITY: usize = 4;
const STREAM_BUFFER_POOL_CAPACITY: usize = 4;
const DATA_MAX_UPDATES_PER_BATCH: usize = 256;
const DATA_DEFAULT_WORDS_PER_CYCLE: u16 = 4;
const DATA_DEFAULT_TARGET_HZ: f64 = 1.0;
const DATA_DEFAULT_MIN_BATCH_CYCLES: u16 = 128;
const DATA_DEFAULT_MAX_WAIT_US: u32 = 2_000;
const DATA_DEFAULT_CLOCK_HIGH_DELAY: u16 = 4;
const DATA_DEFAULT_CLOCK_LOW_DELAY: u16 = 4;
const DATA_RATE_WINDOW: Duration = Duration::from_millis(1000);

struct HardwareDataStreamSession {
    stop_flag: Arc<AtomicBool>,
    handle: thread::JoinHandle<()>,
}

struct StreamDecodeBatch {
    sequence: u64,
    generated_at_ms: u64,
    dropped_samples: u64,
    queue_fill: u16,
    queue_capacity: u16,
    batch_cycles: u16,
    words_per_cycle: usize,
    batch_words: usize,
    read_buffer: Vec<u16>,
}

enum StreamDecodeMessage {
    SignalIds(Vec<u16>),
    DeviceSnapshotInterval(Duration),
    OutputDecoders(Vec<Box<dyn OutputDeviceDecoder>>),
    Batch(StreamDecodeBatch),
    Shutdown,
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

#[derive(Clone)]
struct HardwareDataAggregate {
    first: Option<bool>,
    latest: bool,
    high_count: u32,
    total_count: u32,
    edge_count: u16,
    previous: Option<bool>,
}

#[derive(Clone, Copy, Default)]
struct PendingSignalBatchMeta {
    sequence: u64,
    generated_at_ms: u64,
    dropped_samples: u64,
    queue_fill: u16,
    queue_capacity: u16,
    batch_cycles: u32,
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
                actual_hz: 0.0,
                transfer_rate_hz: 0.0,
                sequence: 0,
                dropped_samples: 0,
                queue_fill: 0,
                queue_capacity: 0,
                last_batch_at_ms: 0,
                last_batch_cycles: 0,
                words_per_cycle: DATA_DEFAULT_WORDS_PER_CYCLE,
                min_batch_cycles: DATA_DEFAULT_MIN_BATCH_CYCLES,
                max_wait_us: DATA_DEFAULT_MAX_WAIT_US,
                vericomm_clock_high_delay: DATA_DEFAULT_CLOCK_HIGH_DELAY,
                vericomm_clock_low_delay: DATA_DEFAULT_CLOCK_LOW_DELAY,
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
            status.min_batch_cycles = config.min_batch_cycles;
            status.max_wait_us = config.max_wait_us;
            status.vericomm_clock_high_delay = config.vericomm_clock_high_delay;
            status.vericomm_clock_low_delay = config.vericomm_clock_low_delay;
            status.configured_signal_count = config
                .input_signal_order
                .iter()
                .chain(config.output_signal_order.iter())
                .filter(|signal| !signal.trim().is_empty())
                .count()
                .min(u16::MAX as usize) as u16;
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
            status.actual_hz = 0.0;
            status.transfer_rate_hz = 0.0;
            status.queue_fill = 0;
            status.last_batch_cycles = 0;
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
            status.actual_hz = 0.0;
            status.transfer_rate_hz = 0.0;
            status.queue_fill = 0;
            status.last_batch_at_ms = 0;
            status.last_batch_cycles = 0;
            status.sequence = 0;
            status.dropped_samples = 0;
            status.words_per_cycle = config.words_per_cycle;
            status.min_batch_cycles = config.min_batch_cycles;
            status.max_wait_us = config.max_wait_us;
            status.vericomm_clock_high_delay = config.vericomm_clock_high_delay;
            status.vericomm_clock_low_delay = config.vericomm_clock_low_delay;
            status.configured_signal_count = config
                .input_signal_order
                .iter()
                .chain(config.output_signal_order.iter())
                .filter(|signal| !signal.trim().is_empty())
                .count()
                .min(u16::MAX as usize) as u16;
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
            status.actual_hz = 0.0;
            status.transfer_rate_hz = 0.0;
            status.sequence = 0;
            status.dropped_samples = 0;
            status.queue_fill = 0;
            status.last_batch_at_ms = 0;
            status.last_batch_cycles = 0;
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
            HardwareActionV1::ClearCanvasDevices => self.apply_state_update(app, reason, |state| {
                state.canvas_devices.clear();
            }),
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

                    state.canvas_devices[target_index]
                        .state
                        .set_single_signal(signal_name);
                    Self::reconcile_bound_signal(state, target_index);
                })
            }
            HardwareActionV1::BindCanvasSignalSlot {
                id,
                slot_index,
                signal_name,
            } => self.apply_state_update(app, reason, |state| {
                let Some(target_index) = Self::find_canvas_device_index(state, &id) else {
                    return;
                };

                let slot_index = usize::from(slot_index);
                state.canvas_devices[target_index]
                    .state
                    .set_slot_signal(slot_index, signal_name);
            }),
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

                    let Some(signal) = source.state.single_signal().map(ToOwned::to_owned) else {
                        return;
                    };

                    let driven_level = source.state.driven_signal_level();
                    Self::propagate_signal_to_subscribers(
                        state,
                        source_index,
                        &signal,
                        driven_level,
                    );
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
}
