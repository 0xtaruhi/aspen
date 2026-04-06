use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};

use super::{artifacts::quote_yosys_path, now_millis, SynthesisLogChunkV1, FDE_LUT_WIDTH};
pub(super) use crate::hardware::process_output::stream_output;

pub(super) fn build_yosys_script(
    fde_simlib: &Path,
    fde_techmap: &Path,
    fde_cells_map: &Path,
    source_paths: &[PathBuf],
    top_module: &str,
    netlist_path: &Path,
    edif_path: &Path,
) -> String {
    let quoted_sources = source_paths
        .iter()
        .map(|path| quote_yosys_path(path))
        .collect::<Vec<_>>()
        .join(" ");

    format!(
        "read_verilog -lib {}\n\
read_verilog -sv {quoted_sources}\n\
hierarchy -check -top {top_module}\n\
proc\n\
flatten -noscopeinfo\n\
memory_map\n\
opt -fast\n\
opt -full\n\
techmap -map {}\n\
simplemap\n\
dfflegalize \\\n\
  -cell $_DFF_N_ x \\\n\
  -cell $_DFF_P_ x \\\n\
  -cell $_DFFE_PP_ x \\\n\
  -cell $_DFFE_PN_ x \\\n\
  -cell $_DFF_PN0_ x \\\n\
  -cell $_DFF_PN1_ x \\\n\
  -cell $_DFF_PP0_ x \\\n\
  -cell $_DFF_PP1_ x \\\n\
  -cell $_DFF_NN0_ x \\\n\
  -cell $_DFF_NN1_ x \\\n\
  -cell $_DFF_NP0_ x \\\n\
  -cell $_DFF_NP1_ x\n\
techmap -D NO_LUT -map {}\n\
opt\n\
wreduce\n\
clean\n\
dffinit -ff DFFNHQ Q INIT -ff DFFHQ Q INIT -ff EDFFHQ Q INIT -ff DFFRHQ Q INIT -ff DFFSHQ Q INIT -ff DFFNRHQ Q INIT -ff DFFNSHQ Q INIT\n\
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
        quote_yosys_path(fde_simlib),
        quote_yosys_path(fde_techmap),
        quote_yosys_path(fde_cells_map),
        FDE_LUT_WIDTH,
        quote_yosys_path(fde_cells_map),
        quote_yosys_path(edif_path),
        quote_yosys_path(netlist_path)
    )
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
