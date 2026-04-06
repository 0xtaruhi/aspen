use std::{
    collections::VecDeque,
    hash::{Hash, Hasher},
    sync::{Arc, Mutex},
};

use crate::hardware::types::{
    CanvasDeviceSnapshot, CanvasMemoryMode, CanvasUartMode, HardwareStateV1,
};

use super::*;
use super::{
    registry::{input_compiler_for_device_type, SignalIndexLookup},
    shared::{
        matrix_keypad_shared_state, memory_shared_state, MatrixKeypadRuntimeState,
        MemoryRuntimeState,
    },
};

pub(super) trait InputDeviceEncoder: Send {
    fn encode_cycle(&self, state: &HardwareStateV1, cycle_index: usize, frame_words: &mut [u16]);
}

struct SingleBitInputEncoder {
    device_index: usize,
    signal_index: usize,
}

struct BitsetInputEncoder {
    device_index: usize,
    signal_indices: Vec<Option<usize>>,
}

struct QuadratureEncoderInputEncoder {
    device_index: usize,
    signal_indices: Vec<Option<usize>>,
}

struct SerialLineInputEncoder {
    signal_index: usize,
    waveform: Mutex<VecDeque<bool>>,
}

struct MatrixKeypadInputEncoder {
    device_index: usize,
    column_signal_indices: Vec<Option<usize>>,
    shared: Arc<Mutex<MatrixKeypadRuntimeState>>,
}

struct MemoryInputEncoder {
    data_signal_indices: Vec<Option<usize>>,
    shared: Arc<Mutex<MemoryRuntimeState>>,
}

impl HardwareRuntime {
    pub(super) fn input_encoder_signature(state: &HardwareStateV1, signal_order: &[String]) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        signal_order.hash(&mut hasher);
        state.canvas_devices.len().hash(&mut hasher);
        for device in &state.canvas_devices {
            device.id.hash(&mut hasher);
            device.r#type.hash(&mut hasher);
            device.state.binding.hash(&mut hasher);
            device.state.config.hash(&mut hasher);
            device.state.data.hash(&mut hasher);
        }
        hasher.finish()
    }

    pub(super) fn compile_input_encoders(
        state: &HardwareStateV1,
        signal_order: &[String],
    ) -> Vec<Box<dyn InputDeviceEncoder>> {
        let signal_indices = signal_order
            .iter()
            .enumerate()
            .map(|(index, signal)| (signal.as_str(), index))
            .collect::<SignalIndexLookup<'_>>();

        let mut encoders = Vec::new();
        for (device_index, device) in state.canvas_devices.iter().enumerate() {
            let Some(compiler) = input_compiler_for_device_type(device.r#type) else {
                continue;
            };

            if let Some(encoder) = compiler(device, device_index, &signal_indices) {
                encoders.push(encoder);
            }
        }

        encoders
    }

    pub(super) fn fill_write_buffer(
        state: &HardwareStateV1,
        encoders: &[Box<dyn InputDeviceEncoder>],
        write_buffer: &mut [u16],
        words_per_cycle: usize,
        batch_cycles: usize,
    ) {
        write_buffer.fill(0);

        for cycle_index in 0..batch_cycles {
            let start = cycle_index * words_per_cycle;
            let end = start + words_per_cycle;
            let frame_words = &mut write_buffer[start..end];
            frame_words.fill(0);
            for encoder in encoders {
                encoder.encode_cycle(state, cycle_index, frame_words);
            }
        }
    }
}

fn set_signal_value(frame_words: &mut [u16], signal_index: usize, value: bool) {
    if !value {
        return;
    }

    let word_index = signal_index / 16;
    let bit_index = signal_index % 16;
    if let Some(word) = frame_words.get_mut(word_index) {
        *word |= 1u16 << bit_index;
    }
}

pub(super) fn compile_single_bit_input(
    device: &CanvasDeviceSnapshot,
    device_index: usize,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn InputDeviceEncoder>> {
    let signal_index = device
        .state
        .single_signal()
        .and_then(|signal| signal_indices.get(signal).copied())?;

    Some(Box::new(SingleBitInputEncoder {
        device_index,
        signal_index,
    }))
}

pub(super) fn compile_bitset_input(
    device: &CanvasDeviceSnapshot,
    device_index: usize,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn InputDeviceEncoder>> {
    let slot_signals = device.state.slot_signals();
    if slot_signals.is_empty() {
        return None;
    }

    let mapped = slot_signals
        .iter()
        .map(|signal| {
            signal
                .as_deref()
                .and_then(|name| signal_indices.get(name).copied())
        })
        .collect::<Vec<_>>();

    if !mapped.iter().any(Option::is_some) {
        return None;
    }

    Some(Box::new(BitsetInputEncoder {
        device_index,
        signal_indices: mapped,
    }))
}

pub(super) fn compile_quadrature_encoder_input(
    device: &CanvasDeviceSnapshot,
    device_index: usize,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn InputDeviceEncoder>> {
    let slot_signals = device.state.slot_signals();
    if slot_signals.is_empty() {
        return None;
    }

    let mapped = slot_signals
        .iter()
        .map(|signal| {
            signal
                .as_deref()
                .and_then(|name| signal_indices.get(name).copied())
        })
        .collect::<Vec<_>>();
    if !mapped.iter().any(Option::is_some) {
        return None;
    }

    Some(Box::new(QuadratureEncoderInputEncoder {
        device_index,
        signal_indices: mapped,
    }))
}

pub(super) fn compile_uart_terminal_input(
    device: &CanvasDeviceSnapshot,
    _device_index: usize,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn InputDeviceEncoder>> {
    let (cycles_per_bit, mode) = device.state.uart_config()?;
    if matches!(mode, CanvasUartMode::Tx) {
        return None;
    }

    let slot_signals = device.state.slot_signals();
    let rx_slot_index = 0;
    let signal_index = slot_signals
        .get(rx_slot_index)
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied())?;

    let waveform = build_uart_waveform(device.state.queued_bytes(), cycles_per_bit.max(1));
    Some(Box::new(SerialLineInputEncoder {
        signal_index,
        waveform: Mutex::new(waveform),
    }))
}

pub(super) fn compile_matrix_keypad_input(
    device: &CanvasDeviceSnapshot,
    device_index: usize,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn InputDeviceEncoder>> {
    let (rows, columns) = device.state.matrix_dimensions()?;
    let slot_signals = device.state.slot_signals();
    let column_signal_indices = (0..columns)
        .map(|index| {
            slot_signals
                .get(rows + index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    if !column_signal_indices.iter().any(Option::is_some) {
        return None;
    }

    Some(Box::new(MatrixKeypadInputEncoder {
        device_index,
        column_signal_indices,
        shared: matrix_keypad_shared_state(device),
    }))
}

pub(super) fn compile_memory_input(
    device: &CanvasDeviceSnapshot,
    _device_index: usize,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn InputDeviceEncoder>> {
    let (mode, address_width, data_width) = device.state.memory_config()?;
    let slot_signals = device.state.slot_signals();
    let data_out_offset = if matches!(mode, CanvasMemoryMode::Ram) {
        address_width + data_width
    } else {
        address_width
    };
    let data_signal_indices = (0..data_width)
        .map(|index| {
            slot_signals
                .get(data_out_offset + index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    if !data_signal_indices.iter().any(Option::is_some) {
        return None;
    }

    Some(Box::new(MemoryInputEncoder {
        data_signal_indices,
        shared: memory_shared_state(device),
    }))
}

impl InputDeviceEncoder for SingleBitInputEncoder {
    fn encode_cycle(&self, state: &HardwareStateV1, _cycle_index: usize, frame_words: &mut [u16]) {
        let Some(device) = state.canvas_devices.get(self.device_index) else {
            return;
        };
        set_signal_value(
            frame_words,
            self.signal_index,
            device.state.driven_signal_level(),
        );
    }
}

impl InputDeviceEncoder for BitsetInputEncoder {
    fn encode_cycle(&self, state: &HardwareStateV1, _cycle_index: usize, frame_words: &mut [u16]) {
        let Some(device) = state.canvas_devices.get(self.device_index) else {
            return;
        };
        let bits = device.state.bitset();
        for (bit_index, signal_index) in self.signal_indices.iter().enumerate() {
            if let Some(signal_index) = signal_index {
                let value = bits.get(bit_index).copied().unwrap_or(false);
                set_signal_value(frame_words, *signal_index, value);
            }
        }
    }
}

impl InputDeviceEncoder for QuadratureEncoderInputEncoder {
    fn encode_cycle(&self, state: &HardwareStateV1, _cycle_index: usize, frame_words: &mut [u16]) {
        let Some(device) = state.canvas_devices.get(self.device_index) else {
            return;
        };
        let (phase, button_pressed) = device.state.quadrature_encoder_data();
        let phase_bits = match phase % 4 {
            0 => [false, false],
            1 => [true, false],
            2 => [true, true],
            _ => [false, true],
        };

        if let Some(Some(signal_index)) = self.signal_indices.first() {
            set_signal_value(frame_words, *signal_index, phase_bits[0]);
        }
        if let Some(Some(signal_index)) = self.signal_indices.get(1) {
            set_signal_value(frame_words, *signal_index, phase_bits[1]);
        }
        if let Some(Some(signal_index)) = self.signal_indices.get(2) {
            set_signal_value(frame_words, *signal_index, button_pressed);
        }
    }
}

impl InputDeviceEncoder for SerialLineInputEncoder {
    fn encode_cycle(&self, _state: &HardwareStateV1, _cycle_index: usize, frame_words: &mut [u16]) {
        let value = self
            .waveform
            .lock()
            .ok()
            .and_then(|mut waveform| waveform.pop_front())
            .unwrap_or(true);
        set_signal_value(frame_words, self.signal_index, value);
    }
}

impl InputDeviceEncoder for MatrixKeypadInputEncoder {
    fn encode_cycle(&self, state: &HardwareStateV1, _cycle_index: usize, frame_words: &mut [u16]) {
        let Some(device) = state.canvas_devices.get(self.device_index) else {
            return;
        };
        let (pressed_row, pressed_column) = device.state.matrix_keypad_data();
        let Ok(shared) = self.shared.lock() else {
            return;
        };
        let pressed_row = pressed_row.filter(|row| *row < shared.rows);
        let pressed_column = pressed_column.filter(|column| *column < shared.columns);
        let idle_level = shared.active_low;
        let active_level = !shared.active_low;
        let selected_row_level = !shared.active_low;
        let row_is_selected = pressed_row
            .and_then(|row| shared.active_rows.get(row).copied())
            .map(|level| level == selected_row_level)
            .unwrap_or(false);

        for (column_index, signal_index) in self.column_signal_indices.iter().enumerate() {
            let Some(signal_index) = signal_index else {
                continue;
            };
            let level = if row_is_selected && pressed_column == Some(column_index) {
                active_level
            } else {
                idle_level
            };
            set_signal_value(frame_words, *signal_index, level);
        }
    }
}

impl InputDeviceEncoder for MemoryInputEncoder {
    fn encode_cycle(&self, _state: &HardwareStateV1, _cycle_index: usize, frame_words: &mut [u16]) {
        let Ok(shared) = self.shared.lock() else {
            return;
        };
        if !(shared.chip_selected && shared.read_enabled) {
            return;
        }
        let active_bits = shared.data_width.min(self.data_signal_indices.len());
        for (bit_index, signal_index) in self
            .data_signal_indices
            .iter()
            .take(active_bits)
            .enumerate()
        {
            let Some(signal_index) = signal_index else {
                continue;
            };
            let value = ((shared.output_word >> bit_index) & 1) != 0;
            set_signal_value(frame_words, *signal_index, value);
        }
    }
}

fn build_uart_waveform(bytes: &[u8], cycles_per_bit: usize) -> VecDeque<bool> {
    let mut waveform = VecDeque::new();
    for &byte in bytes {
        for _ in 0..cycles_per_bit {
            waveform.push_back(false);
        }
        for bit_index in 0..8 {
            let bit = ((byte >> bit_index) & 1) != 0;
            for _ in 0..cycles_per_bit {
                waveform.push_back(bit);
            }
        }
        for _ in 0..cycles_per_bit {
            waveform.push_back(true);
        }
        for _ in 0..cycles_per_bit {
            waveform.push_back(true);
        }
    }
    waveform
}
