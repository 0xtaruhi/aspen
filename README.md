# Aspen

<div align="center">

Native FPGA desktop workbench for the FDE platform.

[![Release](https://img.shields.io/github/v/release/0xtaruhi/aspen?display_name=tag&sort=semver)](https://github.com/0xtaruhi/aspen/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/0xtaruhi/aspen/ci.yml?branch=main&label=CI)](https://github.com/0xtaruhi/aspen/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-4f46e5)](https://github.com/0xtaruhi/aspen/releases)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Vue](https://img.shields.io/badge/Vue-3.x-42b883?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust)](https://www.rust-lang.org/)

</div>

Aspen is a native desktop application for writing, building, programming, and debugging FPGA projects on the FDE platform. It combines a modern desktop UI with a Rust-first backend: synthesis is bundled through Yosys, implementation runs through [`fde`](https://crates.io/crates/fde), and hardware communication is driven by [`vlfd-rs`](https://crates.io/crates/vlfd-rs).

The goal is simple: keep the full student and lab workflow in one place without falling back to a pile of separate scripts, command windows, and vendor tools.

## Highlights

- Full desktop flow in one app: source editing, synthesis, pin planning, implementation, programming, and live hardware interaction.
- Native Rust backend: Aspen links `fde = "1.1.1"` directly from crates.io instead of shelling out to a legacy monolith.
- Virtual device platform: test designs against interactive switches, buttons, displays, UART, VGA, audio PWM, and more.
- Hardware-aware workflow: board discovery, programming, data streaming, and hotplug handling are built into the app.
- Signed release updates: official tagged releases publish updater metadata so Aspen can check for updates in-app.
- Multilingual UI: English, Simplified Chinese, and Traditional Chinese are supported across the desktop experience.

## What Aspen Covers

### Project authoring

- Multi-file HDL projects with project-level metadata.
- Top file and top module selection inside the app.
- Integrated editor workflow for quick iteration.

### FPGA build flow

- Synthesis with a bundled Yosys toolchain.
- Pin planning for FDE boards.
- Implementation flow driven by the Rust `fde` backend.
- Stage-aware reports, logs, and generated artifacts.

### Board and runtime workflow

- USB board discovery and programming.
- Live signal streaming from hardware.
- Virtual device bindings to top-level signals.
- On-canvas interaction for input devices and live previews for output devices.

## Virtual Device Platform

Aspen ships with a built-in virtual lab bench so you can drive and observe designs without building a separate test harness UI.

Current device set includes:

- Inputs: switch, push button, dip switch bank, quadrature encoder, matrix keypad
- Displays: LED, LED bar, LED matrix, seven-segment display, HD44780 text LCD, VGA display
- Debug and I/O: UART terminal, audio PWM monitor

Several devices also support fast bus binding, device-specific settings, and built-in manuals with waveform diagrams.

## Quick Start

### Download a release

Grab the latest packaged build from [GitHub Releases](https://github.com/0xtaruhi/aspen/releases).

Official releases currently ship installer artifacts for:

- macOS: `.dmg`
- Windows: `.exe` / `.msi`
- Linux: `.AppImage`, `.deb`, `.rpm`

### Build from source

Prerequisites:

- Node.js 24+
- `pnpm` 10+
- Rust stable

Install dependencies:

```bash
pnpm install
```

Prepare the bundled Yosys toolchain from the pinned Git submodule:

```bash
pnpm prepare:yosys-bundle
```

The command initializes `third_party/yosys` and its nested submodules on first use,
then builds Yosys and ABC with CMake/Ninja. The initial pin is stable **v0.68**.
Aspen ships the resulting executables, technology data and runtime dependencies;
end users do not need Git, a compiler, Python, or a system Yosys installation.

Additional build prerequisites are Git, a C++20 compiler, CMake >= 3.28, Ninja,
Python >= 3.11, Flex >= 2.6 and Bison >= 3.8:

- macOS: `brew install cmake ninja bison flex`; use Xcode Command Line Tools for
  Clang. Add `$(brew --prefix bison)/bin` and `$(brew --prefix flex)/bin` to `PATH`.
- Ubuntu 22.04: install `gcc-12 g++-12 ninja-build bison flex pkg-config`, provide
  Python >= 3.11 and CMake >= 3.28, and run with `CC=gcc-12 CXX=g++-12`.
  CI installs CMake 3.31.6 using Python 3.12. Build release Linux artifacts on
  Ubuntu 22.04 to preserve the existing glibc compatibility baseline.
- Windows x64: use MSYS2 UCRT64 with `bison`, `flex` and the
  `mingw-w64-ucrt-x86_64-` packages `gcc` (>= 16), `cmake`, `ninja`, `python`
  and `pkgconf`. Put the MSYS2 `ucrt64/bin` directory first in `PATH`, followed
  by `usr/bin`, and use Windows Node.js/pnpm. The produced executables run
  outside MSYS2; required compiler runtime DLLs are bundled automatically.
  Windows 10 1903 or newer is required for the embedded UTF-8 process manifests
  that let Yosys and ABC handle non-ASCII installation and project paths.

Completed builds are cached under `src-tauri/target/yosys`. Set
`ASPEN_YOSYS_CACHE_DIR` to change that location, and
`CMAKE_BUILD_PARALLEL_LEVEL` to control compilation parallelism (default: up to
8 jobs). Repeated preparation validates and reuses the installation. Source
commits, compiler versions, flags and build recipe changes invalidate the
appropriate cache. `--force` rebuilds the current configuration; `--check`
validates an existing bundle without needing build tools. Every check runs ABC
LUT mapping and EDIF export from a relocated directory with spaces and Unicode
characters and without the developer's toolchain paths.

To upgrade to another stable release (replace `<stable-tag>` with its exact tag):

```bash
git -C third_party/yosys fetch --depth 1 origin tag <stable-tag>
git -C third_party/yosys checkout --detach <stable-tag>
git -C third_party/yosys submodule update --init --recursive --depth 1
pnpm prepare:yosys-bundle
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
git add third_party/yosys
```

Commit the submodule pointer in the Aspen repository after the regressions pass.
ABC and the other dependencies remain pinned by the selected Yosys commit.
The bundler refuses tracked source edits rather than caching an unrecorded patch.
CI keys the installation cache by the Git pointer, OS/architecture, runner image
and build recipe, and validates cache hits. Changes to this toolchain run all
three native toolchain jobs. Package jobs also validate the extracted Yosys;
`--check-packaged <directory>` permits executable changes caused by code signing
while retaining metadata, file-set, data integrity and runtime checks.

Prepare the bundled `slang-server` language server:

```bash
pnpm prepare:slang-server-bundle
```

`pnpm tauri dev` and `pnpm tauri build` will also prepare the bundled `slang-server` automatically when it is missing.

Run the desktop app in development mode:

```bash
pnpm tauri dev
```

Build production packages:

```bash
pnpm tauri build
```

## Development Workflow

Useful local commands:

```bash
pnpm typecheck
pnpm test:ci
cargo check --manifest-path src-tauri/Cargo.toml
```

Formatting:

```bash
pnpm format
cargo fmt --manifest-path src-tauri/Cargo.toml
```

Aspen uses a protected `main` branch:

- changes land through pull requests
- `Pipeline` must pass before merge
- direct pushes to `main` are blocked

## Toolchain and Packaging Notes

### FPGA backend

- Aspen bundles its Yosys toolchain with `pnpm prepare:yosys-bundle`.
- Aspen bundles `slang-server` with `pnpm prepare:slang-server-bundle`.
- Implementation is provided by `fde = "1.1.1"` from crates.io.
- USB communication is provided by `vlfd-rs = "4"`.

### HDL editor language server

- Development builds look for `slang-server` in `src-tauri/vendor/slang-server/`.
- Packaged desktop builds ship the same files as bundled Tauri resources under `vendor/slang-server/`.
- CI prepares the same `src-tauri/vendor/slang-server/` directory before Rust checks and package builds.
- `ASPEN_SLANG_SERVER=/absolute/path/to/slang-server` can override the bundled binary for debugging, but normal development and CI should use the bundled copy.

### Self-updates

- Aspen checks signed GitHub Release metadata from `latest.json`.
- In-app updates are enabled only for official tagged release builds.
- Release packaging uses `src-tauri/tauri.release.conf.json`.
- Start a release with `pnpm release:prepare X.Y.Z`; it creates `release/vX.Y.Z` and synchronizes every Aspen version file.
- After the release PR and the `Pre-publish` workflow pass, push tag `vX.Y.Z` to build, sign, and publish all platform packages.

### Windows driver packaging

- Windows releases bundle `aspen-driver-installer.exe`.
- The helper installs Aspen's WinUSB driver package for `VID=0x2200`, `PID=0x2008`, interface `0`.
- The NSIS installer invokes the helper during install so first-time hardware setup is part of the normal app installation flow.

## Examples

[`examples/`](examples) contains complete, ready-to-open Aspen projects:

- Device labs cover every supported virtual-device type with focused HDL designs.
- Showcase projects combine several devices into a calculator, synthesizer, and VGA game.
- Loose HDL smoke tests remain available for scripts and quick synthesis checks.

See the [example project catalog](examples/README.md) for controls and usage.

## Repository Layout

```text
src/         Vue 3 frontend
src-tauri/   Tauri host, Rust backend integration, packaging config
scripts/     build, release, and toolchain helper scripts
examples/    example HDL designs and memory assets
tools/       auxiliary release and platform tooling
```

## Contributing

Contributions are welcome, but keep changes reviewable and pipeline-clean.

- open a branch and send a PR
- keep frontend and backend changes scoped
- do not bypass CI or merge broken checks

If you are changing build, packaging, updater, or hardware-driver behavior, update the relevant scripts and docs in the same PR.
