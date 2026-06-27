"""FTS5 person search index (local auxiliary DB)."""

from __future__ import annotations

import hashlib
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SEARCH_JOB = {"in_progress": False, "phase": "", "progress": 0.0, "error": None}
_SEARCH_LOCK = threading.Lock()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS search_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS person_fts USING fts5(
    person_id UNINDEXED,
    name_chn,
    name,
    surname,
    mingzi,
    alt_names,
    tokenize='unicode61'
);
"""


def default_search_index_path(project_root: Path) -> Path:
    return project_root / "data" / "local" / "person_search_fts.sqlite"


def is_search_index_ready(index_path: Path) -> bool:
    if not index_path.is_file():
        return False
    try:
        conn = sqlite3.connect(index_path)
        row = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='person_fts'"
        ).fetchone()
        conn.close()
        return bool(row and row[0])
    except sqlite3.Error:
        return False


def search_index_status(index_path: Path, source_db: Path | None = None) -> dict[str, Any]:
    with _SEARCH_LOCK:
        job = dict(_SEARCH_JOB)
    ready = is_search_index_ready(index_path)
    meta: dict[str, str] = {}
    doc_count = 0
    if ready:
        conn = sqlite3.connect(index_path)
        for row in conn.execute("SELECT key, value FROM search_meta"):
            meta[row[0]] = row[1]
        doc_count = conn.execute("SELECT COUNT(*) FROM person_fts").fetchone()[0]
        conn.close()
    stale = False
    if ready and source_db and source_db.is_file():
        try:
            h = hashlib.sha256()
            with source_db.open("rb") as fh:
                while chunk := fh.read(1024 * 1024):
                    h.update(chunk)
            stale = meta.get("source_sha256", "").lower() != h.hexdigest().lower()
        except OSError:
            pass
    return {
        "ready": ready,
        "path": str(index_path),
        "building": job["in_progress"],
        "phase": job["phase"],
        "progress": job["progress"],
        "error": job["error"],
        "stale": stale,
        "doc_count": doc_count,
        "built_at": meta.get("built_at"),
        "source_sha256": meta.get("source_sha256"),
    }


def _set_job(**kwargs: Any) -> None:
    with _SEARCH_LOCK:
        _SEARCH_JOB.update(kwargs)


def build_person_search_index(source_db: Path, index_path: Path) -> None:
    if _SEARCH_JOB["in_progress"]:
        raise RuntimeError("Search index build already in progress")

    _set_job(in_progress=True, phase="init", progress=0.0, error=None)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    if index_path.exists():
        index_path.unlink()

    try:
        h = hashlib.sha256()
        with source_db.open("rb") as fh:
            while chunk := fh.read(1024 * 1024):
                h.update(chunk)
        source_sha = h.hexdigest()
        src = sqlite3.connect(f"file:{source_db}?mode=ro", uri=True)
        src.row_factory = sqlite3.Row
        out = sqlite3.connect(index_path)
        out.executescript(SCHEMA_SQL)

        _set_job(phase="scan", progress=0.1)
        alt_map: dict[int, list[str]] = {}
        for row in src.execute(
            """
            SELECT c_personid, c_alt_name_chn
            FROM ALTNAME_DATA
            WHERE c_alt_name_chn IS NOT NULL AND TRIM(c_alt_name_chn) != ''
            """
        ):
            pid = int(row["c_personid"])
            alt_map.setdefault(pid, [])
            name = str(row["c_alt_name_chn"]).strip()
            if name and name not in alt_map[pid]:
                alt_map[pid].append(name)

        total = src.execute("SELECT COUNT(*) FROM BIOG_MAIN").fetchone()[0]
        batch: list[tuple[Any, ...]] = []
        for i, row in enumerate(
            src.execute(
                """
                SELECT c_personid, c_name_chn, c_name, c_surname_chn, c_mingzi_chn
                FROM BIOG_MAIN
                """
            )
        ):
            pid = int(row["c_personid"])
            alts = " ".join(alt_map.get(pid, [])[:24])
            batch.append(
                (
                    pid,
                    row["c_name_chn"] or "",
                    row["c_name"] or "",
                    row["c_surname_chn"] or "",
                    row["c_mingzi_chn"] or "",
                    alts,
                )
            )
            if len(batch) >= 5000:
                out.executemany(
                    "INSERT INTO person_fts(person_id, name_chn, name, surname, mingzi, alt_names) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    batch,
                )
                out.commit()
                batch.clear()
            if total and i % 50000 == 0:
                _set_job(progress=0.1 + 0.85 * (i / total))
        if batch:
            out.executemany(
                "INSERT INTO person_fts(person_id, name_chn, name, surname, mingzi, alt_names) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                batch,
            )
            out.commit()

        built_at = datetime.now(timezone.utc).isoformat()
        out.execute(
            "INSERT OR REPLACE INTO search_meta(key, value) VALUES (?, ?)",
            ("built_at", built_at),
        )
        out.execute(
            "INSERT OR REPLACE INTO search_meta(key, value) VALUES (?, ?)",
            ("source_sha256", source_sha),
        )
        out.commit()
        src.close()
        out.close()
        _set_job(in_progress=False, phase="done", progress=1.0, error=None)
    except Exception as exc:
        _set_job(in_progress=False, phase="error", error=str(exc))
        raise


def run_search_build_async(source_db: Path, index_path: Path) -> bool:
    if _SEARCH_JOB["in_progress"]:
        return False

    def _worker() -> None:
        try:
            build_person_search_index(source_db, index_path)
        except Exception:
            pass

    threading.Thread(target=_worker, daemon=True).start()
    return True


class PersonSearchIndex:
    def __init__(self, index_path: Path) -> None:
        if not is_search_index_ready(index_path):
            raise FileNotFoundError(f"Search index not ready: {index_path}")
        self.index_path = index_path
        self.conn = sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)
        self.conn.row_factory = sqlite3.Row

    def close(self) -> None:
        self.conn.close()

    def search_ids(
        self,
        query: str,
        *,
        limit: int,
        offset: int,
    ) -> tuple[list[int], int]:
        q = query.strip()
        if not q:
            return [], 0
        term = q.replace('"', '""')
        match = f'"{term}" OR {term}*'
        count_row = self.conn.execute(
            """
            SELECT COUNT(DISTINCT person_id) AS total
            FROM person_fts
            WHERE person_fts MATCH ?
            """,
            (match,),
        ).fetchone()
        total = int(count_row["total"]) if count_row else 0
        rows = self.conn.execute(
            """
            SELECT DISTINCT person_id
            FROM person_fts
            WHERE person_fts MATCH ?
            ORDER BY bm25(person_fts)
            LIMIT ? OFFSET ?
            """,
            (match, limit, offset),
        ).fetchall()
        return [int(r["person_id"]) for r in rows], total
