from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass
class AppConfig:
    project_root: Path
    cbdb_database: Path
    latest_json_url: str
    host: str
    port: int

    @property
    def scripts_dir(self) -> Path:
        return self.project_root / "scripts"

    @property
    def source_dir(self) -> Path:
        return self.cbdb_database.parent

    @property
    def queries_dir(self) -> Path:
        return self.project_root / "queries"


def load_config(config_path: Path | None = None, project_root: Path | None = None) -> AppConfig:
    root = (project_root or Path(__file__).resolve().parents[1]).resolve()
    path = config_path or (root / "config" / "default.yaml")
    with path.open(encoding="utf-8") as fh:
        raw: dict[str, Any] = yaml.safe_load(fh)

    db_path = Path(raw["cbdb"]["database"])
    if not db_path.is_absolute():
        db_path = (root / db_path).resolve()

    server = raw.get("server", {})
    return AppConfig(
        project_root=root,
        cbdb_database=db_path,
        latest_json_url=str(
            raw["cbdb"].get(
                "latest_json_url",
                "https://raw.githubusercontent.com/cbdb-project/cbdb_sqlite/master/latest.json",
            )
        ),
        host=str(server.get("host", "127.0.0.1")),
        port=int(server.get("port", 8770)),
    )
