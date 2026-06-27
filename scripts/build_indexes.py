#!/usr/bin/env python3
"""Build person search FTS and graph indexes in one step."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    scripts = ("build_search_index.py", "build_graph_index.py")
    for name in scripts:
        script = ROOT / "scripts" / name
        print(f"=== {name} ===")
        rc = subprocess.call([sys.executable, str(script)], cwd=str(ROOT))
        if rc != 0:
            sys.exit(rc)
    print("All indexes built.")


if __name__ == "__main__":
    main()
