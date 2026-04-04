# Tauri + Vue + TypeScript

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## FPGA Toolchains

- Bundle Aspen's Yosys toolchain: `pnpm prepare:yosys-bundle`
- Bundle Aspen's Rust `fde` implementation toolchain: `pnpm prepare:fde-bundle`

`pnpm prepare:fde-bundle` builds `fde` from a local `../fde-rs-standalone` or `../fde-rs` checkout when available. You can override the source with `FDE_RS_DIR=/path/to/fde-rs`.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
