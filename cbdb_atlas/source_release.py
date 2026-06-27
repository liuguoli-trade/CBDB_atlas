from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import subprocess
import tempfile
import urllib.error
import urllib.request
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

DEFAULT_LATEST_JSON_URL = (
    "https://raw.githubusercontent.com/cbdb-project/cbdb_sqlite/master/latest.json"
)


@dataclass
class SourceRelease:
    sqlite_filename: str
    sha256: str
    generated_at_utc: str
    download_url: str
    format: str = "sqlite3"


class UpdateJob:
    def __init__(self) -> None:
        self.lock = __import__("threading").Lock()
        self.in_progress = False
        self.phase = "idle"
        self.message = ""
        self.error: str | None = None
        self.finished = False


UPDATE_JOB = UpdateJob()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while data := fh.read(chunk_size):
            digest.update(data)
    return digest.hexdigest()


def manifest_path(source_dir: Path) -> Path:
    return source_dir / "manifest.json"


def dismiss_path(source_dir: Path) -> Path:
    return source_dir / "update_dismissed.json"


def load_manifest(source_dir: Path) -> dict[str, Any] | None:
    path = manifest_path(source_dir)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save_manifest(source_dir: Path, release: SourceRelease, db_filename: str) -> None:
    source_dir.mkdir(parents=True, exist_ok=True)
    manifest_path(source_dir).write_text(
        json.dumps(
            {
                "sqlite_filename": release.sqlite_filename,
                "sha256": release.sha256.lower(),
                "generated_at_utc": release.generated_at_utc,
                "installed_at_utc": datetime.now(timezone.utc).isoformat(),
                "database_path": db_filename,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def get_dismissed_sha(source_dir: Path) -> str | None:
    path = dismiss_path(source_dir)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return str(data.get("remote_sha256", "")).lower() or None
    except (json.JSONDecodeError, OSError):
        return None


def dismiss_update(source_dir: Path, remote_sha: str) -> None:
    source_dir.mkdir(parents=True, exist_ok=True)
    dismiss_path(source_dir).write_text(
        json.dumps(
            {
                "remote_sha256": remote_sha.lower(),
                "dismissed_at_utc": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def clear_dismiss(source_dir: Path) -> None:
    path = dismiss_path(source_dir)
    if path.is_file():
        path.unlink()


def _parse_release_json(data: dict[str, Any]) -> SourceRelease:
    return SourceRelease(
        sqlite_filename=str(data["sqlite_filename"]),
        sha256=str(data["sha256"]).lower(),
        generated_at_utc=str(data.get("generated_at_utc", "")),
        download_url=str(data["download_url"]),
        format=str(data.get("format", "sqlite3")),
    )


def load_release_from_path(path: Path) -> SourceRelease | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return _parse_release_json(data)
    except (OSError, KeyError, json.JSONDecodeError, TypeError):
        return None


def fetch_remote_release(
    url: str = DEFAULT_LATEST_JSON_URL,
    project_root: Path | None = None,
) -> SourceRelease | None:
    if project_root is not None:
        from cbdb_atlas.upstream import upstream_latest_json

        local = upstream_latest_json(project_root)
        if local is not None:
            release = load_release_from_path(local)
            if release is not None:
                return release
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "cbdb-atlas/0.1"})
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode())
        return _parse_release_json(data)
    except (urllib.error.URLError, TimeoutError, OSError, KeyError, json.JSONDecodeError):
        return None


def resolve_local_database(source_dir: Path, configured_path: Path) -> Path | None:
    candidates = [configured_path, source_dir / "cbdb.sqlite3", source_dir / configured_path.name]
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if resolved.is_file():
            return resolved
    return None


def local_sha256(db_path: Path, manifest: dict[str, Any] | None) -> str | None:
    if manifest and manifest.get("sha256"):
        return str(manifest["sha256"]).lower()
    # CBDB 發佈包通常爲數 GB；無 manifest 時不現場哈希，避免 MemoryError。
    try:
        if db_path.stat().st_size > 50 * 1024 * 1024:
            return None
        return sha256_file(db_path).lower()
    except (OSError, MemoryError):
        return None


PEOPLE_VIEW_NIANHAO_DYNASTY_COLS = frozenset({"c_by_dynasty_chn", "c_dy_nh_dynasty_chn"})
KIN_VIEW_SORT_COLS = frozenset(
    {"c_upstep", "c_dwnstep", "c_colstep", "c_marstep", "c_pick_sorting"}
)


def has_required_views(db_path: Path) -> bool:
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='view' AND name='View_PeopleData' LIMIT 1"
        ).fetchone()
        conn.close()
        return row is not None
    except sqlite3.Error:
        return False


def people_view_has_nianhao_dynasty(db_path: Path) -> bool:
    if not has_required_views(db_path):
        return False
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cols = {
            row[1]
            for row in conn.execute("PRAGMA table_info(View_PeopleData)").fetchall()
        }
        conn.close()
        return PEOPLE_VIEW_NIANHAO_DYNASTY_COLS.issubset(cols)
    except sqlite3.Error:
        return False


def _create_views_script(project_root: Path) -> Path:
    from cbdb_atlas.upstream import upstream_create_views_script

    script = upstream_create_views_script(project_root) or (
        project_root / "scripts" / "create_views.sh"
    )
    if not script.is_file():
        raise RuntimeError(
            f"CBDB 缺少查詢視圖。請運行: bash scripts/create_views.sh <database>"
        )
    return script


def _extract_view_sql(project_root: Path, view_name: str, finished_echo: str) -> str:
    script = _create_views_script(project_root)
    text = script.read_text(encoding="utf-8")
    marker = f"DROP VIEW IF EXISTS {view_name};"
    start = text.index(marker)
    end = text.index(finished_echo, start)
    block = text[start:end]
    lines = [
        line
        for line in block.splitlines()
        if line.strip() not in ("SQL", "<<'SQL'", "<<SQL")
    ]
    return "\n".join(lines)


def _extract_people_view_sql(project_root: Path) -> str:
    return _extract_view_sql(
        project_root,
        "View_PeopleData",
        'echo "Finished view View_PeopleData."',
    )


def kin_view_has_sort_columns(db_path: Path) -> bool:
    if not has_required_views(db_path):
        return False
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cols = {
            row[1]
            for row in conn.execute("PRAGMA table_info(View_KinAddrData)").fetchall()
        }
        conn.close()
        return KIN_VIEW_SORT_COLS.issubset(cols)
    except sqlite3.Error:
        return False


def _extract_kinaddr_view_sql(project_root: Path) -> str:
    return _extract_view_sql(
        project_root,
        "View_KinAddrData",
        'echo "Finished view View_KinAddrData."',
    )


def _apply_kinaddr_view_sql(db_path: Path, project_root: Path) -> None:
    sql = _extract_kinaddr_view_sql(project_root)
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(sql)
        conn.commit()
    finally:
        conn.close()
    if not kin_view_has_sort_columns(db_path):
        raise RuntimeError("無法更新 View_KinAddrData（缺少親屬排序欄位）")


def _apply_people_view_sql(db_path: Path, project_root: Path) -> None:
    sql = _extract_people_view_sql(project_root)
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(sql)
        conn.commit()
    finally:
        conn.close()
    if not people_view_has_nianhao_dynasty(db_path):
        raise RuntimeError("無法更新 View_PeopleData（缺少年號朝代欄位）")


def _run_create_views_shell(db_path: Path, project_root: Path) -> None:
    script = _create_views_script(project_root)
    for cmd in (["bash", str(script), str(db_path)], ["sh", str(script), str(db_path)]):
        try:
            subprocess.run(cmd, check=True, capture_output=True, text=True)
            if has_required_views(db_path):
                return
        except (FileNotFoundError, subprocess.CalledProcessError):
            continue
    raise RuntimeError("無法創建 CBDB 視圖，請手動運行 create_views.sh")


def ensure_cbdb_views(db_path: Path, project_root: Path) -> None:
    if not has_required_views(db_path):
        _run_create_views_shell(db_path, project_root)
    if not people_view_has_nianhao_dynasty(db_path):
        _apply_people_view_sql(db_path, project_root)
    if not kin_view_has_sort_columns(db_path):
        _apply_kinaddr_view_sql(db_path, project_root)


def source_status(
    source_dir: Path,
    configured_db: Path,
    latest_url: str = DEFAULT_LATEST_JSON_URL,
    project_root: Path | None = None,
) -> dict[str, Any]:
    from cbdb_atlas.upstream import upstream_status

    remote = fetch_remote_release(latest_url, project_root=project_root)
    local_db = resolve_local_database(source_dir, configured_db)
    manifest = load_manifest(source_dir)
    local_sha = local_sha256(local_db, manifest) if local_db else None
    dismissed_sha = get_dismissed_sha(source_dir)

    up_to_date = bool(remote and local_sha and local_sha == remote.sha256)
    needs_download = remote is not None and local_db is None
    hash_mismatch = bool(remote and local_sha and local_sha != remote.sha256)
    dismissed = bool(remote and dismissed_sha and dismissed_sha == remote.sha256 and hash_mismatch)
    update_available = (needs_download or hash_mismatch) and not dismissed

    return {
        "check_ok": remote is not None,
        "has_local": local_db is not None,
        "up_to_date": up_to_date,
        "update_available": update_available,
        "needs_download": needs_download,
        "dismissed": dismissed,
        "views_ready": has_required_views(local_db) if local_db else False,
        "local": {
            "path": str(local_db) if local_db else None,
            "sha256": local_sha,
            "manifest": manifest,
        },
        "remote": asdict(remote) if remote else None,
        "latest_json_url": latest_url,
        "upstream": upstream_status(project_root) if project_root else None,
        "update_in_progress": UPDATE_JOB.in_progress,
        "update_phase": UPDATE_JOB.phase,
        "update_message": UPDATE_JOB.message,
        "update_error": UPDATE_JOB.error,
    }


def _download_zip(url: str, dest: Path, on_progress: Callable[[str], None] | None = None) -> None:
    if on_progress:
        on_progress("正在下載 CBDB 數據包…")
    req = urllib.request.Request(url, headers={"User-Agent": "cbdb-atlas/0.1"})
    with urllib.request.urlopen(req, timeout=600) as resp, dest.open("wb") as out:
        total = int(resp.headers.get("Content-Length", 0))
        done = 0
        while chunk := resp.read(1024 * 256):
            out.write(chunk)
            done += len(chunk)
            if on_progress and total:
                pct = min(99, int(done * 100 / total))
                on_progress(f"下載中… {pct}%")


def download_and_install(
    source_dir: Path,
    target_db: Path,
    release: SourceRelease,
    project_root: Path,
    on_progress: Callable[[str], None] | None = None,
) -> Path:
    source_dir.mkdir(parents=True, exist_ok=True)
    target_db.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="cbdb-dl-") as tmp:
        zip_path = Path(tmp) / "latest.zip"
        _download_zip(release.download_url, zip_path, on_progress)

        if on_progress:
            on_progress("正在解壓…")
        extract_dir = Path(tmp) / "extract"
        extract_dir.mkdir()
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)

        sqlite_files = list(extract_dir.rglob("*.sqlite3")) + list(extract_dir.rglob("*.db"))
        if not sqlite_files:
            raise RuntimeError("下載包中未找到 SQLite 數據庫文件")

        candidate = max(sqlite_files, key=lambda p: p.stat().st_size)
        if on_progress:
            on_progress("正在校驗文件…")
        actual_sha = sha256_file(candidate).lower()
        if actual_sha != release.sha256.lower():
            raise RuntimeError(f"校驗失敗：期望 {release.sha256[:12]}…，實際 {actual_sha[:12]}…")

        staging = target_db.with_suffix(target_db.suffix + ".new")
        if staging.is_file():
            staging.unlink()
        shutil.copy2(candidate, staging)

        if on_progress:
            on_progress("正在創建查詢視圖…")
        ensure_cbdb_views(staging, project_root)

        if target_db.is_file():
            backup = target_db.with_suffix(target_db.suffix + ".bak")
            if backup.is_file():
                backup.unlink()
            target_db.replace(backup)
        staging.replace(target_db)

    save_manifest(source_dir, release, target_db.name)
    clear_dismiss(source_dir)
    return target_db
