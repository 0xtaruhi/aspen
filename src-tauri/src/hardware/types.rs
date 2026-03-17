use serde::{Deserialize, Serialize};
use vlfd_rs::Config;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HardwarePhase {
    Idle,
    Probing,
    DeviceReady,
    Generating,
    BitstreamReady,
    Programming,
    Programmed,
    DeviceDisconnected,
    Error,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareConfigSnapshot {
    pub smims_version: String,
    pub fifo_words: u16,
    pub flash_total_block: u16,
    pub flash_block_size: u16,
    pub flash_cluster_size: u16,
    pub vericomm_enabled: bool,
    pub programmed: bool,
    pub pcb_connected: bool,
}

impl From<Config> for HardwareConfigSnapshot {
    fn from(config: Config) -> Self {
        Self {
            smims_version: format!(
                "{}.{}.{}",
                config.smims_major_version(),
                config.smims_sub_version(),
                config.smims_patch_version()
            ),
            fifo_words: config.fifo_size(),
            flash_total_block: config.flash_total_block(),
            flash_block_size: config.flash_block_size(),
            flash_cluster_size: config.flash_cluster_size(),
            vericomm_enabled: config.vericomm_ability(),
            programmed: config.is_programmed(),
            pcb_connected: config.is_pcb_connected(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareDeviceSnapshot {
    pub board: String,
    pub description: String,
    pub config: HardwareConfigSnapshot,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareArtifactSnapshot {
    pub path: String,
    pub bytes: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CanvasDeviceType {
    Led,
    Switch,
    Button,
    Keypad,
    SmallKeypad,
    RotaryButton,
    Ps2Keyboard,
    TextLcd,
    GraphicLcd,
    SegmentDisplay,
    LedMatrix,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Hash)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CanvasDeviceBindingSnapshot {
    Single {
        signal: Option<String>,
    },
    Slots {
        #[serde(default)]
        signals: Vec<Option<String>>,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Hash)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CanvasDeviceConfigSnapshot {
    None,
    Button {
        #[serde(default)]
        active_low: bool,
    },
    SegmentDisplay {
        digits: u16,
        #[serde(default)]
        active_low: bool,
    },
    LedMatrix {
        rows: u16,
        columns: u16,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CanvasDeviceStateSnapshot {
    pub is_on: bool,
    pub color: Option<String>,
    pub binding: CanvasDeviceBindingSnapshot,
    pub config: CanvasDeviceConfigSnapshot,
}

impl CanvasDeviceStateSnapshot {
    pub fn single_signal(&self) -> Option<&str> {
        match &self.binding {
            CanvasDeviceBindingSnapshot::Single { signal } => signal.as_deref(),
            CanvasDeviceBindingSnapshot::Slots { .. } => None,
        }
    }

    pub fn set_single_signal(&mut self, next_signal: Option<String>) {
        if let CanvasDeviceBindingSnapshot::Single { signal } = &mut self.binding {
            *signal = next_signal;
        }
    }

    pub fn slot_signals(&self) -> &[Option<String>] {
        match &self.binding {
            CanvasDeviceBindingSnapshot::Slots { signals } => signals,
            CanvasDeviceBindingSnapshot::Single { .. } => &[],
        }
    }

    pub fn set_slot_signal(&mut self, slot_index: usize, next_signal: Option<String>) {
        if let CanvasDeviceBindingSnapshot::Slots { signals } = &mut self.binding {
            if signals.len() <= slot_index {
                signals.resize(slot_index + 1, None);
            }
            signals[slot_index] = next_signal;
        }
    }

    pub fn segment_digits(&self) -> Option<usize> {
        match self.config {
            CanvasDeviceConfigSnapshot::SegmentDisplay { digits, .. } => Some(usize::from(digits)),
            _ => None,
        }
    }

    pub fn button_active_low(&self) -> bool {
        matches!(
            self.config,
            CanvasDeviceConfigSnapshot::Button { active_low: true }
        )
    }

    pub fn segment_active_low(&self) -> bool {
        matches!(
            self.config,
            CanvasDeviceConfigSnapshot::SegmentDisplay {
                active_low: true,
                ..
            }
        )
    }

    pub fn driven_signal_level(&self) -> bool {
        if self.button_active_low() {
            !self.is_on
        } else {
            self.is_on
        }
    }

    pub fn matrix_dimensions(&self) -> Option<(usize, usize)> {
        match self.config {
            CanvasDeviceConfigSnapshot::LedMatrix { rows, columns } => {
                Some((usize::from(rows), usize::from(columns)))
            }
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CanvasDeviceSnapshot {
    pub id: String,
    pub r#type: CanvasDeviceType,
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub state: CanvasDeviceStateSnapshot,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareStateV1 {
    pub version: u8,
    pub phase: HardwarePhase,
    pub device: Option<HardwareDeviceSnapshot>,
    pub artifact: Option<HardwareArtifactSnapshot>,
    pub canvas_devices: Vec<CanvasDeviceSnapshot>,
    pub last_error: Option<String>,
    pub op_id: Option<String>,
    pub updated_at_ms: u64,
}

impl Default for HardwareStateV1 {
    fn default() -> Self {
        Self {
            version: 1,
            phase: HardwarePhase::Idle,
            device: None,
            artifact: None,
            canvas_devices: vec![
                CanvasDeviceSnapshot {
                    id: "1".to_string(),
                    r#type: CanvasDeviceType::Led,
                    x: 100.0,
                    y: 100.0,
                    label: "LED 0".to_string(),
                    state: CanvasDeviceStateSnapshot {
                        is_on: false,
                        color: Some("red".to_string()),
                        binding: CanvasDeviceBindingSnapshot::Single { signal: None },
                        config: CanvasDeviceConfigSnapshot::None,
                    },
                },
                CanvasDeviceSnapshot {
                    id: "2".to_string(),
                    r#type: CanvasDeviceType::Switch,
                    x: 300.0,
                    y: 100.0,
                    label: "Switch 0".to_string(),
                    state: CanvasDeviceStateSnapshot {
                        is_on: false,
                        color: None,
                        binding: CanvasDeviceBindingSnapshot::Single { signal: None },
                        config: CanvasDeviceConfigSnapshot::None,
                    },
                },
            ],
            last_error: None,
            op_id: None,
            updated_at_ms: 0,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum HardwareEventReason {
    Action,
    Hotplug,
    Startup,
    Recovery,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareEventV1 {
    pub version: u8,
    pub state: HardwareStateV1,
    pub reason: HardwareEventReason,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareSignalAggregateByIdV1 {
    pub signal_id: u16,
    pub latest: bool,
    pub high_ratio: f32,
    pub edge_count: u16,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareDataBatchBinaryV1 {
    pub version: u8,
    pub payload: Vec<u8>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareDataSignalCatalogEntryV1 {
    pub signal_id: u16,
    pub signal: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareDataSignalCatalogV1 {
    pub version: u8,
    pub generated_at_ms: u64,
    pub entries: Vec<HardwareDataSignalCatalogEntryV1>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareCanvasDeviceTelemetryEntryV1 {
    pub device_id: String,
    pub latest: bool,
    pub high_ratio: f32,
    pub segment_mask: Option<u16>,
    pub digit_segment_masks: Vec<u16>,
    pub pixel_columns: u16,
    pub pixel_rows: u16,
    pub pixels: Vec<u8>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareCanvasDeviceTelemetryV1 {
    pub version: u8,
    pub generated_at_ms: u64,
    pub devices: Vec<HardwareCanvasDeviceTelemetryEntryV1>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareDataStreamStatusV1 {
    pub running: bool,
    pub target_hz: f64,
    pub actual_hz: f64,
    pub transfer_rate_hz: f64,
    pub sequence: u64,
    pub dropped_samples: u64,
    pub queue_fill: u16,
    pub queue_capacity: u16,
    pub last_batch_at_ms: u64,
    pub last_batch_cycles: u16,
    pub words_per_cycle: u16,
    pub min_batch_cycles: u16,
    pub max_wait_us: u32,
    pub configured_signal_count: u16,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareDataStreamConfigV1 {
    pub target_hz: f64,
    pub input_signal_order: Vec<String>,
    pub output_signal_order: Vec<String>,
    pub words_per_cycle: u16,
    pub min_batch_cycles: u16,
    pub max_wait_us: u32,
}

impl Default for HardwareDataStreamConfigV1 {
    fn default() -> Self {
        Self {
            target_hz: 1.0,
            input_signal_order: Vec::new(),
            output_signal_order: Vec::new(),
            words_per_cycle: 4,
            min_batch_cycles: 128,
            max_wait_us: 2_000,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HardwareActionV1 {
    Probe,
    GenerateBitstream {
        source_name: String,
        source_code: String,
        output_path: Option<String>,
    },
    ProgramBitstream {
        bitstream_path: Option<String>,
    },
    UpsertCanvasDevice {
        device: CanvasDeviceSnapshot,
    },
    RemoveCanvasDevice {
        id: String,
    },
    ClearCanvasDevices,
    SetCanvasDevicePosition {
        id: String,
        x: f64,
        y: f64,
    },
    BindCanvasSignal {
        id: String,
        signal_name: Option<String>,
    },
    BindCanvasSignalSlot {
        id: String,
        slot_index: u16,
        signal_name: Option<String>,
    },
    SetCanvasSwitchState {
        id: String,
        is_on: bool,
    },
    ClearError,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BitstreamGenerationResult {
    pub path: String,
    pub bytes: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SynthesisSourceFileV1 {
    pub path: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SynthesisRequestV1 {
    pub op_id: String,
    pub project_name: Option<String>,
    pub project_dir: Option<String>,
    pub top_module: String,
    pub files: Vec<SynthesisSourceFileV1>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SynthesisLogChunkV1 {
    pub version: u8,
    pub op_id: String,
    pub chunk: String,
    pub generated_at_ms: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SynthesisCellTypeCountV1 {
    pub cell_type: String,
    pub count: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SynthesisStatsV1 {
    pub wire_count: u64,
    pub wire_bits: u64,
    pub public_wire_count: u64,
    pub public_wire_bits: u64,
    pub memory_count: u64,
    pub memory_bits: u64,
    pub cell_count: u64,
    pub sequential_cell_count: u64,
    pub cell_type_counts: Vec<SynthesisCellTypeCountV1>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SynthesisTopPortV1 {
    pub name: String,
    pub direction: String,
    pub width: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SynthesisArtifactsV1 {
    pub work_dir: String,
    pub script_path: Option<String>,
    pub netlist_json_path: Option<String>,
    pub edif_path: Option<String>,
    #[serde(default)]
    pub flow_revision: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SynthesisReportV1 {
    pub version: u8,
    pub op_id: String,
    pub success: bool,
    pub top_module: String,
    pub source_count: u16,
    pub tool_path: String,
    pub elapsed_ms: u64,
    pub warnings: u32,
    pub errors: u32,
    pub log: String,
    pub stats: SynthesisStatsV1,
    pub top_ports: Vec<SynthesisTopPortV1>,
    pub artifacts: Option<SynthesisArtifactsV1>,
    pub generated_at_ms: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImplementationStageKindV1 {
    Yosys,
    Map,
    Pack,
    Place,
    Route,
    Sta,
    Bitgen,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImplementationPlaceModeV1 {
    #[serde(alias = "timing-driven")]
    TimingDriven,
    #[serde(alias = "bounding-box")]
    BoundingBox,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImplementationRouteModeV1 {
    #[serde(alias = "timing-driven")]
    TimingDriven,
    #[serde(alias = "direct-search")]
    DirectSearch,
    #[serde(alias = "breadth-first")]
    BreadthFirst,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImplementationRequestV1 {
    pub op_id: String,
    pub project_name: String,
    pub project_dir: Option<String>,
    pub top_module: String,
    pub target_device_id: String,
    pub constraint_xml: String,
    pub place_mode: ImplementationPlaceModeV1,
    pub route_mode: ImplementationRouteModeV1,
    pub synthesized_edif_path: Option<String>,
    pub files: Vec<SynthesisSourceFileV1>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImplementationLogChunkV1 {
    pub version: u8,
    pub op_id: String,
    pub stage: ImplementationStageKindV1,
    pub chunk: String,
    pub generated_at_ms: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ImplementationArtifactsV1 {
    pub work_dir: String,
    pub constraint_path: String,
    pub edif_path: Option<String>,
    pub map_path: Option<String>,
    pub pack_path: Option<String>,
    pub place_path: Option<String>,
    pub route_path: Option<String>,
    pub sta_output_path: Option<String>,
    pub sta_report_path: Option<String>,
    pub bitstream_path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImplementationStageResultV1 {
    pub stage: ImplementationStageKindV1,
    pub success: bool,
    pub optional: bool,
    pub elapsed_ms: u64,
    pub exit_code: Option<i32>,
    pub log_path: Option<String>,
    pub output_path: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImplementationReportV1 {
    pub version: u8,
    pub op_id: String,
    pub success: bool,
    pub timing_success: bool,
    pub top_module: String,
    pub source_count: u16,
    pub elapsed_ms: u64,
    pub log: String,
    pub stages: Vec<ImplementationStageResultV1>,
    pub artifacts: ImplementationArtifactsV1,
    pub timing_report: String,
    pub generated_at_ms: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HardwareStatus {
    pub board: String,
    pub description: String,
    pub config: HardwareConfigSnapshot,
}

impl HardwareStatus {
    pub fn from_state(state: &HardwareStateV1) -> Option<Self> {
        let device = state.device.as_ref()?;
        Some(Self {
            board: device.board.clone(),
            description: device.description.clone(),
            config: device.config.clone(),
        })
    }
}
