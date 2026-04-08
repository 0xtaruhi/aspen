use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

use crate::hardware::types::CanvasDeviceSnapshot;

#[derive(Clone)]
pub(super) struct MatrixKeypadRuntimeState {
    pub rows: usize,
    pub columns: usize,
    pub active_low: bool,
    pub active_rows: Vec<bool>,
}

fn matrix_keypad_registry() -> &'static Mutex<HashMap<String, Arc<Mutex<MatrixKeypadRuntimeState>>>>
{
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<Mutex<MatrixKeypadRuntimeState>>>>> =
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
