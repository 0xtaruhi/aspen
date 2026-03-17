#!/usr/bin/env bash

set -euo pipefail

root="${1:-src-tauri/vendor}"

set_exec_bits() {
  local dir="$1"
  if [ -d "$dir" ]; then
    find "$dir" -type f -exec chmod +x {} +
  fi
}

set_top_level_exec_bits() {
  local dir="$1"
  if [ -d "$dir" ]; then
    find "$dir" -maxdepth 1 -type f -exec chmod +x {} +
  fi
}

set_exec_bits "$root/yosys/bin"
set_exec_bits "$root/yosys/libexec"
set_top_level_exec_bits "$root/yosys/lib"
set_top_level_exec_bits "$root/yosys/lib64"
set_exec_bits "$root/fde/bin"
