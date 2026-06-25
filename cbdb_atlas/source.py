from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import urllib.error
import urllib.request
import zipfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from cbdb_atlas.source_release import (
    SourceRelease,
    UpdateJob,
    UPDATE_JOB,
    dismiss_update,
    download_and_install,
    ensure_cbdb_views,
    fetch_remote_release,
    get_dismissed_sha,
    has_required_views,
    load_manifest,
    local_sha256,
    resolve_local_database,
    sha256_file,
    source_status,
)

__all__ = [
    "UPDATE_JOB",
    "dismiss_update",
    "ensure_cbdb_views",
    "fetch_remote_release",
    "migrate_legacy_database",
    "run_update_async",
    "source_status",
]


def migrate_legacy_database(target: Path) -> bool:
    """Import only from this project's data/source/ directory (no external paths)."""
    if target.is_file():
        return True
    source_dir = target.parent
    for name in ("cbdb.sqlite3", "cbdb_latest.db"):
        src = source_dir / name
        if src.is_file() and src.resolve() != target.resolve():
            source_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, target)
            return True
    return False


def run_update_async(
    source_dir: Path,
    target_db: Path,
    project_root: Path,
    latest_url: str,
    on_ready: Callable[[], None] | None = None,
) -> bool:
    with UPDATE_JOB.lock:
        if UPDATE_JOB.in_progress:
            return False
        UPDATE_JOB.in_progress = True
        UPDATE_JOB.finished = False
        UPDATE_JOB.error = None
        UPDATE_JOB.phase = "starting"
        UPDATE_JOB.message = "準備更新…"

    def _worker() -> None:
        try:
            release = fetch_remote_release(latest_url, project_root=project_root)
            if not release:
                raise RuntimeError("無法獲取 CBDB 最新版本信息")

            def progress(msg: str) -> None:
                UPDATE_JOB.message = msg
                UPDATE_JOB.phase = "download"

            download_and_install(source_dir, target_db, release, project_root, progress)
            UPDATE_JOB.phase = "done"
            UPDATE_JOB.message = "更新完成"
            UPDATE_JOB.finished = True
            if on_ready:
                on_ready()
        except Exception as exc:
            UPDATE_JOB.error = str(exc)
            UPDATE_JOB.phase = "error"
            UPDATE_JOB.message = str(exc)
        finally:
            UPDATE_JOB.in_progress = False

    threading.Thread(target=_worker, name="cbdb-atlas-update", daemon=True).start()
    return True
