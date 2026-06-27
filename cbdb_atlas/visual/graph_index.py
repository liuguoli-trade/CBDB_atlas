from __future__ import annotations

import sqlite3
import threading
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import Callable
from typing import Any

from cbdb_atlas.visual.edge_categories import ASSOC_CATEGORY_OTHER, classify_kinship

_INDEX_JOB = {"in_progress": False, "phase": "", "progress": 0.0, "error": None}
_INDEX_LOCK = threading.Lock()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS index_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS person_meta (
    person_id INTEGER PRIMARY KEY,
    name_chn TEXT,
    birth_year INTEGER,
    death_year INTEGER,
    index_addr_id INTEGER,
    index_addr_chn TEXT,
    choronym_chn TEXT,
    addr_split_key TEXT
);
CREATE TABLE IF NOT EXISTS person_edges (
    person_from INTEGER NOT NULL,
    person_to INTEGER NOT NULL,
    edge_type TEXT NOT NULL,
    label_chn TEXT,
    link_code INTEGER,
    seq INTEGER DEFAULT 0,
    upstep INTEGER DEFAULT 0,
    dwnstep INTEGER DEFAULT 0,
    colstep INTEGER DEFAULT 0,
    marstep INTEGER DEFAULT 0,
    first_year INTEGER,
    source_id INTEGER,
    pages TEXT,
    PRIMARY KEY (person_from, person_to, edge_type, link_code, seq)
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON person_edges(person_from);
CREATE INDEX IF NOT EXISTS idx_edges_to ON person_edges(person_to);
"""


def default_index_path(project_root: Path) -> Path:
    return project_root / "data" / "local" / "graph_index.sqlite"


def index_job_status() -> dict[str, Any]:
    with _INDEX_LOCK:
        return dict(_INDEX_JOB)


def _set_job(**kwargs: Any) -> None:
    with _INDEX_LOCK:
        _INDEX_JOB.update(kwargs)


def build_merge_map(conn: sqlite3.Connection) -> dict[int, int]:
    mapping: dict[int, int] = {}
    try:
        rows = conn.execute(
            "SELECT c_personid, c_merged_from_personid FROM MERGED_PERSON_DATA"
        ).fetchall()
    except sqlite3.Error:
        return mapping
    for canonical, merged_from in rows:
        mapping[int(merged_from)] = int(canonical)
    return mapping


def canonical_id(pid: int, merge_map: dict[int, int]) -> int:
    seen: set[int] = set()
    while pid in merge_map and pid not in seen:
        seen.add(pid)
        pid = merge_map[pid]
    return pid


def is_index_ready(index_path: Path) -> bool:
    if not index_path.is_file():
        return False
    try:
        conn = sqlite3.connect(index_path)
        row = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='person_edges'"
        ).fetchone()
        conn.close()
        return bool(row and row[0])
    except sqlite3.Error:
        return False


def index_status(index_path: Path, source_db: Path | None = None) -> dict[str, Any]:
    job = index_job_status()
    ready = is_index_ready(index_path)
    meta: dict[str, str] = {}
    edge_count = 0
    person_count = 0
    if ready:
        conn = sqlite3.connect(index_path)
        conn.row_factory = sqlite3.Row
        for row in conn.execute("SELECT key, value FROM index_meta"):
            meta[row["key"]] = row["value"]
        edge_count = conn.execute("SELECT COUNT(*) FROM person_edges").fetchone()[0]
        person_count = conn.execute("SELECT COUNT(*) FROM person_meta").fetchone()[0]
        conn.close()
    stale = False
    if ready and source_db and source_db.is_file():
        try:
            import hashlib

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
        "edge_count": edge_count,
        "person_count": person_count,
        "built_at": meta.get("built_at"),
        "source_sha256": meta.get("source_sha256"),
    }


def build_graph_index(source_db: Path, index_path: Path) -> None:
    if _INDEX_JOB["in_progress"]:
        raise RuntimeError("Index build already in progress")

    _set_job(in_progress=True, phase="init", progress=0.0, error=None)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    if index_path.exists():
        index_path.unlink()

    try:
        import hashlib

        def _sha256_path(path: Path) -> str:
            h = hashlib.sha256()
            with path.open("rb") as fh:
                while chunk := fh.read(1024 * 1024):
                    h.update(chunk)
            return h.hexdigest()

        source_sha = _sha256_path(source_db)
        src = sqlite3.connect(f"file:{source_db}?mode=ro", uri=True)
        src.row_factory = sqlite3.Row
        out = sqlite3.connect(index_path)
        out.executescript(SCHEMA_SQL)
        merge_map = build_merge_map(src)

        _set_job(phase="person_meta", progress=0.05)
        choronym: dict[int, str] = {}
        for row in src.execute(
            "SELECT c_choronym_code, c_choronym_chn FROM CHORONYM_CODES"
        ):
            if row[0] is not None:
                choronym[int(row[0])] = str(row[1] or "")

        person_sql = """
            SELECT c_personid, c_name_chn, c_birthyear, c_deathyear,
                   c_index_addr_id, c_choronym_code
            FROM BIOG_MAIN
        """
        batch: list[tuple[Any, ...]] = []
        addr_names: dict[int, str] = {}
        for row in src.execute("SELECT c_addr_id, c_name_chn FROM ADDR_CODES"):
            if row[0] is not None:
                addr_names[int(row[0])] = str(row[1] or "")

        total_persons = src.execute("SELECT COUNT(*) FROM BIOG_MAIN").fetchone()[0]
        for i, row in enumerate(src.execute(person_sql)):
            pid = canonical_id(int(row["c_personid"]), merge_map)
            chor = choronym.get(int(row["c_choronym_code"] or 0), "")
            addr_id = row["c_index_addr_id"]
            addr_chn = addr_names.get(int(addr_id or 0), "")
            split_key = chor.strip() or addr_chn.strip() or ""
            batch.append(
                (
                    pid,
                    row["c_name_chn"],
                    row["c_birthyear"],
                    row["c_deathyear"],
                    addr_id,
                    addr_chn,
                    chor,
                    split_key,
                )
            )
            if len(batch) >= 5000:
                out.executemany(
                    """
                    INSERT OR REPLACE INTO person_meta
                    (person_id, name_chn, birth_year, death_year,
                     index_addr_id, index_addr_chn, choronym_chn, addr_split_key)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    batch,
                )
                out.commit()
                batch.clear()
            if i % 50000 == 0 and total_persons:
                _set_job(progress=0.05 + 0.25 * (i / total_persons))
        if batch:
            out.executemany(
                """
                INSERT OR REPLACE INTO person_meta
                (person_id, name_chn, birth_year, death_year,
                 index_addr_id, index_addr_chn, choronym_chn, addr_split_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
            out.commit()

        _set_job(phase="kinship", progress=0.35)
        kin_sql = """
            SELECT kd.c_personid, kd.c_kin_id, kd.c_kin_code,
                   kc.c_kinrel_chn, kc.c_upstep, kc.c_dwnstep, kc.c_colstep, kc.c_marstep,
                   kd.c_source, kd.c_pages
            FROM KIN_DATA kd
            LEFT JOIN KINSHIP_CODES kc ON kc.c_kincode = kd.c_kin_code
        """
        edge_batch: list[tuple[Any, ...]] = []
        kin_total = src.execute("SELECT COUNT(*) FROM KIN_DATA").fetchone()[0]
        for i, row in enumerate(src.execute(kin_sql)):
            pf = canonical_id(int(row["c_personid"]), merge_map)
            pt = canonical_id(int(row["c_kin_id"]), merge_map)
            if pf == pt:
                continue
            mar = int(row["c_marstep"] or 0)
            etype = "kinship-marriage" if mar > 0 else "kinship"
            edge_batch.append(
                (
                    pf,
                    pt,
                    etype,
                    row["c_kinrel_chn"] or "親屬",
                    int(row["c_kin_code"] or 0),
                    0,
                    int(row["c_upstep"] or 0),
                    int(row["c_dwnstep"] or 0),
                    int(row["c_colstep"] or 0),
                    mar,
                    None,
                    row["c_source"],
                    row["c_pages"],
                )
            )
            if len(edge_batch) >= 10000:
                out.executemany(
                    """
                    INSERT OR IGNORE INTO person_edges
                    (person_from, person_to, edge_type, label_chn, link_code, seq,
                     upstep, dwnstep, colstep, marstep, first_year, source_id, pages)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    edge_batch,
                )
                out.commit()
                edge_batch.clear()
            if kin_total and i % 100000 == 0:
                _set_job(progress=0.35 + 0.35 * (i / kin_total))
        if edge_batch:
            out.executemany(
                """
                INSERT OR IGNORE INTO person_edges
                (person_from, person_to, edge_type, label_chn, link_code, seq,
                 upstep, dwnstep, colstep, marstep, first_year, source_id, pages)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                edge_batch,
            )
            out.commit()

        _set_job(phase="association", progress=0.75)
        assoc_sql = """
            SELECT c_personid, c_assoc_id, c_assoc_code, c_sequence,
                   c_assoc_first_year, c_source, c_pages
            FROM ASSOC_DATA
        """
        edge_batch = []
        code_names: dict[int, str] = {}
        for row in src.execute("SELECT c_assoc_code, c_assoc_desc_chn FROM ASSOC_CODES"):
            code_names[int(row[0])] = str(row[1] or "關係")
        assoc_total = src.execute("SELECT COUNT(*) FROM ASSOC_DATA").fetchone()[0]
        for i, row in enumerate(src.execute(assoc_sql)):
            pf = canonical_id(int(row["c_personid"]), merge_map)
            pt = canonical_id(int(row["c_assoc_id"]), merge_map)
            if pf == pt:
                continue
            code = int(row["c_assoc_code"] or 0)
            edge_batch.append(
                (
                    pf,
                    pt,
                    "association",
                    code_names.get(code, "關係"),
                    code,
                    int(row["c_sequence"] or 0),
                    0,
                    0,
                    0,
                    0,
                    row["c_assoc_first_year"],
                    row["c_source"],
                    row["c_pages"],
                )
            )
            if len(edge_batch) >= 10000:
                out.executemany(
                    """
                    INSERT OR IGNORE INTO person_edges
                    (person_from, person_to, edge_type, label_chn, link_code, seq,
                     upstep, dwnstep, colstep, marstep, first_year, source_id, pages)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    edge_batch,
                )
                out.commit()
                edge_batch.clear()
            if assoc_total and i % 100000 == 0:
                _set_job(progress=0.75 + 0.2 * (i / assoc_total))
        if edge_batch:
            out.executemany(
                """
                INSERT OR IGNORE INTO person_edges
                (person_from, person_to, edge_type, label_chn, link_code, seq,
                 upstep, dwnstep, colstep, marstep, first_year, source_id, pages)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                edge_batch,
            )
            out.commit()

        built_at = datetime.now(timezone.utc).isoformat()
        out.execute(
            "INSERT OR REPLACE INTO index_meta(key, value) VALUES (?, ?)",
            ("built_at", built_at),
        )
        out.execute(
            "INSERT OR REPLACE INTO index_meta(key, value) VALUES (?, ?)",
            ("source_sha256", source_sha),
        )
        out.commit()
        src.close()
        out.close()
        _set_job(in_progress=False, phase="done", progress=1.0, error=None)
    except Exception as exc:
        _set_job(in_progress=False, phase="error", error=str(exc))
        raise


def run_build_async(source_db: Path, index_path: Path) -> bool:
    if _INDEX_JOB["in_progress"]:
        return False

    def _worker() -> None:
        try:
            build_graph_index(source_db, index_path)
        except Exception:
            pass

    threading.Thread(target=_worker, daemon=True).start()
    return True


class GraphIndex:
    def __init__(self, index_path: Path) -> None:
        self.index_path = index_path
        if not is_index_ready(index_path):
            raise FileNotFoundError(f"Graph index not ready: {index_path}")
        self.conn = sqlite3.connect(f"file:{index_path}?mode=ro", uri=True)
        self.conn.row_factory = sqlite3.Row

    def close(self) -> None:
        self.conn.close()

    def get_meta(self, person_id: int) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT * FROM person_meta WHERE person_id = ?", (person_id,)
        ).fetchone()
        return dict(row) if row else None

    def neighbors(
        self,
        person_id: int,
        *,
        edge_types: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        params: list[Any] = [person_id, person_id]
        type_clause = ""
        if edge_types:
            placeholders = ",".join("?" * len(edge_types))
            type_clause = f" AND edge_type IN ({placeholders})"
            params.extend(sorted(edge_types))
        rows = self.conn.execute(
            f"""
            SELECT person_from, person_to, edge_type, label_chn, link_code, seq,
                   upstep, dwnstep, colstep, marstep, first_year, source_id, pages
            FROM person_edges
            WHERE person_from = ? OR person_to = ?
            {type_clause}
            """,
            params,
        ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            rf, rt = int(row["person_from"]), int(row["person_to"])
            if rf == person_id:
                other, direction = rt, "out"
            else:
                other, direction = rf, "in"
            result.append(
                {
                    "other_id": other,
                    "direction": direction,
                    "edge_type": row["edge_type"],
                    "label_chn": row["label_chn"],
                    "link_code": row["link_code"],
                    "seq": row["seq"],
                    "upstep": row["upstep"],
                    "dwnstep": row["dwnstep"],
                    "colstep": row["colstep"],
                    "marstep": row["marstep"],
                    "first_year": row["first_year"],
                    "source_id": row["source_id"],
                    "pages": row["pages"],
                }
            )
        return result

    def shortest_path(
        self,
        start: int,
        goal: int,
        *,
        max_depth: int = 6,
        edge_types: set[str] | None = None,
    ) -> list[dict[str, Any]] | None:
        if start == goal:
            return []
        allowed = edge_types or {"kinship", "kinship-marriage", "association"}
        queue: deque[tuple[int, list[dict[str, Any]]]] = deque([(start, [])])
        visited = {start}
        while queue:
            current, path = queue.popleft()
            if len(path) >= max_depth:
                continue
            for nb in self.neighbors(current, edge_types=allowed):
                other = int(nb["other_id"])
                step = {
                    "from": current,
                    "to": other,
                    "direction": nb["direction"],
                    "edge_type": nb["edge_type"],
                    "label": nb["label_chn"],
                    "detail": {
                        "c_pages": nb["pages"],
                        "c_source": nb["source_id"],
                        "link_code": nb["link_code"],
                    },
                }
                new_path = path + [step]
                if other == goal:
                    return new_path
                if other not in visited:
                    visited.add(other)
                    queue.append((other, new_path))
        return None


def _edge_types_for_kind(kind: str) -> set[str]:
    if kind == "kinship":
        return {"kinship", "kinship-marriage"}
    if kind == "association":
        return {"association"}
    return {"kinship", "kinship-marriage", "association"}


def ego_bfs(
    index: GraphIndex,
    center_id: int,
    *,
    steps: int,
    kind: str = "all",
    max_nodes: int = 120,
    max_neighbors: int = 80,
    assoc_classify: Callable[[dict[str, Any]], str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    """Return (nodes, edges, truncated) from graph index."""
    allowed = _edge_types_for_kind(kind)
    meta = index.get_meta(center_id)
    center_label = str((meta or {}).get("name_chn") or center_id)
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    edge_ids: set[str] = set()
    truncated = False

    def ensure_node(pid: int, *, role: str, label: str | None = None) -> str | None:
        nonlocal truncated
        key = str(pid)
        if key in nodes:
            return key
        if len(nodes) >= max_nodes:
            truncated = True
            return None
        if label is None:
            m = index.get_meta(pid)
            label = str((m or {}).get("name_chn") or pid)
        nodes[key] = {
            "id": key,
            "person_id": pid,
            "label": label[:24],
            "role": role,
        }
        return key

    def add_edge(
        eid: str,
        source: str,
        target: str,
        *,
        edge_type: str,
        label: str,
        detail: dict[str, Any],
        category: str,
    ) -> None:
        if eid in edge_ids:
            return
        edge_ids.add(eid)
        edges.append(
            {
                "id": eid,
                "source": source,
                "target": target,
                "type": edge_type,
                "label": label,
                "category": category,
                "detail": detail,
            }
        )

    center_key = ensure_node(center_id, role="center", label=center_label)
    if not center_key:
        return [], [], True

    frontier = {center_id}
    seen = {center_id}

    for hop in range(1, steps + 1):
        if not frontier:
            break
        next_frontier: set[int] = set()
        for pid in frontier:
            source_key = str(pid)
            if source_key not in nodes:
                continue
            neighbors = index.neighbors(pid, edge_types=allowed)
            if len(neighbors) > max_neighbors:
                truncated = True
                neighbors = neighbors[:max_neighbors]
            for nb in neighbors:
                other = int(nb["other_id"])
                role = "kin" if hop == 1 and nb["edge_type"].startswith("kinship") else (
                    "assoc" if hop == 1 and nb["edge_type"] == "association" else f"hop{hop}"
                )
                other_key = ensure_node(other, role=role)
                if not other_key:
                    if str(other) in nodes:
                        other_key = str(other)
                    else:
                        continue
                etype = nb["edge_type"]
                eid = f"{etype}-{source_key}-{other_key}-{nb.get('link_code')}-{nb.get('seq')}"
                detail = {
                    "c_pages": nb.get("pages"),
                    "c_source": nb.get("source_id"),
                    "link_code": nb.get("link_code"),
                    "c_kinrel_chn": nb.get("label_chn") if etype.startswith("kinship") else None,
                    "c_link_chn": nb.get("label_chn") if etype == "association" else None,
                }
                if etype.startswith("kinship"):
                    kin_row = {
                        "c_kinrel_chn": nb.get("label_chn"),
                        "c_upstep": nb.get("upstep"),
                        "c_dwnstep": nb.get("dwnstep"),
                        "c_colstep": nb.get("colstep"),
                        "c_marstep": nb.get("marstep"),
                    }
                    cat = classify_kinship(kin_row)
                else:
                    assoc_row = {"c_link_code": nb.get("link_code")}
                    cat = (
                        assoc_classify(assoc_row)
                        if assoc_classify
                        else ASSOC_CATEGORY_OTHER
                    )
                add_edge(
                    eid,
                    source_key,
                    other_key,
                    edge_type=etype,
                    label=str(nb.get("label_chn") or "關係"),
                    detail=detail,
                    category=cat,
                )
                if other not in seen:
                    next_frontier.add(other)
                    seen.add(other)
        frontier = next_frontier

    return list(nodes.values()), edges, truncated
