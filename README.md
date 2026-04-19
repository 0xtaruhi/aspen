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
- Native Rust backend: Aspen links `fde = "1.0"` directly from crates.io instead of shelling out to a legacy monolith.
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

Prepare the bundled Yosys toolchain:

```bash
pnpm prepare:yosys-bundle
```

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
- Implementation is provided by `fde = "1.0"` from crates.io.
- USB communication is provided by `vlfd-rs = "2"`.

### Self-updates

- Aspen checks signed GitHub Release metadata from `latest.json`.
- In-app updates are enabled only for official tagged release builds.
- Release packaging uses `src-tauri/tauri.release.conf.json`.

### Windows driver packaging

- Windows releases bundle `aspen-driver-installer.exe`.
- The helper installs Aspen's WinUSB driver package for `VID=0x2200`, `PID=0x2008`, interface `0`.
- The NSIS installer invokes the helper during install so first-time hardware setup is part of the normal app installation flow.

## Examples

The repository includes small reference designs under [`examples/`](examples):

- [`examples/audio_pwm_sky_demo.v`](examples/audio_pwm_sky_demo.v)
- [`examples/bram_inferred_demo.v`](examples/bram_inferred_demo.v)
- [`examples/bram_inferred_init.mem`](examples/bram_inferred_init.mem)
- [`examples/vga_test_rgb332.v`](examples/vga_test_rgb332.v)

These are useful both as smoke tests and as reference projects for Aspen's virtual device platform.

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
