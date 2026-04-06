use std::{
    hash::{Hash, Hasher},
    sync::{Arc, Mutex},
};

use crate::hardware::types::{
    CanvasDeviceSnapshot, CanvasHd44780BusMode, CanvasMemoryMode, CanvasUartMode,
    CanvasVgaColorMode, HardwareCanvasDeviceTelemetryEntryV1, HardwareCanvasDeviceTelemetryV1,
    HardwareStateV1,
};

use super::registry::{output_compiler_for_device_type, SignalIndexLookup};
use super::shared::{
    matrix_keypad_shared_state, memory_shared_state, MatrixKeypadRuntimeState, MemoryRuntimeState,
};
use super::*;

pub(super) trait OutputDeviceDecoder: Send {
    fn ingest_cycle(&mut self, cycle: &[u16]);
    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1;
}

struct LedOutputDecoder {
    device_id: String,
    signal_index: usize,
    latest: bool,
    high_count: u32,
    total_count: u32,
}

struct SegmentDisplayOutputDecoder {
    device_id: String,
    digit_count: usize,
    active_low: bool,
    segment_indices: [Option<usize>; 8],
    digit_indices: Vec<Option<usize>>,
    sample_counts: Vec<u32>,
    segment_on_counts: Vec<[u32; 8]>,
    latest_masks: Vec<u16>,
}

struct LedBarOutputDecoder {
    device_id: String,
    active_low: bool,
    signal_indices: Vec<Option<usize>>,
    latest_bits: Vec<u8>,
    high_count: u32,
    total_count: u32,
}

struct AudioPwmOutputDecoder {
    device_id: String,
    signal_index: usize,
    latest: bool,
    previous: bool,
    high_count: u32,
    total_count: u32,
    edge_count: u32,
    samples_since_rising: u32,
    has_rising_edge: bool,
    period_samples: f32,
}

struct LedMatrixOutputDecoder {
    device_id: String,
    rows: usize,
    columns: usize,
    row_indices: Vec<Option<usize>>,
    column_indices: Vec<Option<usize>>,
    active_rows: Vec<usize>,
    active_columns: Vec<usize>,
    row_samples: Vec<u32>,
    pixel_on_counts: Vec<u32>,
}

struct VgaDisplayOutputDecoder {
    device_id: String,
    hsync_index: usize,
    vsync_index: usize,
    red_indices: Vec<Option<usize>>,
    green_indices: Vec<Option<usize>>,
    blue_indices: Vec<Option<usize>>,
    target_columns: usize,
    target_rows: usize,
    prev_hsync_active: bool,
    prev_vsync_active: bool,
    current_line: Vec<u8>,
    captured_lines: Vec<Vec<u8>>,
    frame_pixels: Vec<u8>,
    last_row_window: Option<(usize, usize)>,
    last_column_window: Option<(usize, usize)>,
}

struct UartTerminalOutputDecoder {
    device_id: String,
    signal_index: usize,
    cycles_per_bit: usize,
    state: UartDecodeState,
    text_log: String,
}

struct UartDecodeState {
    receiving: bool,
    countdown: usize,
    bit_index: usize,
    byte: u8,
}

struct MatrixKeypadOutputDecoder {
    device_id: String,
    row_signal_indices: Vec<Option<usize>>,
    latest_rows: Vec<u8>,
    shared: Arc<Mutex<MatrixKeypadRuntimeState>>,
}

struct MemoryOutputDecoder {
    device_id: String,
    address_signal_indices: Vec<Option<usize>>,
    data_in_signal_indices: Vec<Option<usize>>,
    chip_select_index: Option<usize>,
    output_enable_index: Option<usize>,
    write_enable_index: Option<usize>,
    preview_offset: usize,
    shared: Arc<Mutex<MemoryRuntimeState>>,
    selected_count: u32,
    total_count: u32,
}

struct Hd44780LcdOutputDecoder {
    device_id: String,
    columns: usize,
    rows: usize,
    bus_mode: CanvasHd44780BusMode,
    rs_index: usize,
    e_index: usize,
    rw_index: Option<usize>,
    data_indices: Vec<Option<usize>>,
    prev_enable: bool,
    pending_high_nibble: Option<u8>,
    ddram: Vec<u8>,
    cursor_addr: u8,
}

const VGA_MAX_CAPTURE_COLUMNS: usize = 1024;
const VGA_MAX_CAPTURE_ROWS: usize = 768;
const MEMORY_PREVIEW_WORDS: usize = 16;

impl HardwareRuntime {
    pub(super) fn device_snapshot_interval_for_state(state: &HardwareStateV1) -> Duration {
        let mut interval = DEVICE_SNAPSHOT_INTERVAL;

        for device in &state.canvas_devices {
            let Some((columns, rows, _)) = device.state.vga_display_config() else {
                continue;
            };

            let pixel_count = columns.saturating_mul(rows);
            let next_interval = if pixel_count >= 640 * 480 {
                DEVICE_SNAPSHOT_INTERVAL_SLOW
            } else if pixel_count >= 320 * 240 {
                DEVICE_SNAPSHOT_INTERVAL_MEDIUM
            } else {
                DEVICE_SNAPSHOT_INTERVAL
            };

            if next_interval > interval {
                interval = next_interval;
            }
        }

        interval
    }

    pub(super) fn output_decoder_signature(
        state: &HardwareStateV1,
        signal_order: &[String],
    ) -> u64 {
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

    pub(super) fn compile_output_decoders(
        state: &HardwareStateV1,
        signal_order: &[String],
    ) -> Vec<Box<dyn OutputDeviceDecoder>> {
        let signal_indices = signal_order
            .iter()
            .enumerate()
            .map(|(index, signal)| (signal.as_str(), index))
            .collect::<SignalIndexLookup<'_>>();

        let mut decoders = Vec::new();
        for device in &state.canvas_devices {
            let Some(compiler) = output_compiler_for_device_type(device.r#type) else {
                continue;
            };

            if let Some(decoder) = compiler(device, &signal_indices) {
                decoders.push(decoder);
            }
        }

        decoders
    }

    pub(super) fn ingest_output_batch(
        read_buffer: &[u16],
        words_per_cycle: usize,
        decoders: &mut [Box<dyn OutputDeviceDecoder>],
    ) {
        for cycle in read_buffer.chunks_exact(words_per_cycle) {
            for decoder in decoders.iter_mut() {
                decoder.ingest_cycle(cycle);
            }
        }
    }

    pub(super) fn flush_output_decoders(
        decoders: &mut [Box<dyn OutputDeviceDecoder>],
        generated_at_ms: u64,
    ) -> HardwareCanvasDeviceTelemetryV1 {
        let devices = decoders
            .iter_mut()
            .map(|decoder| decoder.flush_snapshot())
            .collect();

        HardwareCanvasDeviceTelemetryV1 {
            version: 1,
            generated_at_ms,
            devices,
        }
    }

    fn segment_digit_count(device: &CanvasDeviceSnapshot) -> usize {
        device.state.segment_digits().unwrap_or(1).max(1)
    }

    fn matrix_dimensions(device: &CanvasDeviceSnapshot) -> (usize, usize) {
        let default_rows = 8;
        let default_columns = default_rows;
        let (rows, columns) = device
            .state
            .matrix_dimensions()
            .unwrap_or((default_rows, default_columns));
        let rows = rows.max(1);
        let columns = columns.max(1);

        (rows, columns)
    }

    fn vga_display_config(device: &CanvasDeviceSnapshot) -> (usize, usize, CanvasVgaColorMode) {
        let default_columns = 320;
        let default_rows = 240;
        let default_color_mode = CanvasVgaColorMode::Rgb332;
        let (columns, rows, color_mode) = device.state.vga_display_config().unwrap_or((
            default_columns,
            default_rows,
            default_color_mode,
        ));
        (columns.max(1), rows.max(1), color_mode)
    }
}

fn empty_device_snapshot(device_id: &str) -> HardwareCanvasDeviceTelemetryEntryV1 {
    HardwareCanvasDeviceTelemetryEntryV1 {
        device_id: device_id.to_string(),
        latest: false,
        high_ratio: 0.0,
        segment_mask: None,
        digit_segment_masks: Vec::new(),
        pixel_columns: 0,
        pixel_rows: 0,
        pixels: Vec::new(),
        bit_values: Vec::new(),
        text_lines: Vec::new(),
        text_log: String::new(),
        memory_words: Vec::new(),
        sample_values: Vec::new(),
        audio_edge_count: 0,
        audio_sample_count: 0,
        audio_period_samples: 0.0,
        memory_word_count: 0,
        memory_preview_start: 0,
        memory_address: 0,
        memory_output_word: 0,
    }
}

fn sample_bus_value(signal_indices: &[Option<usize>], cycle: &[u16]) -> u16 {
    signal_indices
        .iter()
        .enumerate()
        .fold(0_u16, |value, (bit_index, signal_index)| {
            let bit_is_set = signal_index
                .map(|signal_index| read_signal_value(cycle, signal_index))
                .unwrap_or(false);
            if bit_is_set {
                value | (1_u16 << bit_index)
            } else {
                value
            }
        })
}

pub(super) fn compile_led_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let signal_index = device
        .state
        .single_signal()
        .and_then(|signal| signal_indices.get(signal).copied())?;

    Some(Box::new(LedOutputDecoder {
        device_id: device.id.clone(),
        signal_index,
        latest: false,
        high_count: 0,
        total_count: 0,
    }))
}

pub(super) fn compile_led_bar_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let width = device.state.dip_switch_width()?;
    let active_low = matches!(
        device.state.config,
        crate::hardware::types::CanvasDeviceConfigSnapshot::LedBar {
            active_low: true,
            ..
        }
    );
    let slot_signals = device.state.slot_signals();
    let mapped = (0..width)
        .map(|index| {
            slot_signals
                .get(index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    if !mapped.iter().any(Option::is_some) {
        return None;
    }

    Some(Box::new(LedBarOutputDecoder {
        device_id: device.id.clone(),
        active_low,
        latest_bits: vec![0; mapped.len()],
        signal_indices: mapped,
        high_count: 0,
        total_count: 0,
    }))
}

pub(super) fn compile_uart_terminal_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let (cycles_per_bit, mode) = device.state.uart_config()?;
    if matches!(mode, CanvasUartMode::Rx) {
        return None;
    }

    let slot_signals = device.state.slot_signals();
    let tx_slot_index = if matches!(mode, CanvasUartMode::Tx) {
        0
    } else {
        1
    };
    let signal_index = slot_signals
        .get(tx_slot_index)
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied())?;

    Some(Box::new(UartTerminalOutputDecoder {
        device_id: device.id.clone(),
        signal_index,
        cycles_per_bit: cycles_per_bit.max(1),
        state: UartDecodeState {
            receiving: false,
            countdown: 0,
            bit_index: 0,
            byte: 0,
        },
        text_log: String::new(),
    }))
}

pub(super) fn compile_matrix_keypad_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let (rows, _) = device.state.matrix_dimensions()?;
    let slot_signals = device.state.slot_signals();
    let row_signal_indices = (0..rows)
        .map(|index| {
            slot_signals
                .get(index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    if !row_signal_indices.iter().any(Option::is_some) {
        return None;
    }

    Some(Box::new(MatrixKeypadOutputDecoder {
        device_id: device.id.clone(),
        latest_rows: vec![0; row_signal_indices.len()],
        row_signal_indices,
        shared: matrix_keypad_shared_state(device),
    }))
}

pub(super) fn compile_hd44780_lcd_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let (columns, rows, bus_mode) = device.state.hd44780_config()?;
    let slot_signals = device.state.slot_signals();
    let rs_index = slot_signals
        .first()
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied())?;
    let e_index = slot_signals
        .get(1)
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied())?;
    let rw_index = slot_signals
        .get(2)
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied());
    let data_bits = if matches!(bus_mode, CanvasHd44780BusMode::EightBit) {
        8
    } else {
        4
    };
    let data_indices = (0..data_bits)
        .map(|offset| {
            slot_signals
                .get(3 + offset)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    if !data_indices.iter().any(Option::is_some) {
        return None;
    }

    Some(Box::new(Hd44780LcdOutputDecoder {
        device_id: device.id.clone(),
        columns,
        rows,
        bus_mode,
        rs_index,
        e_index,
        rw_index,
        data_indices,
        prev_enable: false,
        pending_high_nibble: None,
        ddram: vec![b' '; 0x68],
        cursor_addr: 0,
    }))
}

pub(super) fn compile_memory_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let (mode, address_width, data_width) = device.state.memory_config()?;
    let slot_signals = device.state.slot_signals();
    let address_signal_indices = (0..address_width)
        .map(|index| {
            slot_signals
                .get(index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    let data_in_signal_indices = if matches!(mode, CanvasMemoryMode::Ram) {
        (0..data_width)
            .map(|index| {
                slot_signals
                    .get(address_width + index)
                    .and_then(|signal| signal.as_deref())
                    .and_then(|signal| signal_indices.get(signal).copied())
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let controls_offset = if matches!(mode, CanvasMemoryMode::Ram) {
        address_width + (2 * data_width)
    } else {
        address_width + data_width
    };
    let chip_select_index = slot_signals
        .get(controls_offset)
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied());
    let output_enable_index = slot_signals
        .get(controls_offset + 1)
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied());
    let write_enable_index = if matches!(mode, CanvasMemoryMode::Ram) {
        slot_signals
            .get(controls_offset + 2)
            .and_then(|signal| signal.as_deref())
            .and_then(|signal| signal_indices.get(signal).copied())
    } else {
        None
    };

    if !address_signal_indices.iter().any(Option::is_some)
        && !data_in_signal_indices.iter().any(Option::is_some)
        && chip_select_index.is_none()
        && output_enable_index.is_none()
        && write_enable_index.is_none()
    {
        return None;
    }

    Some(Box::new(MemoryOutputDecoder {
        device_id: device.id.clone(),
        address_signal_indices,
        data_in_signal_indices,
        chip_select_index,
        output_enable_index,
        write_enable_index,
        preview_offset: device.state.memory_preview_offset(),
        shared: memory_shared_state(device),
        selected_count: 0,
        total_count: 0,
    }))
}

pub(super) fn compile_audio_pwm_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let signal_index = device
        .state
        .single_signal()
        .and_then(|signal| signal_indices.get(signal).copied())?;

    Some(Box::new(AudioPwmOutputDecoder {
        device_id: device.id.clone(),
        signal_index,
        latest: false,
        previous: false,
        high_count: 0,
        total_count: 0,
        edge_count: 0,
        samples_since_rising: 0,
        has_rising_edge: false,
        period_samples: 0.0,
    }))
}

pub(super) fn compile_segment_display_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let digit_count = HardwareRuntime::segment_digit_count(device);
    let slot_signals = device.state.slot_signals();
    let mut segment_indices = [None; 8];
    for (segment_index, signal_index) in segment_indices.iter_mut().enumerate() {
        *signal_index = slot_signals
            .get(segment_index)
            .and_then(|signal| signal.as_deref())
            .and_then(|signal| signal_indices.get(signal).copied());
    }
    if !segment_indices.iter().any(Option::is_some) {
        return None;
    }

    let digit_indices = if digit_count <= 1 {
        Vec::new()
    } else {
        (0..digit_count)
            .map(|digit_index| {
                slot_signals
                    .get(8 + digit_index)
                    .and_then(|signal| signal.as_deref())
                    .and_then(|signal| signal_indices.get(signal).copied())
            })
            .collect()
    };

    Some(Box::new(SegmentDisplayOutputDecoder {
        device_id: device.id.clone(),
        digit_count,
        active_low: device.state.segment_active_low(),
        segment_indices,
        digit_indices,
        sample_counts: vec![0; digit_count],
        segment_on_counts: vec![[0; 8]; digit_count],
        latest_masks: vec![0; digit_count],
    }))
}

pub(super) fn compile_led_matrix_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let (rows, columns) = HardwareRuntime::matrix_dimensions(device);
    let slot_signals = device.state.slot_signals();
    let row_indices = (0..rows)
        .map(|row_index| {
            slot_signals
                .get(row_index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    let column_indices = (0..columns)
        .map(|column_index| {
            slot_signals
                .get(rows + column_index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();

    if !row_indices.iter().any(Option::is_some) || !column_indices.iter().any(Option::is_some) {
        return None;
    }

    Some(Box::new(LedMatrixOutputDecoder {
        device_id: device.id.clone(),
        rows,
        columns,
        row_indices,
        column_indices,
        active_rows: Vec::with_capacity(rows),
        active_columns: Vec::with_capacity(columns),
        row_samples: vec![0; rows],
        pixel_on_counts: vec![0; rows * columns],
    }))
}

pub(super) fn compile_vga_display_output(
    device: &CanvasDeviceSnapshot,
    signal_indices: &SignalIndexLookup<'_>,
) -> Option<Box<dyn OutputDeviceDecoder>> {
    let (target_columns, target_rows, color_mode) = HardwareRuntime::vga_display_config(device);
    let (red_bits, green_bits, blue_bits) =
        VgaDisplayOutputDecoder::color_mode_bit_counts(color_mode);
    let slot_signals = device.state.slot_signals();
    let hsync_index = slot_signals
        .first()
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied())?;
    let vsync_index = slot_signals
        .get(1)
        .and_then(|signal| signal.as_deref())
        .and_then(|signal| signal_indices.get(signal).copied())?;

    let mut slot_offset = 2;
    let red_indices = (0..red_bits)
        .map(|slot_index| {
            slot_signals
                .get(slot_offset + slot_index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    slot_offset += red_bits;
    let green_indices = (0..green_bits)
        .map(|slot_index| {
            slot_signals
                .get(slot_offset + slot_index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();
    slot_offset += green_bits;
    let blue_indices = (0..blue_bits)
        .map(|slot_index| {
            slot_signals
                .get(slot_offset + slot_index)
                .and_then(|signal| signal.as_deref())
                .and_then(|signal| signal_indices.get(signal).copied())
        })
        .collect::<Vec<_>>();

    if !red_indices.iter().any(Option::is_some)
        && !green_indices.iter().any(Option::is_some)
        && !blue_indices.iter().any(Option::is_some)
    {
        return None;
    }

    Some(Box::new(VgaDisplayOutputDecoder {
        device_id: device.id.clone(),
        hsync_index,
        vsync_index,
        red_indices,
        green_indices,
        blue_indices,
        target_columns,
        target_rows,
        prev_hsync_active: false,
        prev_vsync_active: false,
        current_line: Vec::new(),
        captured_lines: Vec::new(),
        frame_pixels: vec![0; target_columns * target_rows],
        last_row_window: None,
        last_column_window: None,
    }))
}

impl OutputDeviceDecoder for LedOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let value = read_signal_value(cycle, self.signal_index);
        self.latest = value;
        self.total_count = self.total_count.saturating_add(1);
        if value {
            self.high_count = self.high_count.saturating_add(1);
        }
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let total_count = self.total_count.max(1);
        let mut entry = empty_device_snapshot(&self.device_id);
        entry.latest = self.latest;
        entry.high_ratio = self.high_count as f32 / total_count as f32;
        self.latest = false;
        self.high_count = 0;
        self.total_count = 0;
        entry
    }
}

impl OutputDeviceDecoder for LedBarOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let mut any_on = false;
        for (bit_index, signal_index) in self.signal_indices.iter().enumerate() {
            let raw_value = signal_index
                .map(|signal_index| read_signal_value(cycle, signal_index))
                .unwrap_or(false);
            let logical_on = if self.active_low {
                !raw_value
            } else {
                raw_value
            };
            self.latest_bits[bit_index] = u8::from(logical_on);
            if logical_on {
                any_on = true;
            }
        }
        self.total_count = self.total_count.saturating_add(1);
        if any_on {
            self.high_count = self.high_count.saturating_add(1);
        }
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let total_count = self.total_count.max(1);
        let mut entry = empty_device_snapshot(&self.device_id);
        entry.latest = self.latest_bits.iter().any(|value| *value != 0);
        entry.high_ratio = self.high_count as f32 / total_count as f32;
        entry.bit_values = self.latest_bits.clone();
        self.high_count = 0;
        self.total_count = 0;
        entry
    }
}

impl OutputDeviceDecoder for AudioPwmOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let value = read_signal_value(cycle, self.signal_index);
        self.latest = value;
        self.total_count = self.total_count.saturating_add(1);
        self.samples_since_rising = self.samples_since_rising.saturating_add(1);
        if value {
            self.high_count = self.high_count.saturating_add(1);
        }

        if value != self.previous {
            self.edge_count = self.edge_count.saturating_add(1);
        }

        if value && !self.previous {
            if self.has_rising_edge && self.samples_since_rising > 0 {
                let period = self.samples_since_rising as f32;
                self.period_samples = if self.period_samples <= 0.0 {
                    period
                } else {
                    (self.period_samples * 0.75) + (period * 0.25)
                };
            }
            self.samples_since_rising = 0;
            self.has_rising_edge = true;
        }

        self.previous = value;
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let total_count = self.total_count.max(1);
        let mut entry = empty_device_snapshot(&self.device_id);
        entry.latest = self.latest;
        entry.high_ratio = self.high_count as f32 / total_count as f32;
        entry.audio_edge_count = self.edge_count;
        entry.audio_sample_count = self.total_count;
        entry.audio_period_samples = if self.edge_count == 0
            && self.samples_since_rising as f32 > self.period_samples * 3.0
        {
            0.0
        } else {
            self.period_samples
        };

        self.high_count = 0;
        self.total_count = 0;
        self.edge_count = 0;
        entry
    }
}

impl OutputDeviceDecoder for SegmentDisplayOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let mut segment_mask = 0_u16;
        for (segment_index, signal_index) in self.segment_indices.iter().enumerate() {
            let Some(signal_index) = signal_index else {
                continue;
            };
            let signal_value = read_signal_value(cycle, *signal_index);
            let segment_is_on = if self.active_low {
                !signal_value
            } else {
                signal_value
            };
            if segment_is_on {
                segment_mask |= 1u16 << segment_index;
            }
        }

        if self.digit_count <= 1 {
            self.sample_counts[0] = self.sample_counts[0].saturating_add(1);
            self.latest_masks[0] = segment_mask;
            for segment_index in 0..8 {
                if (segment_mask & (1u16 << segment_index)) != 0 {
                    self.segment_on_counts[0][segment_index] =
                        self.segment_on_counts[0][segment_index].saturating_add(1);
                }
            }
            return;
        }

        for digit_index in 0..self.digit_count {
            let Some(signal_index) = self.digit_indices.get(digit_index).copied().flatten() else {
                continue;
            };
            let digit_selected = if self.active_low {
                !read_signal_value(cycle, signal_index)
            } else {
                read_signal_value(cycle, signal_index)
            };
            if !digit_selected {
                continue;
            }

            self.sample_counts[digit_index] = self.sample_counts[digit_index].saturating_add(1);
            self.latest_masks[digit_index] = segment_mask;
            for segment_index in 0..8 {
                if (segment_mask & (1u16 << segment_index)) != 0 {
                    self.segment_on_counts[digit_index][segment_index] =
                        self.segment_on_counts[digit_index][segment_index].saturating_add(1);
                }
            }
        }
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let total_samples = self
            .sample_counts
            .iter()
            .copied()
            .fold(0_u32, u32::saturating_add);
        let mut total_on_counts = 0_u32;
        let mut digit_masks = Vec::with_capacity(self.digit_count);

        for digit_index in 0..self.digit_count {
            let sample_count = self.sample_counts[digit_index];
            let mut digit_mask = 0_u16;
            if sample_count > 0 {
                for segment_index in 0..8 {
                    let on_count = self.segment_on_counts[digit_index][segment_index];
                    total_on_counts = total_on_counts.saturating_add(on_count);
                    if on_count.saturating_mul(2) >= sample_count {
                        digit_mask |= 1u16 << segment_index;
                    }
                }
            }
            digit_masks.push(digit_mask);
        }

        let entry = HardwareCanvasDeviceTelemetryEntryV1 {
            device_id: self.device_id.clone(),
            latest: digit_masks.iter().any(|mask| *mask != 0)
                || self.latest_masks.iter().any(|mask| *mask != 0),
            high_ratio: if total_samples == 0 {
                0.0
            } else {
                total_on_counts as f32 / (total_samples as f32 * 8.0)
            },
            segment_mask: digit_masks.first().copied(),
            digit_segment_masks: digit_masks,
            pixel_columns: 0,
            pixel_rows: 0,
            pixels: Vec::new(),
            bit_values: Vec::new(),
            text_lines: Vec::new(),
            text_log: String::new(),
            memory_words: Vec::new(),
            sample_values: Vec::new(),
            audio_edge_count: 0,
            audio_sample_count: 0,
            audio_period_samples: 0.0,
            memory_word_count: 0,
            memory_preview_start: 0,
            memory_address: 0,
            memory_output_word: 0,
        };
        self.sample_counts.fill(0);
        for segment_counts in &mut self.segment_on_counts {
            segment_counts.fill(0);
        }
        self.latest_masks.fill(0);
        entry
    }
}

impl OutputDeviceDecoder for LedMatrixOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        self.active_rows.clear();
        self.active_columns.clear();

        for (row_index, signal_index) in self.row_indices.iter().enumerate() {
            let Some(signal_index) = signal_index else {
                continue;
            };
            if read_signal_value(cycle, *signal_index) {
                self.active_rows.push(row_index);
            }
        }

        for (column_index, signal_index) in self.column_indices.iter().enumerate() {
            let Some(signal_index) = signal_index else {
                continue;
            };
            if read_signal_value(cycle, *signal_index) {
                self.active_columns.push(column_index);
            }
        }

        if self.active_rows.is_empty() || self.active_columns.is_empty() {
            return;
        }

        for &row_index in &self.active_rows {
            self.row_samples[row_index] = self.row_samples[row_index].saturating_add(1);
            let row_offset = row_index * self.columns;
            for &column_index in &self.active_columns {
                let pixel_index = row_offset + column_index;
                self.pixel_on_counts[pixel_index] =
                    self.pixel_on_counts[pixel_index].saturating_add(1);
            }
        }
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let mut pixels = vec![0_u8; self.rows * self.columns];
        let mut latest = false;
        let mut total_intensity = 0_f32;

        for row_index in 0..self.rows {
            let row_samples = self.row_samples[row_index];
            for column_index in 0..self.columns {
                let pixel_index = row_index * self.columns + column_index;
                let intensity = if row_samples == 0 {
                    0
                } else {
                    ((self.pixel_on_counts[pixel_index] as f32 / row_samples as f32) * 255.0)
                        .round()
                        .clamp(0.0, 255.0) as u8
                };
                pixels[pixel_index] = intensity;
                if intensity > 0 {
                    latest = true;
                }
                total_intensity += intensity as f32 / 255.0;
            }
        }

        let entry = HardwareCanvasDeviceTelemetryEntryV1 {
            device_id: self.device_id.clone(),
            latest,
            high_ratio: if pixels.is_empty() {
                0.0
            } else {
                total_intensity / pixels.len() as f32
            },
            segment_mask: None,
            digit_segment_masks: Vec::new(),
            pixel_columns: self.columns as u16,
            pixel_rows: self.rows as u16,
            pixels,
            bit_values: Vec::new(),
            text_lines: Vec::new(),
            text_log: String::new(),
            memory_words: Vec::new(),
            sample_values: Vec::new(),
            audio_edge_count: 0,
            audio_sample_count: 0,
            audio_period_samples: 0.0,
            memory_word_count: 0,
            memory_preview_start: 0,
            memory_address: 0,
            memory_output_word: 0,
        };
        self.row_samples.fill(0);
        self.pixel_on_counts.fill(0);
        entry
    }
}

impl VgaDisplayOutputDecoder {
    fn color_mode_bit_counts(color_mode: CanvasVgaColorMode) -> (usize, usize, usize) {
        match color_mode {
            CanvasVgaColorMode::Mono => (0, 0, 1),
            CanvasVgaColorMode::Rgb111 => (1, 1, 1),
            CanvasVgaColorMode::Rgb332 => (3, 3, 2),
            CanvasVgaColorMode::Rgb444 => (4, 4, 4),
            CanvasVgaColorMode::Rgb565 => (5, 6, 5),
            CanvasVgaColorMode::Rgb888 => (8, 8, 8),
        }
    }

    fn sample_color_bits(indices: &[Option<usize>], cycle: &[u16]) -> u8 {
        indices
            .iter()
            .enumerate()
            .fold(0_u8, |value, (bit_index, signal_index)| {
                let bit_is_set = signal_index
                    .map(|signal_index| read_signal_value(cycle, signal_index))
                    .unwrap_or(false);
                if bit_is_set {
                    value | (1_u8 << bit_index)
                } else {
                    value
                }
            })
    }

    fn sample_rgb332(&self, cycle: &[u16]) -> u8 {
        let red = Self::sample_color_bits(&self.red_indices, cycle);
        let green = Self::sample_color_bits(&self.green_indices, cycle);
        let blue = Self::sample_color_bits(&self.blue_indices, cycle);
        if self.red_indices.is_empty()
            && self.green_indices.is_empty()
            && !self.blue_indices.is_empty()
        {
            let on = Self::quantize_channel(blue, self.blue_indices.len(), 3);
            return (on << 5) | (on << 2) | ((on >> 1) & 0x3);
        }
        let red332 = Self::quantize_channel(red, self.red_indices.len(), 3);
        let green332 = Self::quantize_channel(green, self.green_indices.len(), 3);
        let blue332 = Self::quantize_channel(blue, self.blue_indices.len(), 2);
        (red332 << 5) | (green332 << 2) | blue332
    }

    fn quantize_channel(value: u8, input_bits: usize, output_bits: usize) -> u8 {
        if input_bits == 0 || output_bits == 0 {
            return 0;
        }

        let input_max = (1_u16 << input_bits) - 1;
        let output_max = (1_u16 << output_bits) - 1;
        (((u16::from(value) * output_max) + (input_max / 2)) / input_max) as u8
    }

    fn row_activity_score(row: &[u8]) -> u64 {
        let mut score = 0_u64;
        let mut previous = None;

        for &pixel in row {
            if pixel != 0 {
                score += 4;
            }
            if let Some(previous_pixel) = previous {
                if previous_pixel != pixel {
                    score += 1;
                }
            }
            previous = Some(pixel);
        }

        score
    }

    fn column_activity_scores(lines: &[Vec<u8>], max_width: usize) -> Vec<u64> {
        let mut scores = vec![0_u64; max_width];

        for (column_index, score) in scores.iter_mut().enumerate().take(max_width) {
            let mut previous = None;
            for row in lines {
                let pixel = row.get(column_index).copied().unwrap_or(0);
                if pixel != 0 {
                    *score += 4;
                }
                if let Some(previous_pixel) = previous {
                    if previous_pixel != pixel {
                        *score += 1;
                    }
                }
                previous = Some(pixel);
            }
        }

        scores
    }

    fn select_active_window(
        scores: &[u64],
        target_len: usize,
        previous: Option<(usize, usize)>,
    ) -> (usize, usize) {
        if scores.is_empty() || target_len == 0 {
            return (0, 0);
        }

        let span = target_len.min(scores.len());
        if span >= scores.len() {
            return (0, scores.len());
        }

        let mut window_sum = scores[..span].iter().copied().sum::<u64>();
        let mut best_sum = window_sum;
        let mut best_start = 0_usize;

        for start in 1..=(scores.len() - span) {
            window_sum = window_sum
                .saturating_sub(scores[start - 1])
                .saturating_add(scores[start + span - 1]);
            if window_sum > best_sum {
                best_sum = window_sum;
                best_start = start;
            }
        }

        let previous_start = previous
            .filter(|(start, previous_span)| {
                *previous_span == span && start.saturating_add(span) <= scores.len()
            })
            .map(|(start, _)| start);

        if best_sum == 0 {
            if let Some(start) = previous_start {
                return (start, span);
            }
            return ((scores.len() - span) / 2, span);
        }

        if let Some(start) = previous_start {
            let previous_sum = scores[start..start + span].iter().copied().sum::<u64>();
            if previous_sum == best_sum {
                return (start, span);
            }
        }

        (best_start, span)
    }

    fn finish_line(&mut self) {
        if self.current_line.is_empty() {
            return;
        }

        if self.captured_lines.len() < VGA_MAX_CAPTURE_ROWS {
            self.captured_lines
                .push(std::mem::take(&mut self.current_line));
        } else {
            self.current_line.clear();
        }
    }

    fn finalize_frame(&mut self) {
        self.finish_line();
        if self.captured_lines.is_empty() {
            return;
        }

        let source_height = self.captured_lines.len();
        let max_source_width = self.captured_lines.iter().map(Vec::len).max().unwrap_or(0);
        if max_source_width == 0 {
            self.captured_lines.clear();
            self.current_line.clear();
            return;
        }

        let row_scores = self
            .captured_lines
            .iter()
            .map(|row| Self::row_activity_score(row))
            .collect::<Vec<_>>();
        let column_scores = Self::column_activity_scores(&self.captured_lines, max_source_width);
        let (source_row_start, source_row_span) =
            Self::select_active_window(&row_scores, self.target_rows, self.last_row_window);
        let (source_column_start, source_column_span) = Self::select_active_window(
            &column_scores,
            self.target_columns,
            self.last_column_window,
        );
        self.last_row_window = Some((source_row_start, source_row_span));
        self.last_column_window = Some((source_column_start, source_column_span));

        let mut next_frame = vec![0_u8; self.target_columns * self.target_rows];
        for target_row in 0..self.target_rows {
            let source_row_index = if source_row_span == 0 {
                0
            } else {
                source_row_start + (target_row * source_row_span / self.target_rows)
            }
            .min(source_height - 1);
            let source_row = &self.captured_lines[source_row_index];
            if source_row.is_empty() {
                continue;
            }

            for target_column in 0..self.target_columns {
                let source_column_index = if source_column_span == 0 {
                    0
                } else {
                    source_column_start + (target_column * source_column_span / self.target_columns)
                };
                next_frame[target_row * self.target_columns + target_column] =
                    source_row.get(source_column_index).copied().unwrap_or(0);
            }
        }

        self.frame_pixels = next_frame;
        self.captured_lines.clear();
        self.current_line.clear();
    }
}

impl OutputDeviceDecoder for VgaDisplayOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let hsync_active = !read_signal_value(cycle, self.hsync_index);
        let vsync_active = !read_signal_value(cycle, self.vsync_index);

        if vsync_active && !self.prev_vsync_active {
            self.finalize_frame();
        } else if hsync_active && !self.prev_hsync_active && !vsync_active {
            self.finish_line();
        }

        if !vsync_active && !hsync_active && self.current_line.len() < VGA_MAX_CAPTURE_COLUMNS {
            self.current_line.push(self.sample_rgb332(cycle));
        }

        self.prev_hsync_active = hsync_active;
        self.prev_vsync_active = vsync_active;
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let lit_pixels = self
            .frame_pixels
            .iter()
            .copied()
            .filter(|pixel| *pixel != 0)
            .count();

        HardwareCanvasDeviceTelemetryEntryV1 {
            device_id: self.device_id.clone(),
            latest: lit_pixels > 0,
            high_ratio: if self.frame_pixels.is_empty() {
                0.0
            } else {
                lit_pixels as f32 / self.frame_pixels.len() as f32
            },
            segment_mask: None,
            digit_segment_masks: Vec::new(),
            pixel_columns: self.target_columns as u16,
            pixel_rows: self.target_rows as u16,
            pixels: self.frame_pixels.clone(),
            bit_values: Vec::new(),
            text_lines: Vec::new(),
            text_log: String::new(),
            memory_words: Vec::new(),
            sample_values: Vec::new(),
            audio_edge_count: 0,
            audio_sample_count: 0,
            audio_period_samples: 0.0,
            memory_word_count: 0,
            memory_preview_start: 0,
            memory_address: 0,
            memory_output_word: 0,
        }
    }
}

impl OutputDeviceDecoder for UartTerminalOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let value = read_signal_value(cycle, self.signal_index);
        if !self.state.receiving {
            if !value {
                self.state.receiving = true;
                self.state.countdown = self.cycles_per_bit + self.cycles_per_bit / 2;
                self.state.bit_index = 0;
                self.state.byte = 0;
            }
            return;
        }

        if self.state.countdown > 0 {
            self.state.countdown -= 1;
            return;
        }

        if value {
            self.state.byte |= 1 << self.state.bit_index;
        }
        self.state.bit_index += 1;
        if self.state.bit_index >= 8 {
            let next_char = if self.state.byte.is_ascii_graphic() || self.state.byte == b' ' {
                self.state.byte as char
            } else if self.state.byte == b'\n' || self.state.byte == b'\r' {
                '\n'
            } else {
                '·'
            };
            self.text_log.push(next_char);
            if self.text_log.len() > 4096 {
                let drain_len = self.text_log.len().saturating_sub(4096);
                self.text_log.drain(..drain_len);
            }
            self.state.receiving = false;
            self.state.countdown = 0;
            self.state.bit_index = 0;
            self.state.byte = 0;
            return;
        }

        self.state.countdown = self.cycles_per_bit.saturating_sub(1);
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        HardwareCanvasDeviceTelemetryEntryV1 {
            device_id: self.device_id.clone(),
            latest: !self.text_log.is_empty(),
            high_ratio: 0.0,
            segment_mask: None,
            digit_segment_masks: Vec::new(),
            pixel_columns: 0,
            pixel_rows: 0,
            pixels: Vec::new(),
            bit_values: Vec::new(),
            text_lines: Vec::new(),
            text_log: self.text_log.clone(),
            memory_words: Vec::new(),
            sample_values: Vec::new(),
            audio_edge_count: 0,
            audio_sample_count: 0,
            audio_period_samples: 0.0,
            memory_word_count: 0,
            memory_preview_start: 0,
            memory_address: 0,
            memory_output_word: 0,
        }
    }
}

impl OutputDeviceDecoder for MatrixKeypadOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let mut next_rows = Vec::with_capacity(self.row_signal_indices.len());
        for signal_index in &self.row_signal_indices {
            let value = signal_index
                .map(|signal_index| read_signal_value(cycle, signal_index))
                .unwrap_or(false);
            next_rows.push(value);
        }
        self.latest_rows = next_rows.iter().copied().map(u8::from).collect();

        if let Ok(mut shared) = self.shared.lock() {
            shared.active_rows = next_rows;
        }
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let mut entry = empty_device_snapshot(&self.device_id);
        entry.latest = self.latest_rows.iter().any(|value| *value != 0);
        entry.bit_values = self.latest_rows.clone();
        entry
    }
}

impl OutputDeviceDecoder for MemoryOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let chip_selected = self
            .chip_select_index
            .map(|signal_index| !read_signal_value(cycle, signal_index))
            .unwrap_or(true);
        let output_enabled = self
            .output_enable_index
            .map(|signal_index| !read_signal_value(cycle, signal_index))
            .unwrap_or(true);
        let write_enabled = self
            .write_enable_index
            .map(|signal_index| !read_signal_value(cycle, signal_index))
            .unwrap_or(false);

        let address = usize::from(sample_bus_value(&self.address_signal_indices, cycle));
        let data_in = sample_bus_value(&self.data_in_signal_indices, cycle);

        let Ok(mut shared) = self.shared.lock() else {
            return;
        };
        let data_width = shared.data_width.min(u16::BITS as usize);
        let data_mask = if data_width >= u16::BITS as usize {
            u16::MAX
        } else {
            ((1_u32 << data_width) - 1) as u16
        };
        let word_count = shared.words.len().max(1);
        let next_address = address.min(word_count - 1);
        shared.address = next_address;
        shared.chip_selected = chip_selected;

        if matches!(shared.mode, CanvasMemoryMode::Ram) && chip_selected && write_enabled {
            if let Some(word) = shared.words.get_mut(next_address) {
                *word = data_in & data_mask;
            }
        }

        shared.output_word = shared.words.get(next_address).copied().unwrap_or(0) & data_mask;
        shared.read_enabled = chip_selected && output_enabled && !write_enabled;

        self.total_count = self.total_count.saturating_add(1);
        if chip_selected {
            self.selected_count = self.selected_count.saturating_add(1);
        }
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let Ok(shared) = self.shared.lock() else {
            return empty_device_snapshot(&self.device_id);
        };
        let total_count = self.total_count.max(1);
        let mut entry = empty_device_snapshot(&self.device_id);
        entry.latest = shared.chip_selected;
        entry.high_ratio = self.selected_count as f32 / total_count as f32;
        let preview_start = self
            .preview_offset
            .min(shared.words.len().saturating_sub(1));
        let preview_end = shared
            .words
            .len()
            .min(preview_start.saturating_add(MEMORY_PREVIEW_WORDS));
        entry.memory_word_count = u32::try_from(shared.words.len()).unwrap_or(u32::MAX);
        entry.memory_preview_start = u32::try_from(preview_start).unwrap_or(u32::MAX);
        entry.memory_address = u32::try_from(shared.address).unwrap_or(u32::MAX);
        entry.memory_output_word = shared.output_word;
        entry.sample_values = shared.words[preview_start..preview_end].to_vec();
        self.selected_count = 0;
        self.total_count = 0;
        entry
    }
}

impl OutputDeviceDecoder for Hd44780LcdOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let enable = read_signal_value(cycle, self.e_index);
        let read_mode = self
            .rw_index
            .map(|signal_index| read_signal_value(cycle, signal_index))
            .unwrap_or(false);

        if self.prev_enable && !enable && !read_mode {
            let rs = read_signal_value(cycle, self.rs_index);
            let mut value = 0_u8;
            for (bit_index, signal_index) in self.data_indices.iter().enumerate() {
                if let Some(signal_index) = signal_index {
                    if read_signal_value(cycle, *signal_index) {
                        value |= 1 << bit_index;
                    }
                }
            }

            let maybe_byte = if matches!(self.bus_mode, CanvasHd44780BusMode::EightBit) {
                Some(value)
            } else if let Some(high_nibble) = self.pending_high_nibble.take() {
                Some((high_nibble << 4) | (value & 0x0f))
            } else {
                self.pending_high_nibble = Some(value & 0x0f);
                None
            };

            if let Some(byte) = maybe_byte {
                if rs {
                    self.write_char(byte);
                } else {
                    self.execute_command(byte);
                }
            }
        }

        self.prev_enable = enable;
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntryV1 {
        let text_lines = hd44780_text_lines(&self.ddram, self.columns, self.rows);
        HardwareCanvasDeviceTelemetryEntryV1 {
            device_id: self.device_id.clone(),
            latest: text_lines.iter().any(|line| !line.trim_end().is_empty()),
            high_ratio: 0.0,
            segment_mask: None,
            digit_segment_masks: Vec::new(),
            pixel_columns: 0,
            pixel_rows: 0,
            pixels: Vec::new(),
            bit_values: Vec::new(),
            text_lines,
            text_log: String::new(),
            memory_words: Vec::new(),
            sample_values: Vec::new(),
            audio_edge_count: 0,
            audio_sample_count: 0,
            audio_period_samples: 0.0,
            memory_word_count: 0,
            memory_preview_start: 0,
            memory_address: 0,
            memory_output_word: 0,
        }
    }
}

impl Hd44780LcdOutputDecoder {
    fn execute_command(&mut self, command: u8) {
        match command {
            0x01 => {
                self.ddram.fill(b' ');
                self.cursor_addr = 0;
            }
            0x02 => {
                self.cursor_addr = 0;
            }
            0x80..=0xff => {
                self.cursor_addr = command & 0x7f;
            }
            _ => {}
        }
    }

    fn write_char(&mut self, byte: u8) {
        if let Some(index) = hd44780_ddram_index(self.cursor_addr) {
            if let Some(cell) = self.ddram.get_mut(index) {
                *cell = if byte.is_ascii() && !byte.is_ascii_control() {
                    byte
                } else {
                    b' '
                };
            }
        }
        self.cursor_addr = self.cursor_addr.wrapping_add(1);
    }
}

fn hd44780_ddram_index(address: u8) -> Option<usize> {
    match address {
        0x00..=0x27 => Some(address as usize),
        0x40..=0x67 => Some((address - 0x40) as usize + 40),
        _ => None,
    }
}

fn hd44780_text_lines(ddram: &[u8], columns: usize, rows: usize) -> Vec<String> {
    let row_starts = [0x00_u8, 0x40_u8, 0x14_u8, 0x54_u8];
    (0..rows)
        .map(|row| {
            let start = row_starts.get(row).copied().unwrap_or(0x00);
            (0..columns)
                .map(|offset| {
                    hd44780_ddram_index(start.wrapping_add(offset as u8))
                        .and_then(|index| ddram.get(index).copied())
                        .unwrap_or(b' ') as char
                })
                .collect()
        })
        .collect()
}

fn read_signal_value(cycle: &[u16], signal_index: usize) -> bool {
    let word_index = signal_index / 16;
    let bit_index = signal_index % 16;
    cycle
        .get(word_index)
        .map(|word| (word & (1u16 << bit_index)) != 0)
        .unwrap_or(false)
}
