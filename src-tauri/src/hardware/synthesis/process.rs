use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::mpsc,
};

use tauri::{AppHandle, Emitter};

use super::{artifacts::quote_yosys_path, now_millis, SynthesisLogChunkV1, FDE_LUT_WIDTH};

pub(super) struct YosysScriptInput<'a> {
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
        .map(|path| quote_yosys_path(path))
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
        quote_yosys_path(input.edif_path),
        quote_yosys_path(input.netlist_path),
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

        let chunk = String::from_utf8_lossy(&buffer).into_owned();
        let _ = tx.send(chunk);
    }
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
