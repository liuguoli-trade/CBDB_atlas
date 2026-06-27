from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


class QueryRegistry:
    """Loads external SQL files from queries/ directory."""

    def __init__(self, queries_dir: Path) -> None:
        self.queries_dir = queries_dir
        # name -> (mtime, sql)
        self._cache: dict[str, tuple[float, str]] = {}
        manifest_path = queries_dir / "manifest.yaml"
        self.manifest: dict[str, Any] = {}
        if manifest_path.is_file():
            with manifest_path.open(encoding="utf-8") as fh:
                self.manifest = yaml.safe_load(fh) or {}

    def list_queries(self) -> list[dict[str, Any]]:
        items = []
        for name, meta in (self.manifest.get("queries") or {}).items():
            items.append({"id": name, **meta})
        return items

    def get_sql(self, name: str) -> str:
        meta = (self.manifest.get("queries") or {}).get(name)
        if meta and meta.get("file"):
            path = self.queries_dir / meta["file"]
        else:
            path = self.queries_dir / f"{name}.sql"
        if not path.is_file():
            raise KeyError(f"Query not found: {name}")
        mtime = path.stat().st_mtime
        cached = self._cache.get(name)
        if cached and cached[0] == mtime:
            return cached[1]
        sql = path.read_text(encoding="utf-8").strip()
        self._cache[name] = (mtime, sql)
        return sql

    def get_source(self, name: str) -> str:
        return self.get_sql(name)
