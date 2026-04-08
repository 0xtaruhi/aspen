use std::{fs, path::Path};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryImageFormat {
    Text,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedMemoryImage {
    format: MemoryImageFormat,
    words: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MemoryImageLoadResult {
    pub format: MemoryImageFormat,
    pub words: Vec<u16>,
    pub source_path: String,
}

pub fn load_memory_image_from_path(
    path: &Path,
    data_width: u16,
) -> Result<MemoryImageLoadResult, String> {
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let parsed = parse_memory_image_bytes(&bytes, data_width, file_name);

    Ok(MemoryImageLoadResult {
        format: parsed.format,
        words: parsed.words,
        source_path: path.to_string_lossy().into_owned(),
    })
}

fn decode_utf8(bytes: &[u8]) -> Option<String> {
    String::from_utf8(bytes.to_vec()).ok()
}

fn looks_like_text_file(file_name: &str, decoded: Option<&str>) -> bool {
    let lower = file_name.to_ascii_lowercase();
    if [".hex", ".mem", ".mif", ".coe", ".txt"]
        .iter()
        .any(|ext| lower.ends_with(ext))
    {
        return true;
    }

    let Some(decoded) = decoded else {
        return false;
    };

    let printable_count = decoded
        .chars()
        .filter(|ch| matches!(*ch as u32, 9 | 10 | 13 | 32..=126))
        .count();
    printable_count * 10 >= decoded.chars().count() * 9
}

fn normalize_radix_token(token: &str) -> &str {
    token.trim().trim_end_matches(',')
}

fn parse_numeric_token(token: &str, fallback_radix: u32) -> Option<u32> {
    let normalized = normalize_radix_token(token).replace('_', "");
    if normalized.is_empty() {
        return None;
    }

    if normalized.starts_with("0x") || normalized.starts_with("0X") {
        return u32::from_str_radix(&normalized[2..], 16).ok();
    }
    if normalized.starts_with("0b") || normalized.starts_with("0B") {
        return u32::from_str_radix(&normalized[2..], 2).ok();
    }
    if normalized.starts_with("0o") || normalized.starts_with("0O") {
        return u32::from_str_radix(&normalized[2..], 8).ok();
    }
    if normalized.starts_with("0d") || normalized.starts_with("0D") {
        return normalized[2..].parse::<u32>().ok();
    }

    u32::from_str_radix(&normalized, fallback_radix).ok()
}

fn clamp_word(value: u32, data_mask: u16) -> u16 {
    (value as u16) & data_mask
}

fn ensure_word(words: &mut Vec<u16>, index: usize) {
    if words.len() <= index {
        words.resize(index + 1, 0);
    }
}

fn write_word(words: &mut Vec<u16>, index: usize, value: u32, data_mask: u16) {
    ensure_word(words, index);
    words[index] = clamp_word(value, data_mask);
}

fn strip_line_comment<'a>(line: &'a str, marker: &str) -> &'a str {
    line.split_once(marker)
        .map(|(head, _)| head)
        .unwrap_or(line)
}

fn parse_plain_text_memory_image(text: &str, data_mask: u16) -> Vec<u16> {
    let mut words = Vec::new();
    let mut cursor = 0usize;

    for raw_line in text.lines() {
        let line = strip_line_comment(strip_line_comment(raw_line, "//"), "#")
            .replace([',', ':', ';'], " ");

        for token in line.split_whitespace() {
            if let Some(address) = token.strip_prefix('@') {
                if let Some(next_cursor) = parse_numeric_token(address, 16) {
                    cursor = next_cursor as usize;
                }
                continue;
            }

            let Some(value) = parse_numeric_token(token, 16) else {
                continue;
            };
            write_word(&mut words, cursor, value, data_mask);
            cursor += 1;
        }
    }

    words
}

fn parse_binary_memory_image(bytes: &[u8], data_width: u16, data_mask: u16) -> Vec<u16> {
    let bytes_per_word = usize::max(1, usize::from(data_width).div_ceil(8));
    let mut words = Vec::with_capacity(bytes.len().div_ceil(bytes_per_word));

    for chunk in bytes.chunks(bytes_per_word) {
        let mut value = 0u32;
        for (offset, byte) in chunk.iter().enumerate() {
            value |= u32::from(*byte) << (offset * 8);
        }
        words.push(clamp_word(value, data_mask));
    }

    words
}

fn parse_radix_name(value: &str) -> Option<u32> {
    match value.trim().to_ascii_uppercase().as_str() {
        "BIN" | "2" => Some(2),
        "OCT" | "8" => Some(8),
        "DEC" | "UNS" | "10" => Some(10),
        "HEX" | "16" => Some(16),
        _ => None,
    }
}

fn parse_token_sequence(value: &str, radix: u32) -> Vec<u32> {
    value
        .split(|ch: char| ch.is_whitespace() || ch == ',')
        .filter_map(|token| parse_numeric_token(token, radix))
        .collect()
}

fn strip_statement_comments(text: &str) -> String {
    text.lines()
        .map(|line| strip_line_comment(strip_line_comment(line, "//"), "--"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn looks_like_coe_file(text: &str) -> bool {
    text.to_ascii_lowercase()
        .contains("memory_initialization_vector")
}

fn parse_coe_memory_image(text: &str, data_mask: u16) -> Vec<u16> {
    let normalized = strip_statement_comments(text);
    let statements = normalized.split(';').map(str::trim).collect::<Vec<_>>();

    let radix = statements
        .iter()
        .find_map(|statement| {
            let lower = statement.to_ascii_lowercase();
            if !lower.contains("memory_initialization_radix") {
                return None;
            }
            statement
                .split_once('=')
                .and_then(|(_, value)| parse_radix_name(value))
        })
        .unwrap_or(16);

    let vector = statements
        .iter()
        .find_map(|statement| {
            let lower = statement.to_ascii_lowercase();
            if !lower.contains("memory_initialization_vector") {
                return None;
            }
            statement
                .split_once('=')
                .map(|(_, value)| value.trim().to_string())
        })
        .unwrap_or_default();

    parse_token_sequence(&vector, radix)
        .into_iter()
        .map(|value| clamp_word(value, data_mask))
        .collect()
}

fn strip_mif_comments(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut in_block_comment = false;

    for ch in text.chars() {
        if ch == '%' {
            in_block_comment = !in_block_comment;
            continue;
        }

        if !in_block_comment {
            result.push(ch);
        }
    }

    result
        .lines()
        .map(|line| strip_line_comment(line, "--"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn looks_like_mif_file(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("content begin") || lower.contains("address_radix")
}

fn assign_mif_values(
    words: &mut Vec<u16>,
    start: usize,
    end: usize,
    values: &[u32],
    data_mask: u16,
) {
    if values.is_empty() {
        return;
    }

    let step: isize = if start <= end { 1 } else { -1 };
    let span = start.abs_diff(end) + 1;

    for index in 0..span {
        let value = if values.len() == 1 {
            values[0]
        } else if let Some(value) = values.get(index) {
            *value
        } else {
            break;
        };

        let address = (start as isize + (index as isize * step)) as usize;
        write_word(words, address, value, data_mask);
    }
}

fn parse_mif_range(address_spec: &str, radix: u32) -> Option<(usize, usize)> {
    let trimmed = address_spec.trim();
    let inner = trimmed.strip_prefix('[')?.strip_suffix(']')?.trim();
    let (start, end) = inner.split_once("..")?;
    let start = parse_numeric_token(start, radix)? as usize;
    let end = parse_numeric_token(end, radix)? as usize;
    Some((start, end))
}

fn parse_mif_memory_image(text: &str, data_mask: u16) -> Vec<u16> {
    let normalized = strip_mif_comments(text);
    let lower = normalized.to_ascii_lowercase();

    let address_radix = lower
        .split(';')
        .find_map(|statement| {
            if !statement.contains("address_radix") {
                return None;
            }
            normalized
                .split(';')
                .find(|candidate| candidate.to_ascii_lowercase() == statement)
                .and_then(|candidate| candidate.split_once('='))
                .and_then(|(_, value)| parse_radix_name(value))
        })
        .unwrap_or(16);

    let data_radix = normalized
        .split(';')
        .find_map(|statement| {
            let lower = statement.to_ascii_lowercase();
            if !lower.contains("data_radix") {
                return None;
            }
            statement
                .split_once('=')
                .and_then(|(_, value)| parse_radix_name(value))
        })
        .unwrap_or(16);

    let depth = normalized
        .split(';')
        .find_map(|statement| {
            let lower = statement.to_ascii_lowercase();
            if !lower.contains("depth") {
                return None;
            }
            statement
                .split_once('=')
                .and_then(|(_, value)| parse_numeric_token(value, 10))
                .map(|value| value as usize)
        })
        .unwrap_or(0);

    let content_lower = lower;
    let content = if let (Some(begin), Some(end)) = (
        content_lower.find("content begin"),
        content_lower.find("end;"),
    ) {
        &normalized[begin + "content begin".len()..end]
    } else {
        ""
    };

    let mut words = if depth > 0 {
        vec![0; depth]
    } else {
        Vec::new()
    };
    for statement in content.split(';') {
        let trimmed = statement.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Some((address_spec, value_spec)) = trimmed.split_once(':') else {
            continue;
        };
        let values = parse_token_sequence(value_spec, data_radix);
        if values.is_empty() {
            continue;
        }

        if let Some((start, end)) = parse_mif_range(address_spec, address_radix) {
            assign_mif_values(&mut words, start, end, &values, data_mask);
            continue;
        }

        let Some(start) =
            parse_numeric_token(address_spec, address_radix).map(|value| value as usize)
        else {
            continue;
        };
        assign_mif_values(
            &mut words,
            start,
            start.saturating_add(values.len().saturating_sub(1)),
            &values,
            data_mask,
        );
    }

    words
}

fn looks_like_intel_hex_file(text: &str) -> bool {
    let lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    !lines.is_empty() && lines.iter().all(|line| line.starts_with(':'))
}

fn parse_intel_hex_memory_image(text: &str, data_width: u16, data_mask: u16) -> Vec<u16> {
    let mut bytes = std::collections::BTreeMap::<usize, u8>::new();
    let mut upper_address = 0usize;

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || !line.starts_with(':') || line.len() < 11 {
            continue;
        }

        let Ok(byte_count) = u8::from_str_radix(&line[1..3], 16) else {
            continue;
        };
        let Ok(address) = u16::from_str_radix(&line[3..7], 16) else {
            continue;
        };
        let Ok(record_type) = u8::from_str_radix(&line[7..9], 16) else {
            continue;
        };
        let data_end = 9 + (usize::from(byte_count) * 2);
        if line.len() < data_end {
            continue;
        }
        let data = &line[9..data_end];

        match record_type {
            0x00 => {
                let base_address = upper_address + usize::from(address);
                for index in 0..usize::from(byte_count) {
                    let start = index * 2;
                    if let Ok(byte) = u8::from_str_radix(&data[start..start + 2], 16) {
                        bytes.insert(base_address + index, byte);
                    }
                }
            }
            0x01 => break,
            0x02 => {
                if let Ok(segment) = u16::from_str_radix(data, 16) {
                    upper_address = usize::from(segment) << 4;
                }
            }
            0x04 => {
                if let Ok(segment) = u16::from_str_radix(data, 16) {
                    upper_address = usize::from(segment) << 16;
                }
            }
            _ => {}
        }
    }

    let bytes_per_word = usize::max(1, usize::from(data_width).div_ceil(8));
    let Some(max_byte_address) = bytes.keys().next_back().copied() else {
        return Vec::new();
    };
    let word_count = (max_byte_address / bytes_per_word) + 1;
    let mut words = vec![0u16; word_count];

    for (byte_address, value) in bytes {
        let word_index = byte_address / bytes_per_word;
        let byte_offset = byte_address % bytes_per_word;
        let shifted = u16::from(value) << (byte_offset * 8);
        words[word_index] = (words[word_index] | shifted) & data_mask;
    }

    words
}

fn data_mask(data_width: u16) -> u16 {
    if data_width >= u16::BITS as u16 {
        u16::MAX
    } else {
        ((1u32 << u32::from(data_width.max(1))) - 1) as u16
    }
}

fn parse_memory_image_bytes(bytes: &[u8], data_width: u16, file_name: &str) -> ParsedMemoryImage {
    let decoded = decode_utf8(bytes);
    let data_mask = data_mask(data_width);

    if looks_like_text_file(file_name, decoded.as_deref()) {
        let text = decoded.unwrap_or_default();
        let words = if looks_like_coe_file(&text) {
            parse_coe_memory_image(&text, data_mask)
        } else if looks_like_mif_file(&text) {
            parse_mif_memory_image(&text, data_mask)
        } else if looks_like_intel_hex_file(&text) {
            parse_intel_hex_memory_image(&text, data_width, data_mask)
        } else {
            parse_plain_text_memory_image(&text, data_mask)
        };

        return ParsedMemoryImage {
            format: MemoryImageFormat::Text,
            words,
        };
    }

    ParsedMemoryImage {
        format: MemoryImageFormat::Binary,
        words: parse_binary_memory_image(bytes, data_width, data_mask),
    }
}

#[cfg(test)]
mod tests {
    use super::parse_memory_image_bytes;
    use super::MemoryImageFormat;

    #[test]
    fn parses_vivado_mem_files_with_address_jumps() {
        let parsed = parse_memory_image_bytes(b"@0\n12\n34\n@4\nAB\n", 8, "image.mem");
        assert_eq!(parsed.format, MemoryImageFormat::Text);
        assert_eq!(parsed.words, vec![0x12, 0x34, 0x00, 0x00, 0xAB]);
    }

    #[test]
    fn parses_xilinx_coe_files() {
        let parsed = parse_memory_image_bytes(
            b"memory_initialization_radix=16;\nmemory_initialization_vector=\n01,\n02,\n0A,\nFF;\n",
            8,
            "image.coe",
        );
        assert_eq!(parsed.words, vec![0x01, 0x02, 0x0A, 0xFF]);
    }

    #[test]
    fn parses_quartus_mif_files() {
        let parsed = parse_memory_image_bytes(
            b"DEPTH = 8;\nWIDTH = 8;\nADDRESS_RADIX = HEX;\nDATA_RADIX = HEX;\nCONTENT BEGIN\n  0 : 12;\n  1 : 34;\n  [2..4] : AB;\nEND;\n",
            8,
            "image.mif",
        );
        assert_eq!(
            parsed.words,
            vec![0x12, 0x34, 0xAB, 0xAB, 0xAB, 0x00, 0x00, 0x00]
        );
    }

    #[test]
    fn parses_intel_hex_files_into_little_endian_words() {
        let parsed =
            parse_memory_image_bytes(b":040000001122334452\n:00000001FF\n", 16, "image.hex");
        assert_eq!(parsed.words, vec![0x2211, 0x4433]);
    }
}
