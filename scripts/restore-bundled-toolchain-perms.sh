#!/usr/bin/env bash

set -euo pipefail

root="${1:-src-tauri/vendor}"

set_exec_bits() {
  local dir="$1"
  if [ -d "$dir" ]; then
    find "$dir" -type f -exec chmod +x {} +
  fi
}

set_exec_bits "$root/yosys/bin"
set_exec_bits "$root/yosys/libexec"
set_exec_bits "$root/fde/bin"

if [ -d "$root/yosys/lib" ]; then
  find "$root/yosys/lib" -maxdepth 1 -type f \( -name 'ld-linux-*.so*' -o -name 'ld-musl-*.so*' \) -exec chmod +x {} +
fi
