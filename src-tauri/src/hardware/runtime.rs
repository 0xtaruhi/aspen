use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

use super::driver;
use super::types::{
    CanvasDeviceType, HardwareActionV1, HardwareArtifactSnapshot, HardwareEventReason,
    HardwareEventV1, HardwarePhase, HardwareStateV1,
};

#[derive(Default)]
pub struct HardwareRuntime {
    state: Mutex<HardwareStateV1>,
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
        matches!(device_type, CanvasDeviceType::Switch)
    }

    fn device_receives_signal(device_type: CanvasDeviceType) -> bool {
        matches!(device_type, CanvasDeviceType::Led)
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
