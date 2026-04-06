use std::collections::HashMap;

use crate::hardware::types::{CanvasDeviceSnapshot, CanvasDeviceType};

use super::input::{compile_single_bit_input, InputDeviceEncoder};
use super::output::{
    compile_led_matrix_output, compile_led_output, compile_segment_display_output,
    compile_vga_display_output, OutputDeviceDecoder,
};

#[derive(Clone, Copy, Default)]
pub(super) struct DeviceCapabilities {
    pub drives_signal: bool,
    pub receives_signal: bool,
}

pub(super) type SignalIndexLookup<'a> = HashMap<&'a str, usize>;
pub(super) type InputCompiler = for<'a> fn(
    device: &CanvasDeviceSnapshot,
    device_index: usize,
    signal_indices: &SignalIndexLookup<'a>,
) -> Option<Box<dyn InputDeviceEncoder>>;
pub(super) type OutputCompiler = for<'a> fn(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'a>,
) -> Option<Box<dyn OutputDeviceDecoder>>;

#[derive(Clone, Copy)]
struct DeviceRegistration {
    device_type: CanvasDeviceType,
    capabilities: DeviceCapabilities,
    input_compiler: Option<InputCompiler>,
    output_compiler: Option<OutputCompiler>,
}

const DEVICE_REGISTRATIONS: [DeviceRegistration; 12] = [
    DeviceRegistration {
        device_type: CanvasDeviceType::Led,
        capabilities: DeviceCapabilities {
            drives_signal: false,
            receives_signal: true,
        },
        input_compiler: None,
        output_compiler: Some(compile_led_output),
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::Switch,
        capabilities: DeviceCapabilities {
            drives_signal: true,
            receives_signal: false,
        },
        input_compiler: Some(compile_single_bit_input),
        output_compiler: None,
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::Button,
        capabilities: DeviceCapabilities {
            drives_signal: true,
            receives_signal: false,
        },
        input_compiler: Some(compile_single_bit_input),
        output_compiler: None,
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::Keypad,
        capabilities: DeviceCapabilities {
            drives_signal: true,
            receives_signal: false,
        },
        input_compiler: Some(compile_single_bit_input),
        output_compiler: None,
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::SmallKeypad,
        capabilities: DeviceCapabilities {
            drives_signal: true,
            receives_signal: false,
        },
        input_compiler: Some(compile_single_bit_input),
        output_compiler: None,
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::RotaryButton,
        capabilities: DeviceCapabilities {
            drives_signal: true,
            receives_signal: false,
        },
        input_compiler: Some(compile_single_bit_input),
        output_compiler: None,
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::Ps2Keyboard,
        capabilities: DeviceCapabilities {
            drives_signal: true,
            receives_signal: false,
        },
        input_compiler: Some(compile_single_bit_input),
        output_compiler: None,
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::TextLcd,
        capabilities: DeviceCapabilities {
            drives_signal: false,
            receives_signal: true,
        },
        input_compiler: None,
        output_compiler: None,
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::GraphicLcd,
        capabilities: DeviceCapabilities {
            drives_signal: false,
            receives_signal: true,
        },
        input_compiler: None,
        output_compiler: None,
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::VgaDisplay,
        capabilities: DeviceCapabilities {
            drives_signal: false,
            receives_signal: true,
        },
        input_compiler: None,
        output_compiler: Some(compile_vga_display_output),
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::SegmentDisplay,
        capabilities: DeviceCapabilities {
            drives_signal: false,
            receives_signal: true,
        },
        input_compiler: None,
        output_compiler: Some(compile_segment_display_output),
    },
    DeviceRegistration {
        device_type: CanvasDeviceType::LedMatrix,
        capabilities: DeviceCapabilities {
            drives_signal: false,
            receives_signal: true,
        },
        input_compiler: None,
        output_compiler: Some(compile_led_matrix_output),
    },
];

fn device_registration(device_type: CanvasDeviceType) -> Option<&'static DeviceRegistration> {
    DEVICE_REGISTRATIONS
        .iter()
        .find(|registration| registration.device_type == device_type)
}

pub(super) fn capabilities_for_device_type(device_type: CanvasDeviceType) -> DeviceCapabilities {
    device_registration(device_type)
        .map(|registration| registration.capabilities)
        .unwrap_or_default()
}

pub(super) fn input_compiler_for_device_type(
    device_type: CanvasDeviceType,
) -> Option<InputCompiler> {
    device_registration(device_type).and_then(|registration| registration.input_compiler)
}

pub(super) fn output_compiler_for_device_type(
    device_type: CanvasDeviceType,
) -> Option<OutputCompiler> {
    device_registration(device_type).and_then(|registration| registration.output_compiler)
}
