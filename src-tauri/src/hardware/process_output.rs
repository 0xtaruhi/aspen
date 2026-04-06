use std::io::{BufRead, BufReader};
use std::sync::mpsc;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Globalization::{GetACP, GetOEMCP, MultiByteToWideChar},
    System::Console::GetConsoleOutputCP,
};

pub(super) fn stream_output<R: std::io::Read>(reader: R, tx: mpsc::Sender<String>) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();

    loop {
        buffer.clear();
        let read = reader.read_until(b'\n', &mut buffer).unwrap_or(0);
        if read == 0 {
            break;
        }

        let _ = tx.send(decode_output_chunk(&buffer));
    }
}

pub(super) fn decode_output_chunk(bytes: &[u8]) -> String {
    if let Ok(chunk) = std::str::from_utf8(bytes) {
        return chunk.to_string();
    }

    #[cfg(target_os = "windows")]
    if let Some(chunk) = decode_windows_output_chunk(bytes) {
        return chunk;
    }

    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(target_os = "windows")]
fn decode_windows_output_chunk(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return Some(String::new());
    }

    for code_page in windows_output_code_pages() {
        if let Some(chunk) = decode_windows_code_page(bytes, code_page) {
            return Some(chunk);
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn windows_output_code_pages() -> Vec<u32> {
    let mut code_pages = Vec::with_capacity(3);
    push_code_page(&mut code_pages, unsafe { GetConsoleOutputCP() });
    push_code_page(&mut code_pages, unsafe { GetACP() });
    push_code_page(&mut code_pages, unsafe { GetOEMCP() });
    code_pages
}

#[cfg(target_os = "windows")]
fn push_code_page(code_pages: &mut Vec<u32>, code_page: u32) {
    if code_page != 0 && code_page != 65001 && !code_pages.contains(&code_page) {
        code_pages.push(code_page);
    }
}

#[cfg(target_os = "windows")]
fn decode_windows_code_page(bytes: &[u8], code_page: u32) -> Option<String> {
    let input_len = i32::try_from(bytes.len()).ok()?;
    let wide_len = unsafe {
        MultiByteToWideChar(
            code_page,
            0,
            bytes.as_ptr(),
            input_len,
            std::ptr::null_mut(),
            0,
        )
    };
    if wide_len <= 0 {
        return None;
    }

    let mut wide = vec![0u16; wide_len as usize];
    let decoded_len = unsafe {
        MultiByteToWideChar(
            code_page,
            0,
            bytes.as_ptr(),
            input_len,
            wide.as_mut_ptr(),
            wide_len,
        )
    };
    if decoded_len <= 0 {
        return None;
    }

    Some(String::from_utf16_lossy(&wide[..decoded_len as usize]))
}

#[cfg(test)]
mod tests {
    use super::decode_output_chunk;

    #[test]
    fn decode_output_chunk_preserves_utf8() {
        assert_eq!(
            decode_output_chunk("hello, 世界\n".as_bytes()),
            "hello, 世界\n"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn decode_output_chunk_falls_back_to_windows_code_page() {
        let bytes = [0xD6, 0xD0, 0xCE, 0xC4, b'\n'];
        assert_eq!(decode_output_chunk(&bytes), "中文\n");
    }
}
