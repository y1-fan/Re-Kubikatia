#!/usr/bin/env python3
"""Build the Zotero plugin XPI.

Usage:
    py -3 build.py

The archive is written to dist/kubikat-<version>.xpi.  Only runtime
files are included; tests, the build script and dist/ are left out.
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"


def runtime_files() -> list[Path]:
    files = [
        ROOT / "manifest.json",
        ROOT / "bootstrap.js",
        ROOT / "prefs.js",
        ROOT / "README.md",
    ]
    for directory in ("content", "locale"):
        base = ROOT / directory
        if not base.is_dir():
            raise SystemExit(f"missing directory: {base}")
        files.extend(sorted(path for path in base.rglob("*") if path.is_file()))
    return files


def main() -> int:
    manifest_path = ROOT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = manifest["version"]
    plugin_id = manifest["applications"]["zotero"]["id"]

    required = [
        ROOT / "bootstrap.js",
        ROOT / "prefs.js",
        ROOT / "content" / "dialog.xhtml",
        ROOT / "content" / "primo.js",
        ROOT / "content" / "mapper.js",
        ROOT / "content" / "kubikat.js",
        ROOT / "locale" / "en-US" / "kubikat.ftl",
        ROOT / "locale" / "zh-CN" / "kubikat.ftl",
    ]
    missing = [path for path in required if not path.is_file()]
    if missing:
        raise SystemExit("missing required file(s): " + ", ".join(str(p) for p in missing))

    DIST.mkdir(exist_ok=True)
    out = DIST / f"kubikat-{version}.xpi"
    if out.exists():
        out.unlink()

    files = runtime_files()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())

    size = out.stat().st_size
    print(f"built {out}")
    print(f"  plugin id: {plugin_id}")
    print(f"  version:   {version}")
    print(f"  files:     {len(files)}")
    print(f"  size:      {size:,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
