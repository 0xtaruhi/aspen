use super::*;

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

pub(in crate::hardware::runtime) fn compile_vga_display_output(
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

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry {
        let lit_pixels = self
            .frame_pixels
            .iter()
            .copied()
            .filter(|pixel| *pixel != 0)
            .count();

        device_snapshot(
            &self.device_id,
            lit_pixels > 0,
            if self.frame_pixels.is_empty() {
                0.0
            } else {
                lit_pixels as f32 / self.frame_pixels.len() as f32
            },
            HardwareCanvasDeviceTelemetryPayload::Framebuffer {
                columns: self.target_columns as u16,
                rows: self.target_rows as u16,
                pixels: self.frame_pixels.clone(),
            },
        )
    }
}
