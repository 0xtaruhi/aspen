use super::*;
use crate::hardware::types::{ImplementationRouteModeV1, SynthesisSourceFileV1};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Instant,
};

const TEST_BUNDLED_YOSYS_DIR: &str = "vendor/yosys";
const TEST_YOSYS_SUPPORT_DIR: &str = "resource/yosys-fde";
const TEST_FDE_SIMLIB_FILE: &str = "fdesimlib.v";
const TEST_FDE_TECHMAP_FILE: &str = "techmap.v";
const TEST_FDE_CELLS_MAP_FILE: &str = "cells_map.v";

fn test_yosys_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yosys.exe"
    } else {
        "yosys"
    }
}

fn quote_test_yosys_path(path: &Path) -> String {
    format!(
        "\"{}\"",
        path.to_string_lossy()
            .replace('\\', "/")
            .replace('"', "\\\"")
    )
}

fn prepare_test_synthesized_edif(workdir: &Path) -> Result<PathBuf, String> {
    let yosys_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(TEST_BUNDLED_YOSYS_DIR)
        .join("bin")
        .join(test_yosys_executable_name());
    let fde_simlib = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(TEST_YOSYS_SUPPORT_DIR)
        .join(TEST_FDE_SIMLIB_FILE);
    let fde_techmap = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(TEST_YOSYS_SUPPORT_DIR)
        .join(TEST_FDE_TECHMAP_FILE);
    let fde_cells_map = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(TEST_YOSYS_SUPPORT_DIR)
        .join(TEST_FDE_CELLS_MAP_FILE);

    if !yosys_bin.is_file()
        || !fde_simlib.is_file()
        || !fde_techmap.is_file()
        || !fde_cells_map.is_file()
    {
        return Err("Bundled Yosys synthesis resources are unavailable".to_string());
    }

    let top_path = workdir.join("top.v");
    fs::write(
        &top_path,
        [
            "module top(",
            "  input wire sw,",
            "  output wire led",
            ");",
            "  assign led = sw;",
            "endmodule",
            "",
        ]
        .join("\n"),
    )
    .map_err(|err| err.to_string())?;

    let edif_path = workdir.join("top_syn.edf");
    let script_path = workdir.join("prep.ys");
    fs::write(
        &script_path,
        format!(
            "read_verilog -lib {}\n\
read_verilog -sv {}\n\
hierarchy -check -top top\n\
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
abc -lut 4\n\
opt\n\
wreduce\n\
clean\n\
techmap -map {}\n\
opt\n\
check\n\
write_edif {}\n",
            quote_test_yosys_path(&fde_simlib),
            quote_test_yosys_path(&top_path),
            quote_test_yosys_path(&fde_techmap),
            quote_test_yosys_path(&fde_cells_map),
            quote_test_yosys_path(&fde_cells_map),
            quote_test_yosys_path(&edif_path)
        ),
    )
    .map_err(|err| err.to_string())?;

    let mut command = if cfg!(target_os = "windows") {
        if let Some(environment_batch) = yosys_bin
            .parent()
            .and_then(Path::parent)
            .map(|root| root.join("environment.bat"))
            .filter(|path| path.is_file())
        {
            let wrapper_path = workdir.join("aspen-test-yosys.cmd");
            fs::write(
                &wrapper_path,
                format!(
                    "@echo off\r\n\
call \"{}\"\r\n\
if errorlevel 1 exit /b %errorlevel%\r\n\
\"{}\" -s \"{}\"\r\n",
                    environment_batch.display(),
                    yosys_bin.display(),
                    script_path.display()
                ),
            )
            .map_err(|err| err.to_string())?;
            let mut command = Command::new("cmd");
            command.arg("/d").arg("/c").arg(&wrapper_path);
            command
        } else {
            let mut command = Command::new(&yosys_bin);
            command.arg("-s").arg(&script_path);
            configure_test_yosys_runtime_env(&mut command, &yosys_bin);
            command
        }
    } else {
        let mut command = Command::new(&yosys_bin);
        command.arg("-s").arg(&script_path);
        command
    };

    let output = command
        .current_dir(workdir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| err.to_string())?;

    if !output.status.success() || !edif_path.is_file() {
        return Err(format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(edif_path)
}

fn configure_test_yosys_runtime_env(command: &mut Command, yosys_bin: &Path) {
    let Some(bin_dir) = yosys_bin.parent() else {
        return;
    };

    let mut runtime_entries = vec![bin_dir.to_path_buf()];
    if let Some(bundle_root) = bin_dir.parent() {
        let libexec_dir = bundle_root.join("libexec");
        if libexec_dir.is_dir() {
            runtime_entries.push(libexec_dir);
        }
    }

    let existing_entries = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    runtime_entries.extend(existing_entries);

    if let Ok(path) = env::join_paths(runtime_entries) {
        command.env("PATH", path);
    }
}

#[test]
fn place_mode_argument_matches_rust_cli_modes() {
    assert_eq!(
        place_mode_argument(ImplementationPlaceModeV1::TimingDriven),
        "timing"
    );
    assert_eq!(
        place_mode_argument(ImplementationPlaceModeV1::BoundingBox),
        "bounding"
    );
}

#[test]
fn path_argument_keeps_absolute_paths_outside_workdir() {
    let workdir = Path::new("/tmp/aspen-workdir");
    let local = workdir.join("local.xml");
    let external = Path::new("/tmp/aspen-output/result.bit");

    assert_eq!(path_argument(&local, workdir).unwrap(), "local.xml");
    assert_eq!(
        path_argument(external, workdir).unwrap(),
        "/tmp/aspen-output/result.bit"
    );
}

#[test]
fn latest_fde_stage_plans_match_current_cli_contract() {
    let workdir = env::temp_dir().join(format!(
        "aspen-fde-cli-contract-{}-{}",
        std::process::id(),
        now_millis().unwrap()
    ));
    fs::create_dir_all(&workdir).unwrap();

    let request = ImplementationRequestV1 {
        op_id: "impl-cli-contract".to_string(),
        project_name: "smoke".to_string(),
        project_dir: None,
        top_module: "top".to_string(),
        target_device_id: "FDP3P7".to_string(),
        constraint_xml: "<design name=\"top\"/>".to_string(),
        place_mode: ImplementationPlaceModeV1::TimingDriven,
        route_mode: ImplementationRouteModeV1::BreadthFirst,
        files: vec![SynthesisSourceFileV1 {
            path: "top.v".to_string(),
            content: "module top; endmodule\n".to_string(),
        }],
        synthesized_edif_path: Some(workdir.join("top.edf").to_string_lossy().to_string()),
    };

    let artifacts = plan_artifacts(&workdir, &request).unwrap();
    let toolchain = toolchain::ImplementationToolchainPaths {
        fde_bin_dir: PathBuf::from("/tmp/fde/bin"),
        fde_lib_dir: None,
        dc_cell: PathBuf::from("/tmp/hw_lib/dc_cell.xml"),
        pack_cell: PathBuf::from("/tmp/hw_lib/fdp3_cell.xml"),
        pack_dcp_lib: PathBuf::from("/tmp/hw_lib/fdp3_dcplib.xml"),
        pack_config: PathBuf::from("/tmp/hw_lib/fdp3_config.xml"),
        sta_iclib: PathBuf::from("/tmp/hw_lib/fdp3_con.xml"),
        arch: PathBuf::from("/tmp/hw_lib/fdp3p7_arch.xml"),
        delay: PathBuf::from("/tmp/hw_lib/fdp3p7_dly.xml"),
        cil: PathBuf::from("/tmp/hw_lib/fdp3p7_cil.xml"),
    };

    let plans = build_stage_plans(&toolchain, &workdir, &request, &artifacts).unwrap();
    let route_plan = plans
        .iter()
        .find(|plan| plan.stage == ImplementationStageKindV1::Route)
        .unwrap();
    let bitgen_plan = plans
        .iter()
        .find(|plan| plan.stage == ImplementationStageKindV1::Bitgen)
        .unwrap();

    assert!(
        !route_plan.args.iter().any(|arg| arg == "--mode"),
        "latest Rust fde route CLI no longer accepts --mode"
    );
    assert!(
        route_plan.args.iter().any(|arg| arg == "--cil"),
        "latest Rust fde route stage should pass the bundled CIL resource"
    );
    assert!(
        bitgen_plan.args.iter().any(|arg| arg == "--emit-sidecar"),
        "bitgen sidecar emission should be explicit"
    );
    assert!(bitgen_plan.args.iter().any(|arg| arg == "--sidecar"));
    assert!(artifacts
        .bitstream_sidecar_path
        .ends_with("smoke_top_bit.sidecar.txt"));

    let _ = fs::remove_dir_all(&workdir);
}

#[test]
fn implementation_smoke_test_runs_when_bundled_toolchains_are_available() {
    let fde_bin_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_FDE_DIR)
        .join("bin");
    let fde_binary = fde_bin_dir.join(fde_executable_name("fde"));
    if !fde_binary.is_file() {
        return;
    }

    let toolchain = toolchain::ImplementationToolchainPaths {
        fde_lib_dir: {
            let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(BUNDLED_FDE_DIR)
                .join("lib");
            candidate.is_dir().then_some(candidate)
        },
        dc_cell: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(FDE_DC_CELL_FILE),
        pack_cell: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(FDE_PACK_CELL_FILE),
        pack_dcp_lib: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(FDE_PACK_DCP_LIB_FILE),
        pack_config: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(FDE_PACK_CONFIG_FILE),
        sta_iclib: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(FDE_STA_ICLIB_FILE),
        arch: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(FDE_ARCH_FILE),
        delay: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(FDE_DELAY_FILE),
        cil: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(FDE_CIL_FILE),
        fde_bin_dir,
    };
    if !toolchain.dc_cell.is_file()
        || !toolchain.pack_cell.is_file()
        || !toolchain.pack_dcp_lib.is_file()
        || !toolchain.pack_config.is_file()
        || !toolchain.sta_iclib.is_file()
        || !toolchain.arch.is_file()
        || !toolchain.delay.is_file()
        || !toolchain.cil.is_file()
    {
        return;
    }

    let generated_at_ms = now_millis().unwrap();
    let workdir = resolve_workdir(
        &ImplementationRequestV1 {
            op_id: "impl-smoke".to_string(),
            project_name: "smoke".to_string(),
            project_dir: None,
            top_module: "top".to_string(),
            target_device_id: "FDP3P7".to_string(),
            constraint_xml: [
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
                "<design name=\"top\">",
                "  <port name=\"sw\" position=\"P151\"/>",
                "  <port name=\"led\" position=\"P7\"/>",
                "</design>",
                "",
            ]
            .join("\n"),
            place_mode: ImplementationPlaceModeV1::TimingDriven,
            route_mode: ImplementationRouteModeV1::TimingDriven,
            files: vec![SynthesisSourceFileV1 {
                path: "top.v".to_string(),
                content: [
                    "module top(",
                    "  input wire sw,",
                    "  output wire led",
                    ");",
                    "  assign led = sw;",
                    "endmodule",
                    "",
                ]
                .join("\n"),
            }],
            synthesized_edif_path: None,
        },
        generated_at_ms,
    )
    .unwrap();
    let synthesized_edif_path = match prepare_test_synthesized_edif(&workdir) {
        Ok(path) => path,
        Err(_) => return,
    };

    let request = ImplementationRequestV1 {
        op_id: "impl-smoke".to_string(),
        project_name: "smoke".to_string(),
        project_dir: None,
        top_module: "top".to_string(),
        target_device_id: "FDP3P7".to_string(),
        constraint_xml: [
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<design name=\"top\">",
            "  <port name=\"sw\" position=\"P151\"/>",
            "  <port name=\"led\" position=\"P7\"/>",
            "</design>",
            "",
        ]
        .join("\n"),
        place_mode: ImplementationPlaceModeV1::TimingDriven,
        route_mode: ImplementationRouteModeV1::TimingDriven,
        files: vec![SynthesisSourceFileV1 {
            path: "top.v".to_string(),
            content: [
                "module top(",
                "  input wire sw,",
                "  output wire led",
                ");",
                "  assign led = sw;",
                "endmodule",
                "",
            ]
            .join("\n"),
        }],
        synthesized_edif_path: Some(synthesized_edif_path.to_string_lossy().to_string()),
    };

    let report = run_fde_implementation_in_workdir(
        &toolchain,
        &workdir,
        &request,
        generated_at_ms,
        Instant::now(),
        |_, _| {},
    )
    .unwrap();

    assert!(report.success, "{}", report.log);
    assert!(report.timing_success, "{}", report.log);
    assert!(report
        .artifacts
        .bitstream_path
        .as_deref()
        .map(Path::new)
        .is_some_and(Path::is_file));
    assert!(report
        .artifacts
        .route_path
        .as_deref()
        .map(Path::new)
        .is_some_and(Path::is_file));
    assert!(!report.timing_report.is_empty());

    let _ = fs::remove_dir_all(&workdir);
}
