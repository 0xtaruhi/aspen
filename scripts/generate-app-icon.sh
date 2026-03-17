#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_SVG="$ROOT_DIR/src-tauri/icons/icon-source.svg"

if [[ ! -f "$SRC_SVG" ]]; then
  echo "Missing icon source: $SRC_SVG" >&2
  exit 1
fi

cd "$ROOT_DIR"
pnpm exec tauri icon src-tauri/icons/icon-source.svg -o src-tauri/icons
