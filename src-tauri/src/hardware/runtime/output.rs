use std::hash::{Hash, Hasher};

use crate::hardware::types::{
    CanvasDeviceSnapshot, CanvasHd44780BusMode, CanvasUartMode, CanvasVgaColorMode,
    HardwareCanvasDeviceTelemetry, HardwareCanvasDeviceTelemetryEntry,
    HardwareCanvasDeviceTelemetryPayload, HardwareStateV1,
};

use super::registry::{output_compiler_for_device_type, SignalIndexLookup};
use super::*;

mod text;
mod vga;

pub(super) use text::{compile_hd44780_lcd_output, compile_uart_terminal_output};
pub(super) use vga::compile_vga_display_output;

const DEFAULT_VERICOMM_FABRIC_CLOCK_HZ: f64 = 30_000_000.0;
const AUDIO_EDGE_TIMEOUT_MS: u64 = 1_500;

pub(super) trait OutputDeviceDecoder: Send {
    fn ingest_cycle(&mut self, cycle: &[u16]);
    fn finish_batch(&mut self, _generated_at_ms: u64, _sample_rate_hz: f64) {}
    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry;
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
    batch_edge_count: u32,
    frequency_window_start_ms: Option<u64>,
    frequency_window_edges: u32,
    last_edge_at_ms: Option<u64>,
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

    pub(super) fn finish_output_batch(
        decoders: &mut [Box<dyn OutputDeviceDecoder>],
        generated_at_ms: u64,
        sample_rate_hz: f64,
    ) {
        for decoder in decoders {
            decoder.finish_batch(generated_at_ms, sample_rate_hz);
        }
    }

    pub(super) fn flush_output_decoders(
        decoders: &mut [Box<dyn OutputDeviceDecoder>],
        generated_at_ms: u64,
    ) -> HardwareCanvasDeviceTelemetry {
        let devices = decoders
            .iter_mut()
            .map(|decoder| decoder.flush_snapshot())
            .collect();

        HardwareCanvasDeviceTelemetry {
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

fn device_snapshot(
    device_id: &str,
    latest: bool,
    high_ratio: f32,
    payload: HardwareCanvasDeviceTelemetryPayload,
) -> HardwareCanvasDeviceTelemetryEntry {
    HardwareCanvasDeviceTelemetryEntry {
        device_id: device_id.to_string(),
        latest,
        high_ratio,
        payload,
    }
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
        batch_edge_count: 0,
        frequency_window_start_ms: None,
        frequency_window_edges: 0,
        last_edge_at_ms: None,
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

impl OutputDeviceDecoder for LedOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let value = read_signal_value(cycle, self.signal_index);
        self.latest = value;
        self.total_count = self.total_count.saturating_add(1);
        if value {
            self.high_count = self.high_count.saturating_add(1);
        }
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry {
        let total_count = self.total_count.max(1);
        let entry = device_snapshot(
            &self.device_id,
            self.latest,
            self.high_count as f32 / total_count as f32,
            HardwareCanvasDeviceTelemetryPayload::None,
        );
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

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry {
        let total_count = self.total_count.max(1);
        let entry = device_snapshot(
            &self.device_id,
            self.latest_bits.iter().any(|value| *value != 0),
            self.high_count as f32 / total_count as f32,
            HardwareCanvasDeviceTelemetryPayload::Bitset {
                bits: self.latest_bits.clone(),
            },
        );
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
        if value {
            self.high_count = self.high_count.saturating_add(1);
        }

        if value != self.previous {
            self.edge_count = self.edge_count.saturating_add(1);
            self.batch_edge_count = self.batch_edge_count.saturating_add(1);
        }

        self.previous = value;
    }

    fn finish_batch(&mut self, generated_at_ms: u64, sample_rate_hz: f64) {
        let window_start = *self
            .frequency_window_start_ms
            .get_or_insert(generated_at_ms);
        self.frequency_window_edges = self
            .frequency_window_edges
            .saturating_add(self.batch_edge_count);
        if self.batch_edge_count > 0 {
            self.last_edge_at_ms = Some(generated_at_ms);
        }
        self.batch_edge_count = 0;

        let elapsed_ms = generated_at_ms.saturating_sub(window_start);
        if elapsed_ms >= 100 && self.frequency_window_edges >= 2 && sample_rate_hz > 0.0 {
            // VeriComm snapshots a continuously running fabric, so observed edges are
            // scaled by the ratio between the sample rate and the P77 fabric clock.
            let observed_hz = self.frequency_window_edges as f64 * 500.0 / elapsed_ms as f64;
            let frequency_hz = observed_hz * DEFAULT_VERICOMM_FABRIC_CLOCK_HZ / sample_rate_hz;
            self.period_samples = (sample_rate_hz / frequency_hz) as f32;
            self.frequency_window_start_ms = Some(generated_at_ms);
            self.frequency_window_edges = 0;
        }

        if self.last_edge_at_ms.is_some_and(|last_edge| {
            generated_at_ms.saturating_sub(last_edge) >= AUDIO_EDGE_TIMEOUT_MS
        }) {
            self.period_samples = 0.0;
            self.frequency_window_start_ms = Some(generated_at_ms);
            self.frequency_window_edges = 0;
        }
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry {
        let total_count = self.total_count.max(1);
        let entry = device_snapshot(
            &self.device_id,
            self.latest,
            self.high_count as f32 / total_count as f32,
            HardwareCanvasDeviceTelemetryPayload::AudioPwm {
                edge_count: self.edge_count,
                sample_count: self.total_count,
                period_samples: self.period_samples,
            },
        );

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

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry {
        let total_samples = self
            .sample_counts
            .iter()
            .copied()
            .fold(0_u32, u32::saturating_add);
        let mut total_on_counts = 0_u32;
        let mut digit_masks = Vec::with_capacity(self.digit_count);

        for digit_index in 0..self.digit_count {
            let sample_count = self.sample_counts[digit_index];
            let mut digit_mask = self.latest_masks[digit_index];
            if sample_count > 0 {
                digit_mask = 0;
                for segment_index in 0..8 {
                    let on_count = self.segment_on_counts[digit_index][segment_index];
                    total_on_counts = total_on_counts.saturating_add(on_count);
                    if on_count.saturating_mul(2) >= sample_count {
                        digit_mask |= 1u16 << segment_index;
                    }
                }
                self.latest_masks[digit_index] = digit_mask;
            }
            digit_masks.push(digit_mask);
        }

        let entry = device_snapshot(
            &self.device_id,
            digit_masks.iter().any(|mask| *mask != 0)
                || self.latest_masks.iter().any(|mask| *mask != 0),
            if total_samples == 0 {
                0.0
            } else {
                total_on_counts as f32 / (total_samples as f32 * 8.0)
            },
            HardwareCanvasDeviceTelemetryPayload::SegmentDisplay {
                segment_mask: digit_masks.first().copied().unwrap_or(0),
                digit_segment_masks: digit_masks,
            },
        );
        self.sample_counts.fill(0);
        for segment_counts in &mut self.segment_on_counts {
            segment_counts.fill(0);
        }
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

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry {
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

        let entry = device_snapshot(
            &self.device_id,
            latest,
            if pixels.is_empty() {
                0.0
            } else {
                total_intensity / pixels.len() as f32
            },
            HardwareCanvasDeviceTelemetryPayload::Framebuffer {
                columns: self.columns as u16,
                rows: self.rows as u16,
                pixels,
            },
        );
        self.row_samples.fill(0);
        self.pixel_on_counts.fill(0);
        entry
    }
}

fn read_signal_value(cycle: &[u16], signal_index: usize) -> bool {
    let word_index = signal_index / 16;
    let bit_index = signal_index % 16;
    cycle
        .get(word_index)
        .map(|word| (word & (1u16 << bit_index)) != 0)
        .unwrap_or(false)
}
