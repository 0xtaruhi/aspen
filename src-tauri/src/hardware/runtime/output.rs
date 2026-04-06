use std::hash::{Hash, Hasher};

use crate::hardware::types::{
    CanvasDeviceSnapshot, CanvasVgaColorMode, HardwareCanvasDeviceTelemetryEntryV1,
    HardwareCanvasDeviceTelemetryV1, HardwareStateV1,
};

use super::registry::{output_compiler_for_device_type, SignalIndexLookup};
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

const VGA_MAX_CAPTURE_COLUMNS: usize = 1024;
const VGA_MAX_CAPTURE_ROWS: usize = 768;

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
        let entry = HardwareCanvasDeviceTelemetryEntryV1 {
            device_id: self.device_id.clone(),
            latest: self.latest,
            high_ratio: self.high_count as f32 / total_count as f32,
            segment_mask: None,
            digit_segment_masks: Vec::new(),
            pixel_columns: 0,
            pixel_rows: 0,
            pixels: Vec::new(),
        };
        self.latest = false;
        self.high_count = 0;
        self.total_count = 0;
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

        for column_index in 0..max_width {
            let mut previous = None;
            for row in lines {
                let pixel = row.get(column_index).copied().unwrap_or(0);
                if pixel != 0 {
                    scores[column_index] += 4;
                }
                if let Some(previous_pixel) = previous {
                    if previous_pixel != pixel {
                        scores[column_index] += 1;
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
        }
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
