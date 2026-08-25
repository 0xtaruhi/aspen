use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, BufWriter, Write},
    path::PathBuf,
};

use flate2::{write::GzEncoder, Compression};

const MAGIC: &[u8; 4] = b"AVCD";
const VERSION: u16 = 2;
const MAX_SAMPLES: usize = 262_144;
const MAX_SIGNALS: usize = 4_096;
const MAX_TEXT_BYTES: usize = 1 << 20;

pub struct VcdExport {
    path: PathBuf,
    sample_rate_hz: f64,
    sample_count: usize,
    signals: Vec<String>,
    clock_signals: Vec<bool>,
    samples: Vec<u8>,
}

impl VcdExport {
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let mut input = PacketReader::new(bytes);
        if input.take(4)? != MAGIC {
            return Err("invalid waveform export payload".into());
        }
        if input.u16()? != VERSION {
            return Err("unsupported waveform export payload version".into());
        }

        let sample_rate_hz = input.f64()?;
        let sample_count = input.u32()? as usize;
        let signal_count = input.u16()? as usize;
        if sample_count == 0 || sample_count > MAX_SAMPLES {
            return Err("waveform sample count is out of range".into());
        }
        if signal_count == 0 || signal_count > MAX_SIGNALS {
            return Err("waveform signal count is out of range".into());
        }

        let path_length = input.u32()? as usize;
        let path = PathBuf::from(input.string(path_length)?);
        let mut signals = Vec::with_capacity(signal_count);
        let mut clock_signals = Vec::with_capacity(signal_count);
        for _ in 0..signal_count {
            clock_signals.push(input.u8()? & 1 != 0);
            let name_length = input.u16()? as usize;
            signals.push(input.string(name_length)?);
        }

        let packed_len = sample_count
            .checked_mul(signal_count.div_ceil(8))
            .ok_or("waveform payload is too large")?;
        let samples = input.take(packed_len)?.to_vec();
        if !input.is_empty() {
            return Err("waveform export payload has trailing data".into());
        }

        Ok(Self {
            path,
            sample_rate_hz,
            sample_count,
            signals,
            clock_signals,
            samples,
        })
    }

    pub fn write(self) -> Result<(), String> {
        let extension = self.path.to_string_lossy().to_ascii_lowercase();
        let compressed = if extension.ends_with(".vcd.gz") {
            true
        } else if extension.ends_with(".vcd") {
            false
        } else {
            return Err("waveform export path must end in .vcd or .vcd.gz".into());
        };

        if let Some(parent) = self
            .path
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(io_error("create waveform export directory"))?;
        }

        let file = File::create(&self.path).map_err(io_error("create waveform export"))?;
        if compressed {
            let encoder = GzEncoder::new(BufWriter::new(file), Compression::new(3));
            let mut writer = BufWriter::with_capacity(64 * 1024, encoder);
            self.write_vcd(&mut writer)?;
            writer.flush().map_err(io_error("flush waveform export"))?;
            let encoder = writer
                .into_inner()
                .map_err(|err| format!("finish waveform export: {}", err.error()))?;
            encoder
                .finish()
                .map_err(io_error("finish waveform compression"))?
                .flush()
                .map_err(io_error("flush waveform export"))?;
        } else {
            let mut writer = BufWriter::with_capacity(64 * 1024, file);
            self.write_vcd(&mut writer)?;
            writer.flush().map_err(io_error("flush waveform export"))?;
        }

        Ok(())
    }

    fn write_vcd(&self, output: &mut impl Write) -> Result<(), String> {
        writeln!(output, "$version Aspen {} $end", env!("CARGO_PKG_VERSION"))
            .map_err(io_error("write VCD header"))?;
        writeln!(output, "$timescale 1 ps $end").map_err(io_error("write VCD header"))?;
        writeln!(output, "$scope module logic $end").map_err(io_error("write VCD header"))?;

        let names = unique_signal_names(&self.signals);
        let ids: Vec<_> = (0..names.len()).map(vcd_id).collect();
        let has_clock = self.clock_signals.iter().any(|clock| *clock);
        for (name, id) in names.iter().zip(&ids) {
            writeln!(output, "$var wire 1 {id} {name} $end")
                .map_err(io_error("write VCD signal"))?;
        }
        writeln!(output, "$upscope $end\n$enddefinitions $end\n$dumpvars")
            .map_err(io_error("write VCD header"))?;
        for (signal_index, id) in ids.iter().enumerate() {
            let value = if self.clock_signals[signal_index] {
                1
            } else {
                bit(self, 0, signal_index)
            };
            writeln!(output, "{value}{id}").map_err(io_error("write VCD sample"))?;
        }
        writeln!(output, "$end").map_err(io_error("write VCD sample"))?;

        for sample_index in 0..self.sample_count {
            if sample_index > 0 {
                let mut timestamp_written = false;
                for (signal_index, id) in ids.iter().enumerate() {
                    let is_clock = self.clock_signals[signal_index];
                    let value = if is_clock {
                        1
                    } else {
                        bit(self, sample_index, signal_index)
                    };
                    if !is_clock && value == bit(self, sample_index - 1, signal_index) {
                        continue;
                    }
                    if !timestamp_written {
                        writeln!(output, "#{}", self.timestamp(sample_index, false))
                            .map_err(io_error("write VCD timestamp"))?;
                        timestamp_written = true;
                    }
                    writeln!(output, "{value}{id}").map_err(io_error("write VCD sample"))?;
                }
            }

            if has_clock {
                writeln!(output, "#{}", self.timestamp(sample_index, true))
                    .map_err(io_error("write VCD timestamp"))?;
                for (signal_index, id) in ids.iter().enumerate() {
                    if self.clock_signals[signal_index] {
                        writeln!(output, "0{id}").map_err(io_error("write VCD sample"))?;
                    }
                }
            }
        }

        Ok(())
    }

    fn timestamp(&self, sample_index: usize, half_cycle: bool) -> u64 {
        let phase = sample_index as u64 * 2 + u64::from(half_cycle);
        if self.sample_rate_hz.is_finite() && self.sample_rate_hz > 0.0 {
            ((phase as f64 * 1_000_000_000_000.0 / (self.sample_rate_hz * 2.0)).round() as u64)
                .max(phase)
        } else {
            phase * 500
        }
    }
}

fn bit(export: &VcdExport, sample_index: usize, signal_index: usize) -> u8 {
    let byte = export.samples[sample_index * export.signals.len().div_ceil(8) + signal_index / 8];
    (byte >> (signal_index % 8)) & 1
}

fn unique_signal_names(signals: &[String]) -> Vec<String> {
    let mut used = HashSet::new();
    signals
        .iter()
        .map(|signal| {
            let base: String = signal
                .chars()
                .map(|char| {
                    if char.is_ascii_alphanumeric() || "_[]:.$".contains(char) {
                        char
                    } else {
                        '_'
                    }
                })
                .collect();
            let base = if base.is_empty() { "signal" } else { &base };
            let mut name = base.to_string();
            let mut suffix = 2;
            while !used.insert(name.clone()) {
                name = format!("{base}_{suffix}");
                suffix += 1;
            }
            name
        })
        .collect()
}

fn vcd_id(mut index: usize) -> String {
    let mut id = String::new();
    loop {
        id.push((b'!' + (index % 94) as u8) as char);
        index /= 94;
        if index == 0 {
            return id;
        }
    }
}

fn io_error(context: &'static str) -> impl FnOnce(io::Error) -> String {
    move |err| format!("{context}: {err}")
}

struct PacketReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> PacketReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or("truncated waveform export payload")?;
        let value = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(value)
    }

    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(
            self.take(2)?.try_into().expect("fixed-size read"),
        ))
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().expect("fixed-size read"),
        ))
    }

    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_le_bytes(
            self.take(8)?.try_into().expect("fixed-size read"),
        ))
    }

    fn string(&mut self, length: usize) -> Result<String, String> {
        if length > MAX_TEXT_BYTES {
            return Err("waveform export text field is too large".into());
        }
        std::str::from_utf8(self.take(length)?)
            .map(str::to_owned)
            .map_err(|_| "waveform export text is not valid UTF-8".into())
    }

    fn is_empty(&self) -> bool {
        self.offset == self.bytes.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::GzDecoder;
    use std::io::Read;

    fn export(samples: Vec<u8>) -> VcdExport {
        VcdExport {
            path: PathBuf::from("waveform.vcd.gz"),
            sample_rate_hz: 100_000_000.0,
            sample_count: samples.len(),
            signals: vec!["clk".into(), "data value".into()],
            clock_signals: vec![false, false],
            samples,
        }
    }

    #[test]
    fn writes_only_transitions_with_valid_timestamps() {
        let mut output = Vec::new();
        export(vec![0b00, 0b01, 0b01, 0b11])
            .write_vcd(&mut output)
            .unwrap();
        let text = String::from_utf8(output).unwrap();

        assert!(text.contains("$var wire 1 ! clk $end"));
        assert!(text.contains("$var wire 1 \" data_value $end"));
        assert!(text.contains("#10000\n1!"));
        assert!(text.contains("#30000\n1\""));
        assert!(!text.contains("#20000"));
    }

    #[test]
    fn writes_reference_clock_when_the_input_slot_is_low() {
        let mut output = Vec::new();
        let mut export = export(vec![0, 0]);
        export.clock_signals[0] = true;
        export.write_vcd(&mut output).unwrap();
        let text = String::from_utf8(output).unwrap();

        assert!(text.contains("#5000\n0!"));
        assert!(text.contains("#10000\n1!"));
        assert!(text.contains("#15000\n0!"));
    }

    #[test]
    fn gzip_round_trip() {
        let mut compressed = Vec::new();
        {
            let mut encoder = GzEncoder::new(&mut compressed, Compression::new(3));
            export(vec![0, 1]).write_vcd(&mut encoder).unwrap();
            encoder.finish().unwrap();
        }
        let mut text = String::new();
        GzDecoder::new(compressed.as_slice())
            .read_to_string(&mut text)
            .unwrap();
        assert!(text.contains("$enddefinitions $end"));
    }

    #[test]
    fn rejects_truncated_payloads() {
        assert_eq!(
            VcdExport::decode(b"AVCD\x02\0").err().as_deref(),
            Some("truncated waveform export payload")
        );
    }

    #[test]
    fn decodes_binary_snapshot() {
        let mut packet = b"AVCD".to_vec();
        packet.extend(VERSION.to_le_bytes());
        packet.extend(25_000_000.0_f64.to_le_bytes());
        packet.extend(2_u32.to_le_bytes());
        packet.extend(2_u16.to_le_bytes());
        packet.extend(8_u32.to_le_bytes());
        packet.extend(b"test.vcd");
        packet.push(1);
        packet.extend(3_u16.to_le_bytes());
        packet.extend(b"clk");
        packet.push(0);
        packet.extend(4_u16.to_le_bytes());
        packet.extend(b"data");
        packet.extend([0b01, 0b10]);

        let export = VcdExport::decode(&packet).unwrap();
        assert_eq!(export.path, PathBuf::from("test.vcd"));
        assert_eq!(export.signals, ["clk", "data"]);
        assert_eq!(export.clock_signals, [true, false]);
        assert_eq!(export.sample_count, 2);
        assert_eq!(export.samples, [0b01, 0b10]);
    }
}
