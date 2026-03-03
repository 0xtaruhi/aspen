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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CanvasDeviceType {
    Led,
    Switch,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CanvasDeviceStateSnapshot {
    pub is_on: bool,
    pub color: Option<String>,
    pub bound_signal: Option<String>,
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
                        bound_signal: None,
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
                        bound_signal: None,
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
    SetCanvasDevicePosition {
        id: String,
        x: f64,
        y: f64,
    },
    BindCanvasSignal {
        id: String,
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
