use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

use crate::hardware::types::{CanvasDeviceSnapshot, CanvasMemoryMode};

const MAX_MEMORY_ADDRESS_WIDTH: usize = 16;

#[derive(Clone)]
pub(super) struct MatrixKeypadRuntimeState {
    pub rows: usize,
    pub columns: usize,
    pub active_low: bool,
    pub active_rows: Vec<bool>,
}

#[derive(Clone)]
pub(super) struct MemoryRuntimeState {
    pub mode: CanvasMemoryMode,
    pub address_width: usize,
    pub data_width: usize,
    pub words: Vec<u16>,
    pub address: usize,
    pub chip_selected: bool,
    pub read_enabled: bool,
    pub output_word: u16,
}

fn matrix_keypad_registry() -> &'static Mutex<HashMap<String, Arc<Mutex<MatrixKeypadRuntimeState>>>>
{
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<Mutex<MatrixKeypadRuntimeState>>>>> =
        OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn memory_registry() -> &'static Mutex<HashMap<String, Arc<Mutex<MemoryRuntimeState>>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<Mutex<MemoryRuntimeState>>>>> =
        OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn matrix_keypad_shared_state(
    device: &CanvasDeviceSnapshot,
) -> Arc<Mutex<MatrixKeypadRuntimeState>> {
    let (rows, columns) = device.state.matrix_dimensions().unwrap_or((4, 4));
    let active_low = matches!(
        device.state.config,
        crate::hardware::types::CanvasDeviceConfigSnapshot::MatrixKeypad {
            active_low: true,
            ..
        }
    );
    let mut registry = matrix_keypad_registry()
        .lock()
        .expect("matrix keypad registry mutex");
    let shared = registry
        .entry(device.id.clone())
        .or_insert_with(|| {
            Arc::new(Mutex::new(MatrixKeypadRuntimeState {
                rows,
                columns,
                active_low,
                active_rows: vec![active_low; rows],
            }))
        })
        .clone();
    drop(registry);

    if let Ok(mut state) = shared.lock() {
        let geometry_changed = state.rows != rows || state.columns != columns;
        let polarity_changed = state.active_low != active_low;
        state.rows = rows;
        state.columns = columns;
        state.active_low = active_low;
        if geometry_changed || polarity_changed {
            state.active_rows.resize(rows, active_low);
            if geometry_changed || polarity_changed {
                state.active_rows.fill(active_low);
            }
        }
    }

    shared
}

pub(super) fn memory_shared_state(device: &CanvasDeviceSnapshot) -> Arc<Mutex<MemoryRuntimeState>> {
    let (mode, address_width, data_width) =
        device
            .state
            .memory_config()
            .unwrap_or((CanvasMemoryMode::Ram, 8, 8));
    let word_count = 1usize << address_width.min(MAX_MEMORY_ADDRESS_WIDTH);
    let mut words = device.state.memory_words().to_vec();
    if words.len() < word_count {
        words.resize(word_count, 0);
    } else if words.len() > word_count {
        words.truncate(word_count);
    }

    let mut registry = memory_registry().lock().expect("memory registry mutex");
    let shared = registry
        .entry(device.id.clone())
        .or_insert_with(|| {
            Arc::new(Mutex::new(MemoryRuntimeState {
                mode,
                address_width,
                data_width,
                output_word: words.first().copied().unwrap_or(0),
                words: words.clone(),
                address: 0,
                chip_selected: false,
                read_enabled: false,
            }))
        })
        .clone();
    drop(registry);

    if let Ok(mut state) = shared.lock() {
        state.mode = mode;
        state.address_width = address_width;
        state.data_width = data_width;
        state.words = words;
        state.address = state.address.min(state.words.len().saturating_sub(1));
        state.output_word = state.words.get(state.address).copied().unwrap_or(0);
    }

    shared
}
