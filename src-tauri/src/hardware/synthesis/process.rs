use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::mpsc,
};

use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Globalization::{GetACP, GetOEMCP, MultiByteToWideChar},
    System::Console::GetConsoleOutputCP,
};

use super::{
    artifacts::{quote_yosys_path, quote_yosys_workdir_path},
    now_millis, SynthesisLogChunkV1, FDE_LUT_WIDTH,
};

pub(super) struct YosysScriptInput<'a> {
    pub workdir: &'a Path,
    pub fde_simlib: &'a Path,
    pub fde_bram_lib: &'a Path,
    pub fde_bram_map: &'a Path,
    pub fde_techmap: &'a Path,
    pub fde_cells_map: &'a Path,
    pub source_paths: &'a [PathBuf],
    pub top_module: &'a str,
    pub netlist_path: &'a Path,
    pub edif_path: &'a Path,
}

pub(super) fn build_yosys_script(input: YosysScriptInput<'_>) -> String {
    let quoted_sources = input
        .source_paths
        .iter()
        .map(|path| quote_yosys_workdir_path(input.workdir, path))
        .collect::<Vec<_>>()
        .join(" ");

    format!(
        "read_verilog -lib {}\n\
read_verilog -sv {quoted_sources}\n\
hierarchy -check -top {}\n\
proc\n\
flatten -noscopeinfo\n\
memory -nomap\n\
opt_clean\n\
memory_libmap -lib {}\n\
techmap -map {}\n\
opt\n\
memory_map\n\
opt -fast\n\
opt -full\n\
techmap -map {}\n\
simplemap\n\
dfflegalize \\\n\
  -cell $_DFF_N_ 01 \\\n\
  -cell $_DFF_P_ 01 \\\n\
  -cell $_DFFE_PP_ 01 \\\n\
  -cell $_DFFE_PN_ 01 \\\n\
  -cell $_DFF_PN0_ r \\\n\
  -cell $_DFF_PN1_ r \\\n\
  -cell $_DFF_PP0_ r \\\n\
  -cell $_DFF_PP1_ r \\\n\
  -cell $_DFF_NN0_ r \\\n\
  -cell $_DFF_NN1_ r \\\n\
  -cell $_DFF_NP0_ r \\\n\
  -cell $_DFF_NP1_ r\n\
techmap -D NO_LUT -map {}\n\
opt\n\
wreduce\n\
clean\n\
dffinit -ff DFFNHQ Q INIT -ff DFFHQ Q INIT -ff EDFFHQ Q INIT -ff DFFRHQ Q INIT -ff DFFSHQ Q INIT -ff DFFNRHQ Q INIT -ff DFFNSHQ Q INIT\n\
abc -lut {}\n\
opt\n\
wreduce\n\
clean\n\
maccmap -unmap\n\
techmap\n\
simplemap\n\
opt\n\
wreduce\n\
clean\n\
abc -lut {}\n\
opt\n\
wreduce\n\
clean\n\
techmap -map {}\n\
opt\n\
check\n\
stat\n\
write_edif {}\n\
write_json {}\n",
        quote_yosys_path(input.fde_simlib),
        input.top_module,
        quote_yosys_path(input.fde_bram_lib),
        quote_yosys_path(input.fde_bram_map),
        quote_yosys_path(input.fde_techmap),
        quote_yosys_path(input.fde_cells_map),
        FDE_LUT_WIDTH,
        FDE_LUT_WIDTH,
        quote_yosys_path(input.fde_cells_map),
        quote_yosys_workdir_path(input.workdir, input.edif_path),
        quote_yosys_workdir_path(input.workdir, input.netlist_path),
    )
}

pub(super) fn stream_output<R: std::io::Read>(reader: R, tx: mpsc::Sender<String>) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();

    loop {
        buffer.clear();
        let read = reader.read_until(b'\n', &mut buffer).unwrap_or(0);
        if read == 0 {
            break;
        }

        let chunk = decode_process_output_chunk(&buffer);
        let _ = tx.send(chunk);
    }
}

pub(crate) fn decode_process_output_chunk(buffer: &[u8]) -> String {
    if let Ok(chunk) = std::str::from_utf8(buffer) {
        return chunk.to_owned();
    }

    #[cfg(target_os = "windows")]
    if let Some(chunk) = decode_windows_process_output(buffer) {
        return chunk;
    }

    String::from_utf8_lossy(buffer).into_owned()
}

#[cfg(target_os = "windows")]
fn decode_windows_process_output(buffer: &[u8]) -> Option<String> {
    let mut code_pages = Vec::with_capacity(3);
    push_unique_code_page(&mut code_pages, unsafe { GetConsoleOutputCP() });
    push_unique_code_page(&mut code_pages, unsafe { GetOEMCP() });
    push_unique_code_page(&mut code_pages, unsafe { GetACP() });

    code_pages
        .into_iter()
        .find_map(|code_page| decode_windows_bytes_with_code_page(buffer, code_page))
}

#[cfg(target_os = "windows")]
fn push_unique_code_page(code_pages: &mut Vec<u32>, code_page: u32) {
    if code_page != 0 && !code_pages.contains(&code_page) {
        code_pages.push(code_page);
    }
}

#[cfg(target_os = "windows")]
fn decode_windows_bytes_with_code_page(buffer: &[u8], code_page: u32) -> Option<String> {
    if buffer.is_empty() {
        return Some(String::new());
    }

    let input_length = i32::try_from(buffer.len()).ok()?;
    let wide_length = unsafe {
        MultiByteToWideChar(
            code_page,
            0,
            buffer.as_ptr(),
            input_length,
            std::ptr::null_mut(),
            0,
        )
    };
    if wide_length <= 0 {
        return None;
    }

    let mut wide = vec![0u16; wide_length as usize];
    let converted = unsafe {
        MultiByteToWideChar(
            code_page,
            0,
            buffer.as_ptr(),
            input_length,
            wide.as_mut_ptr(),
            wide_length,
        )
    };
    if converted <= 0 {
        return None;
    }

    Some(String::from_utf16_lossy(&wide[..converted as usize]))
}

pub(super) fn emit_log_chunk(
    app: &AppHandle,
    op_id: &str,
    chunk: String,
    fallback_timestamp_ms: u64,
) {
    let generated_at_ms = now_millis().unwrap_or(fallback_timestamp_ms);
    let _ = app.emit(
        "hardware:synthesis_log",
        SynthesisLogChunkV1 {
            version: 1,
            op_id: op_id.to_string(),
            chunk,
            generated_at_ms,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::decode_process_output_chunk;

    #[test]
    fn decode_process_output_chunk_preserves_utf8_lines() {
        let line = "项目综合完成\n";
        assert_eq!(decode_process_output_chunk(line.as_bytes()), line);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn decode_process_output_chunk_supports_windows_code_page_fallback() {
        let bytes = [0xC4, 0xE3, 0xBA, 0xC3, b'\n'];
        assert_eq!(
            super::decode_windows_bytes_with_code_page(&bytes, 936).as_deref(),
            Some("你好\n")
        );
    }
}
