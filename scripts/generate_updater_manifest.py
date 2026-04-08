#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import sys


@dataclass(frozen=True)
class TargetMetadata:
    platform: str
    asset: str


def load_metadata(metadata_dir: Path) -> list[TargetMetadata]:
    entries: list[TargetMetadata] = []
    for path in sorted(metadata_dir.glob('*.json')):
        data = json.loads(path.read_text())
        platform = str(data.get('platform', '')).strip()
        asset = str(data.get('asset', '')).strip()
        if not platform or not asset:
            raise SystemExit(f'invalid updater metadata file: {path}')
        entries.append(TargetMetadata(platform=platform, asset=asset))
    if not entries:
        raise SystemExit(f'no updater target metadata found under {metadata_dir}')
    return entries


def find_unique_asset(assets_dir: Path, asset_name: str) -> Path:
    matches = [path for path in assets_dir.rglob(asset_name) if path.is_file()]
    if len(matches) != 1:
        raise SystemExit(
            f'expected exactly one asset named {asset_name!r}, found {len(matches)} under {assets_dir}'
        )
    return matches[0]


def main() -> int:
    parser = argparse.ArgumentParser(description='Generate a Tauri updater latest.json manifest')
    parser.add_argument('--assets-dir', required=True, help='Directory containing release artifacts')
    parser.add_argument('--repo', required=True, help='GitHub repository in owner/name form')
    parser.add_argument('--tag', required=True, help='Release tag name, e.g. v1.0.0')
    parser.add_argument('--out', required=True, help='Output latest.json path')
    parser.add_argument('--notes', default='', help='Optional release notes string')
    args = parser.parse_args()

    assets_dir = Path(args.assets_dir).resolve()
    metadata_dir = assets_dir / 'release-metadata'
    out_path = Path(args.out).resolve()

    targets = load_metadata(metadata_dir)
    platforms: dict[str, dict[str, str]] = {}
    for target in targets:
        asset_path = find_unique_asset(assets_dir, target.asset)
        sig_path = asset_path.with_name(asset_path.name + '.sig')
        if not sig_path.is_file():
            raise SystemExit(f'missing signature for updater asset: {sig_path}')

        signature = sig_path.read_text().strip()
        if not signature:
            raise SystemExit(f'empty updater signature: {sig_path}')

        platforms[target.platform] = {
            'signature': signature,
            'url': f'https://github.com/{args.repo}/releases/download/{args.tag}/{asset_path.name}',
        }

    manifest: dict[str, object] = {
        'version': args.tag,
        'pub_date': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'platforms': platforms,
    }
    if args.notes:
        manifest['notes'] = args.notes

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
