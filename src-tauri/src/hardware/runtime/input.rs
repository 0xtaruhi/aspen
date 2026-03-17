use std::hash::{Hash, Hasher};

use crate::hardware::types::{CanvasDeviceSnapshot, HardwareStateV1};

use super::registry::{input_compiler_for_device_type, SignalIndexLookup};
use super::*;

pub(super) trait InputDeviceEncoder: Send {
    fn encode_frame(&self, state: &HardwareStateV1, frame_words: &mut [u16]);
}

struct SingleBitInputEncoder {
    device_index: usize,
    word_index: usize,
    bit_mask: u16,
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

    pub(super) fn fill_write_frame(
        state: &HardwareStateV1,
        encoders: &[Box<dyn InputDeviceEncoder>],
        frame_words: &mut [u16],
    ) {
        frame_words.fill(0);

        for encoder in encoders {
            encoder.encode_frame(state, frame_words);
        }
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
        word_index: signal_index / 16,
        bit_mask: 1u16 << (signal_index % 16),
    }))
}

impl InputDeviceEncoder for SingleBitInputEncoder {
    fn encode_frame(&self, state: &HardwareStateV1, frame_words: &mut [u16]) {
        let Some(device) = state.canvas_devices.get(self.device_index) else {
            return;
        };
        if !device.state.driven_signal_level() {
            return;
        }

        if let Some(word) = frame_words.get_mut(self.word_index) {
            *word |= self.bit_mask;
        }
    }
}
