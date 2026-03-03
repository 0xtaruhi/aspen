use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};

use super::driver;
use super::types::{
    CanvasDeviceType, HardwareActionV1, HardwareArtifactSnapshot, HardwareDataBatchV1,
    HardwareDataStreamStatusV1, HardwareEventReason, HardwareEventV1, HardwarePhase,
    HardwareSignalAggregateV1, HardwareStateV1,
};

const DATA_SAMPLE_INTERVAL: Duration = Duration::from_millis(5);
const DATA_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const DATA_QUEUE_CAPACITY: usize = 120;
const DATA_MAX_UPDATES_PER_BATCH: usize = 256;

struct HardwareDataStreamSession {
    stop_flag: Arc<AtomicBool>,
    handle: thread::JoinHandle<()>,
}

struct HardwareDataSample {
    values: Vec<(String, bool)>,
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

    fn into_signal(self, signal: String) -> HardwareSignalAggregateV1 {
        let high_ratio = if self.total_count == 0 {
            0.0
        } else {
            self.high_count as f32 / self.total_count as f32
        };

        HardwareSignalAggregateV1 {
            signal,
            latest: self.latest,
            high_ratio,
            edge_count: self.edge_count,
        }
    }
}

pub struct HardwareRuntime {
    state: Mutex<HardwareStateV1>,
    data_stream: Mutex<Option<HardwareDataStreamSession>>,
    data_stream_status: Mutex<HardwareDataStreamStatusV1>,
}

impl Default for HardwareRuntime {
    fn default() -> Self {
        Self {
            state: Mutex::new(HardwareStateV1::default()),
            data_stream: Mutex::new(None),
            data_stream_status: Mutex::new(HardwareDataStreamStatusV1 {
                running: false,
                sequence: 0,
                dropped_samples: 0,
                queue_fill: 0,
                queue_capacity: DATA_QUEUE_CAPACITY as u16,
                last_batch_at_ms: 0,
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

    pub fn start_data_stream(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
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

            let handle = thread::Builder::new()
                .name("aspen-hardware-data-stream".to_string())
                .spawn(move || {
                    runtime.run_data_stream_loop(app_handle, stop_for_thread);
                })
                .map_err(|err| err.to_string())?;

            *guard = Some(HardwareDataStreamSession { stop_flag, handle });
        }

        self.update_data_stream_status(|status| {
            status.running = true;
            status.queue_fill = 0;
            status.queue_capacity = DATA_QUEUE_CAPACITY as u16;
            status.last_batch_at_ms = 0;
            status.sequence = 0;
            status.dropped_samples = 0;
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

    fn run_data_stream_loop(self: Arc<Self>, app: AppHandle, stop_flag: Arc<AtomicBool>) {
        let mut queue: VecDeque<HardwareDataSample> = VecDeque::with_capacity(DATA_QUEUE_CAPACITY);
        let mut dropped_samples = 0_u64;
        let mut sequence = 0_u64;
        let mut next_sample_tick = Instant::now();
        let mut next_flush_tick = Instant::now();

        while !stop_flag.load(Ordering::Relaxed) {
            let now = Instant::now();

            while now >= next_sample_tick {
                let sample = self.collect_data_sample();
                if queue.len() >= DATA_QUEUE_CAPACITY {
                    queue.pop_front();
                    dropped_samples = dropped_samples.saturating_add(1);
                }
                queue.push_back(sample);
                next_sample_tick += DATA_SAMPLE_INTERVAL;
            }

            if now >= next_flush_tick {
                if !queue.is_empty() {
                    let queue_fill = queue.len() as u16;
                    let updates = Self::aggregate_data_samples(&mut queue);
                    if !updates.is_empty() {
                        sequence = sequence.saturating_add(1);
                        let generated_at_ms = Self::now_millis();
                        let batch = HardwareDataBatchV1 {
                            version: 1,
                            sequence,
                            generated_at_ms,
                            dropped_samples,
                            queue_fill,
                            queue_capacity: DATA_QUEUE_CAPACITY as u16,
                            updates,
                        };

                        let _ = app.emit("hardware:data_batch", batch.clone());
                        let _ = self.update_data_stream_status(|status| {
                            status.running = true;
                            status.sequence = batch.sequence;
                            status.dropped_samples = batch.dropped_samples;
                            status.queue_fill = 0;
                            status.queue_capacity = batch.queue_capacity;
                            status.last_batch_at_ms = batch.generated_at_ms;
                        });
                    }
                }

                next_flush_tick += DATA_FLUSH_INTERVAL;
            }

            thread::sleep(Duration::from_millis(1));
        }
    }

    fn collect_data_sample(&self) -> HardwareDataSample {
        let values = match self.state.lock() {
            Ok(state) => {
                let mut by_signal = HashMap::<String, bool>::new();

                for device in &state.canvas_devices {
                    if !Self::device_drives_signal(device.r#type) {
                        continue;
                    }

                    if let Some(signal) = &device.state.bound_signal {
                        by_signal.insert(signal.clone(), device.state.is_on);
                    }
                }

                for device in &state.canvas_devices {
                    if !Self::device_receives_signal(device.r#type) {
                        continue;
                    }

                    if let Some(signal) = &device.state.bound_signal {
                        by_signal
                            .entry(signal.clone())
                            .or_insert(device.state.is_on);
                    }
                }

                let mut values: Vec<(String, bool)> = by_signal.into_iter().collect();
                values.sort_by(|left, right| left.0.cmp(&right.0));
                values
            }
            Err(_) => Vec::new(),
        };

        HardwareDataSample { values }
    }

    fn aggregate_data_samples(
        queue: &mut VecDeque<HardwareDataSample>,
    ) -> Vec<HardwareSignalAggregateV1> {
        let mut aggregated: HashMap<String, HardwareDataAggregate> = HashMap::new();

        while let Some(sample) = queue.pop_front() {
            for (signal, value) in sample.values {
                aggregated
                    .entry(signal)
                    .or_insert_with(HardwareDataAggregate::new)
                    .ingest(value);
            }
        }

        let mut updates: Vec<HardwareSignalAggregateV1> = aggregated
            .into_iter()
            .map(|(signal, aggregate)| aggregate.into_signal(signal))
            .collect();
        updates.sort_by(|left, right| left.signal.cmp(&right.signal));
        updates.truncate(DATA_MAX_UPDATES_PER_BATCH);
        updates
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::types::{CanvasDeviceSnapshot, CanvasDeviceStateSnapshot};

    fn sample(values: &[(&str, bool)]) -> HardwareDataSample {
        HardwareDataSample {
            values: values
                .iter()
                .map(|(signal, value)| ((*signal).to_string(), *value))
                .collect(),
        }
    }

    #[test]
    fn aggregate_data_samples_tracks_latest_ratio_and_edges() {
        let mut queue = VecDeque::from([
            sample(&[("sig_a", false), ("sig_b", true)]),
            sample(&[("sig_a", true), ("sig_b", true)]),
            sample(&[("sig_a", true), ("sig_b", false)]),
        ]);

        let updates = HardwareRuntime::aggregate_data_samples(&mut queue);
        assert_eq!(updates.len(), 2);

        let sig_a = updates.iter().find(|item| item.signal == "sig_a").unwrap();
        assert!(sig_a.latest);
        assert_eq!(sig_a.edge_count, 1);
        assert!((sig_a.high_ratio - (2.0 / 3.0)).abs() < 0.0001);

        let sig_b = updates.iter().find(|item| item.signal == "sig_b").unwrap();
        assert!(!sig_b.latest);
        assert_eq!(sig_b.edge_count, 1);
        assert!((sig_b.high_ratio - (2.0 / 3.0)).abs() < 0.0001);

        assert!(queue.is_empty());
    }

    #[test]
    fn aggregate_data_samples_caps_payload_size() {
        let mut values = Vec::new();
        for index in 0..(DATA_MAX_UPDATES_PER_BATCH + 10) {
            values.push((format!("sig_{index}"), (index % 2) == 0));
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

        let sample = runtime.collect_data_sample();
        let by_signal: HashMap<String, bool> = sample.values.into_iter().collect();

        assert_eq!(by_signal.get("sig_driven"), Some(&true));
        assert_eq!(by_signal.get("sig_receiver"), Some(&true));
    }
}
