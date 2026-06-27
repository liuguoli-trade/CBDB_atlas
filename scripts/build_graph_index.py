#!/usr/bin/env python3
"""Build graph_index.sqlite from CBDB source database."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from cbdb_atlas.config import load_config
from cbdb_atlas.visual.graph_index import build_graph_index, default_index_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build CBDB Atlas graph index")
    parser.add_argument("--config", type=Path, default=None, help="Config YAML path")
    parser.add_argument(
        "--index",
        type=Path,
        default=None,
        help="Output index path (default: data/local/graph_index.sqlite)",
    )
    args = parser.parse_args()
    cfg = load_config(args.config, project_root=ROOT)
    source = cfg.cbdb_database
    if not source.is_file():
        print(f"Error: CBDB database not found: {source}", file=sys.stderr)
        sys.exit(1)
    index_path = args.index or default_index_path(ROOT)
    print(f"Building index from {source} -> {index_path}")
    build_graph_index(source, index_path)
    print("Done.")


if __name__ == "__main__":
    main()
