# Tauri + Vue + TypeScript

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## FPGA Toolchains

- Bundle Aspen's Yosys toolchain: `pnpm prepare:yosys-bundle`
- Aspen links Rust `fde` directly from crates.io via `fde = "1.0"`.

## Self-Updates

- Aspen checks signed GitHub Releases metadata from `latest.json`.
- Tagged CI releases build updater artifacts with `src-tauri/tauri.release.conf.json`.
- In-app updates are enabled only for official tagged release builds (`ASPEN_ENABLE_UPDATER=1` during packaging).
- Maintainers must provide:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- The release workflow generates `latest.json` with `scripts/generate_updater_manifest.py`.

## Windows USB Driver Packaging

- Windows release bundles now include `aspen-driver-installer.exe`, a helper built from `tools/aspen-driver-installer/`.
- The helper uses `libwdi` via `wdi-rs` to prepare and install Aspen's WinUSB driver package for `VID=0x2200`, `PID=0x2008`, interface `0`.
- `pnpm tauri build` invokes `scripts/prepare-tauri-build.mjs`, which compiles the helper on Windows and stages it under `src-tauri/resource/windows-driver/`.
- The NSIS installer runs that helper from `src-tauri/windows/driver-hooks.nsh` after the app files are copied.
- Windows `setup.exe` now requests elevation during install so the driver package can be installed in the same flow.

## BRAM Notes

- Aspen synthesis now keeps inferred memories intact long enough for Yosys BRAM mapping.
- Project-side memory assets such as `.mem` files are staged together with HDL sources, so
  `$readmemh("file.mem", mem)` works when the asset is part of the Aspen project.
- A reference design lives in `examples/bram_inferred_demo.v` with
  `examples/bram_inferred_init.mem`.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
