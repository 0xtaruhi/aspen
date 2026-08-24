use super::*;

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

pub(in crate::hardware::runtime) fn compile_uart_terminal_output(
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

pub(in crate::hardware::runtime) fn compile_hd44780_lcd_output(
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

impl OutputDeviceDecoder for UartTerminalOutputDecoder {
    fn ingest_cycle(&mut self, cycle: &[u16]) {
        let value = read_signal_value(cycle, self.signal_index);
        if !self.state.receiving {
            if self.state.countdown > 0 {
                self.state.countdown -= 1;
                return;
            }
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
            self.state.countdown = self.cycles_per_bit.saturating_sub(1);
            self.state.bit_index = 0;
            self.state.byte = 0;
            return;
        }

        self.state.countdown = self.cycles_per_bit.saturating_sub(1);
    }

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry {
        device_snapshot(
            &self.device_id,
            !self.text_log.is_empty(),
            0.0,
            HardwareCanvasDeviceTelemetryPayload::TextLog {
                log: self.text_log.clone(),
            },
        )
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

    fn flush_snapshot(&mut self) -> HardwareCanvasDeviceTelemetryEntry {
        let text_lines = hd44780_text_lines(&self.ddram, self.columns, self.rows);
        device_snapshot(
            &self.device_id,
            text_lines.iter().any(|line| !line.trim_end().is_empty()),
            0.0,
            HardwareCanvasDeviceTelemetryPayload::TextLines { lines: text_lines },
        )
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
