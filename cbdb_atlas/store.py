from __future__ import annotations

import re
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from cbdb_atlas.db_pool import ReadOnlyPool, open_readonly_connection
from cbdb_atlas.queries import QueryRegistry
from cbdb_atlas.search_index import PersonSearchIndex, is_search_index_ready
from cbdb_atlas.textnorm import normalize_search_query

MIN_PERSON_SEARCH_LEN = 2
MAX_NEIGHBORS_PER_HOP = 80
MODULE_COUNTS_CACHE_TTL_SEC = 600.0
MODULE_COUNTS_CACHE_MAX = 512
RELATIONS_GRAPH_CACHE_TTL_SEC = 900.0
RELATIONS_GRAPH_CACHE_MAX = 256


def _person_search_query_ok(raw: str) -> bool:
    q = raw.strip()
    if len(q) >= MIN_PERSON_SEARCH_LEN:
        return True
    if len(q) == 1 and re.search(r"[\u4e00-\u9fff]", q):
        return True
    return False


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def _parse_numeric_id(q: str) -> int | None:
    q = q.strip()
    if re.fullmatch(r"\d+", q):
        return int(q)
    return None


def _is_blank_dynasty_label(value: Any) -> bool:
    t = str(value or "").strip()
    return not t or t in ("未詳", "不详")


def _parse_person_id(q: str) -> int | None:
    q = q.strip()
    pid = _parse_numeric_id(q)
    if pid is not None:
        return pid
    if m := re.fullmatch(r"[Pp]:(\d+)", q):
        return int(m.group(1))
    return None


def _like_pattern(text: str | None) -> str | None:
    if text is None:
        return None
    s = text.strip()
    if not s:
        return None
    return f"%{normalize_search_query(s)}%"


def _text_search_params(q: str, *, numeric_id: int | None = None) -> dict[str, str]:
    raw = q.strip()
    qn = normalize_search_query(raw) or raw
    nid = numeric_id if numeric_id is not None else _parse_numeric_id(raw)
    return {
        "pattern": f"%{qn}%",
        "exact": qn,
        "exact_prefix": f"{qn}%",
        "exact_id": str(nid) if nid is not None else qn,
    }


# All 17 biography views (View_PeopleData = basic, queried separately)
MODULE_VIEWS: dict[str, str] = {
    "altname": "View_AltnameData",
    "kinship": "View_KinAddrData",
    "posting": "View_PostingOfficeData",
    "posting_addr": "View_PostingAddrData",
    "entry": "View_EntryData",
    "association": "View_AssociationData",
    "biog_address": "View_BiogAddrData",
    "text_role": "View_BiogTextData",
    "status": "View_StatusData",
    "institution": "View_BiogInstAddrData",
    "biog_source": "View_BiogSourceData",
    "event": "View_EventFullData",
    "people_addr": "View_PeopleAddrData",
    "possessions": "View_PossessionsAddrData",
}

# Legacy module ids from bookmarks / old URLs → merged modules.
MODULE_ALIASES: dict[str, str] = {
    "institution_addr": "institution",
    "event_addr": "event",
    "possessions_addr": "possessions",
}

SEARCH_TYPES: dict[str, tuple[str, str]] = {
    "person": ("person_search", "person_search_count"),
    "place": ("search_place", "search_place_count"),
    "office": ("search_office", "search_office_count"),
    "text": ("search_text", "search_text_count"),
    "institution": ("search_institution", "search_institution_count"),
    "event": ("search_event", "search_event_count"),
    "kinship": ("search_kinship", "search_kinship_count"),
    "assoc": ("search_assoc", "search_assoc_count"),
    "entry": ("search_entry_code", "search_entry_code_count"),
    "status": ("search_status_code", "search_status_code_count"),
    "choronym": ("search_choronym", "search_choronym_count"),
    "nianhao": ("search_nianhao", "search_nianhao_count"),
}

ENTITY_PERSON_TYPES: dict[str, tuple[str, str]] = {
    "office": ("entity_persons_office", "entity_persons_office_count"),
    "place": ("entity_persons_place", "entity_persons_place_count"),
    "text": ("entity_persons_text", "entity_persons_text_count"),
    "institution": ("entity_persons_institution", "entity_persons_institution_count"),
    "event": ("entity_persons_event", "entity_persons_event_count"),
}


class CbdbStore:
    """Read-only access to CBDB SQLite via externalized SQL queries."""

    def __init__(
        self,
        db_path: Path,
        queries_dir: Path,
        *,
        search_index_path: Path | None = None,
        graph_index_path: Path | None = None,
        pool_size: int = 4,
    ) -> None:
        self.db_path = db_path
        self.queries = QueryRegistry(queries_dir)
        self.search_index_path = search_index_path
        self.graph_index_path = graph_index_path
        self._pool = ReadOnlyPool(db_path, size=pool_size)
        self._legacy_conn = open_readonly_connection(db_path)
        self._table_cache: set[str] | None = None
        self._module_counts_cache: dict[int, tuple[dict[str, int], float]] = {}
        self._relations_graph_cache: dict[
            tuple[int, int, str], tuple[dict[str, Any], float]
        ] = {}
        self._assoc_category_resolver: Any | None = None

    @property
    def conn(self) -> sqlite3.Connection:
        """Stable connection for legacy callers (GraphService, tests)."""
        return self._legacy_conn

    def close(self) -> None:
        self._legacy_conn.close()
        self._pool.close()

    def reload(self, db_path: Path) -> None:
        self.db_path = db_path
        self._table_cache = None
        self._module_counts_cache.clear()
        self._relations_graph_cache.clear()
        self._assoc_category_resolver = None
        self._legacy_conn.close()
        self._legacy_conn = open_readonly_connection(db_path)
        self._pool.reload(db_path)

    def _has_table(self, name: str, conn: sqlite3.Connection | None = None) -> bool:
        if self._table_cache is None:
            if conn is not None:
                rows = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
                self._table_cache = {r[0] for r in rows}
            else:
                with self._pool.borrow() as c:
                    rows = c.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    ).fetchall()
                    self._table_cache = {r[0] for r in rows}
        return name in self._table_cache

    def _fetchall(
        self,
        query_name: str,
        params: dict[str, Any],
        *,
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        sql = self.queries.get_sql(query_name)
        if conn is not None:
            rows = conn.execute(sql, params).fetchall()
            return [_row_to_dict(r) for r in rows]
        with self._pool.borrow() as c:
            rows = c.execute(sql, params).fetchall()
            return [_row_to_dict(r) for r in rows]

    def _fetchone(
        self,
        query_name: str,
        params: dict[str, Any],
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        rows = self._fetchall(query_name, params, conn=conn)
        return rows[0] if rows else None

    def _count_module(self, view_table: str, person_id: int) -> int:
        with self._pool.borrow() as conn:
            row = conn.execute(
                f"SELECT COUNT(*) AS c FROM {view_table} WHERE c_personid = ?",
                (person_id,),
            ).fetchone()
            return int(row[0]) if row else 0

    def _enrich_person_altnames(self, results: list[dict[str, Any]]) -> None:
        if not results:
            return
        ids = [int(r["c_personid"]) for r in results if r.get("c_personid") is not None]
        if not ids:
            return
        placeholders = ",".join("?" * len(ids))
        with self._pool.borrow() as conn:
            rows = conn.execute(
                f"""
                SELECT c_personid, c_alt_name_chn
                FROM View_AltnameData
                WHERE c_personid IN ({placeholders})
                  AND c_alt_name_chn IS NOT NULL
                  AND TRIM(c_alt_name_chn) != ''
                ORDER BY c_personid, c_alt_name_type_code
                """,
                ids,
            ).fetchall()
        alt_by_person: dict[int, list[str]] = {}
        for row in rows:
            pid = int(row["c_personid"])
            name = str(row["c_alt_name_chn"]).strip()
            if not name:
                continue
            bucket = alt_by_person.setdefault(pid, [])
            if name not in bucket and len(bucket) < 12:
                bucket.append(name)
        for r in results:
            pid = int(r["c_personid"])
            names = alt_by_person.get(pid, [])
            r["c_alt_names"] = "、".join(names) if names else None

    def _person_rows_by_ids(self, person_ids: list[int]) -> list[dict[str, Any]]:
        if not person_ids:
            return []
        placeholders = ",".join("?" * len(person_ids))
        with self._pool.borrow() as conn:
            rows = conn.execute(
                f"""
                SELECT c_personid, c_name, c_name_chn, c_birthyear, c_deathyear,
                       c_dynasty_chn, c_index_addr_chn, c_index_year,
                       c_surname_chn, c_mingzi_chn, c_surname_proper, c_mingzi_proper
                FROM View_PeopleData
                WHERE c_personid IN ({placeholders})
                """,
                person_ids,
            ).fetchall()
        by_id = {int(r["c_personid"]): _row_to_dict(r) for r in rows}
        ordered = [by_id[pid] for pid in person_ids if pid in by_id]
        self._enrich_person_altnames(ordered)
        return ordered

    def resolve_person_id(self, person_id: int) -> tuple[int, int | None]:
        """Return canonical person id and merged-from id if redirected."""
        if not self._has_table("MERGED_PERSON_DATA"):
            return person_id, None
        row = self._fetchone("merged_person_resolve", {"person_id": person_id})
        if row and row.get("canonical_id"):
            canonical = int(row["canonical_id"])
            if canonical != person_id:
                return canonical, person_id
        return person_id, None

    def stats(self) -> dict[str, Any]:
        row = self._fetchone("stats", {})
        person_count = row["person_count"] if row else 0
        with self._pool.borrow() as conn:
            views = [
                r[0]
                for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='view' ORDER BY name"
                ).fetchall()
            ]
        return {
            "person_count": person_count,
            "view_count": len(views),
            "views": views,
            "database": str(self.db_path),
            "has_addresses_table": self._has_table("ADDRESSES"),
        }

    def list_dynasties(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._fetchall("dynasties", {"limit": limit})

    def search_persons(
        self,
        query: str,
        *,
        dynasty_code: int | None = None,
        birth_min: int | None = None,
        birth_max: int | None = None,
        death_min: int | None = None,
        death_max: int | None = None,
        index_min: int | None = None,
        index_max: int | None = None,
        female: int | None = None,
        index_addr: str | None = None,
        limit: int = 30,
        offset: int = 0,
        defer_count: bool = False,
    ) -> dict[str, Any]:
        raw = query.strip()
        pid = _parse_person_id(raw)
        index_addr_pattern = _like_pattern(index_addr)
        if pid is not None:
            canonical, merged_from = self.resolve_person_id(pid)
            id_params = {
                **_text_search_params(str(canonical), numeric_id=canonical),
                "dynasty_code": dynasty_code,
                "birth_min": birth_min,
                "birth_max": birth_max,
                "death_min": death_min,
                "death_max": death_max,
                "index_min": index_min,
                "index_max": index_max,
                "female": female,
                "index_addr": index_addr_pattern,
                "limit": max(limit, 1),
                "offset": 0,
            }
            results = self._fetchall("person_search_list", id_params)
            self._enrich_person_altnames(results)
            if results and merged_from is not None:
                results[0]["_merged_from"] = merged_from
            return {
                "type": "person",
                "total": len(results),
                "limit": limit,
                "offset": 0,
                "results": results,
            }

        if not _person_search_query_ok(raw):
            raise ValueError(f"人物檢索關鍵詞至少 {MIN_PERSON_SEARCH_LEN} 個字符")

        params = {
            **_text_search_params(raw),
            "dynasty_code": dynasty_code,
            "birth_min": birth_min,
            "birth_max": birth_max,
            "death_min": death_min,
            "death_max": death_max,
            "index_min": index_min,
            "index_max": index_max,
            "female": female,
            "index_addr": index_addr_pattern,
            "limit": limit,
            "offset": offset,
        }

        if (
            self.search_index_path
            and is_search_index_ready(self.search_index_path)
            and not any(
                params[k] is not None
                for k in (
                    "dynasty_code",
                    "birth_min",
                    "birth_max",
                    "death_min",
                    "death_max",
                    "index_min",
                    "index_max",
                    "female",
                    "index_addr",
                )
            )
        ):
            idx = PersonSearchIndex(self.search_index_path)
            try:
                ids, total = idx.search_ids(raw, limit=limit, offset=offset)
            finally:
                idx.close()
            results = self._person_rows_by_ids(ids)
            return {
                "type": "person",
                "total": total,
                "limit": limit,
                "offset": offset,
                "results": results,
                "search_engine": "fts",
            }

        return self._search_persons_like(
            params, limit=limit, offset=offset, defer_count=defer_count
        )

    def _search_persons_like(
        self,
        params: dict[str, Any],
        *,
        limit: int,
        offset: int,
        defer_count: bool,
    ) -> dict[str, Any]:
        if offset == 0 and defer_count:
            results = self._fetchall("person_search_list", params)
            self._enrich_person_altnames(results)
            has_more = len(results) >= limit
            return {
                "type": "person",
                "total": None,
                "has_more": has_more,
                "limit": limit,
                "offset": offset,
                "results": results,
                "search_engine": "like",
                "count_deferred": True,
            }

        def _count() -> int:
            row = self._fetchone("person_search_count_lite", params)
            return int(row["total"]) if row else 0

        def _list() -> list[dict[str, Any]]:
            return self._fetchall("person_search_list", params)

        with ThreadPoolExecutor(max_workers=2) as pool:
            f_count = pool.submit(_count)
            f_list = pool.submit(_list)
            total = f_count.result()
            results = f_list.result()
        self._enrich_person_altnames(results)
        return {
            "type": "person",
            "total": total,
            "has_more": offset + len(results) < total,
            "limit": limit,
            "offset": offset,
            "results": results,
            "search_engine": "like",
        }

    def search_persons_by_posting(
        self,
        query: str,
        *,
        year_min: int | None = None,
        year_max: int | None = None,
        dynasty_code: int | None = None,
        limit: int = 30,
        offset: int = 0,
    ) -> dict[str, Any]:
        params = {
            **_text_search_params(query),
            "year_min": year_min,
            "year_max": year_max,
            "dynasty_code": dynasty_code,
            "limit": limit,
            "offset": offset,
        }
        count_row = self._fetchone("search_persons_by_posting_count", params)
        total = int(count_row["total"]) if count_row else 0
        results = self._fetchall("search_persons_by_posting", params)
        return {"type": "person", "mode": "posting", "total": total, "limit": limit, "offset": offset, "results": results}

    def search_persons_by_event(
        self,
        query: str,
        *,
        year_min: int | None = None,
        year_max: int | None = None,
        limit: int = 30,
        offset: int = 0,
    ) -> dict[str, Any]:
        raw = query.strip()
        params = {
            **_text_search_params(raw, numeric_id=_parse_numeric_id(raw)),
            "year_min": year_min,
            "year_max": year_max,
            "limit": limit,
            "offset": offset,
        }
        count_row = self._fetchone("search_persons_by_event_count", params)
        total = int(count_row["total"]) if count_row else 0
        results = self._fetchall("search_persons_by_event", params)
        return {"type": "person", "mode": "event", "total": total, "limit": limit, "offset": offset, "results": results}

    def search_places(
        self,
        query: str,
        *,
        dynasty_code: int | None = None,
        firstyear: int | None = None,
        lastyear: int | None = None,
        limit: int = 30,
        offset: int = 0,
    ) -> dict[str, Any]:
        raw = query.strip()
        params = {
            **_text_search_params(raw, numeric_id=_parse_numeric_id(raw)),
            "dynasty_code": dynasty_code,
            "firstyear": firstyear,
            "lastyear": lastyear,
            "limit": limit,
            "offset": offset,
        }
        count_row = self._fetchone("search_place_count", params)
        total = int(count_row["total"]) if count_row else 0
        results = self._fetchall("search_place", params)
        return {
            "type": "place",
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": results,
        }

    def search_texts(
        self,
        query: str,
        *,
        dynasty_code: int | None = None,
        related_person: str | None = None,
        limit: int = 30,
        offset: int = 0,
    ) -> dict[str, Any]:
        raw = query.strip()
        rp = related_person.strip() if related_person and related_person.strip() else None
        params = {
            **_text_search_params(raw, numeric_id=_parse_numeric_id(raw)),
            "dynasty_code": dynasty_code,
            "related_person_pattern": _like_pattern(rp),
            "limit": limit,
            "offset": offset,
        }
        count_row = self._fetchone("search_text_count", params)
        total = int(count_row["total"]) if count_row else 0
        results = self._fetchall("search_text", params)
        return {
            "type": "text",
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": results,
        }

    def search(
        self,
        query: str,
        *,
        search_type: str = "person",
        dynasty_code: int | None = None,
        birth_min: int | None = None,
        birth_max: int | None = None,
        death_min: int | None = None,
        death_max: int | None = None,
        index_min: int | None = None,
        index_max: int | None = None,
        female: int | None = None,
        index_addr: str | None = None,
        firstyear: int | None = None,
        lastyear: int | None = None,
        related_person: str | None = None,
        limit: int = 30,
        offset: int = 0,
        defer_count: bool = False,
    ) -> dict[str, Any]:
        if search_type == "person":
            return self.search_persons(
                query,
                dynasty_code=dynasty_code,
                birth_min=birth_min,
                birth_max=birth_max,
                death_min=death_min,
                death_max=death_max,
                index_min=index_min,
                index_max=index_max,
                female=female,
                index_addr=index_addr,
                limit=limit,
                offset=offset,
                defer_count=defer_count,
            )
        if search_type == "place":
            return self.search_places(
                query,
                dynasty_code=dynasty_code,
                firstyear=firstyear,
                lastyear=lastyear,
                limit=limit,
                offset=offset,
            )
        if search_type == "text":
            return self.search_texts(
                query,
                dynasty_code=dynasty_code,
                related_person=related_person,
                limit=limit,
                offset=offset,
            )
        if search_type not in SEARCH_TYPES:
            raise ValueError(f"Unknown search type: {search_type}")

        q = query.strip()
        params = {
            **_text_search_params(q, numeric_id=_parse_numeric_id(q)),
            "limit": limit,
            "offset": offset,
        }
        list_q, count_q = SEARCH_TYPES[search_type]
        count_row = self._fetchone(count_q, params)
        total = int(count_row["total"]) if count_row else 0
        results = self._fetchall(list_q, params)
        return {
            "type": search_type,
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": results,
        }

    def entity_persons(
        self,
        entity_type: str,
        entity_id: int,
        *,
        limit: int = 30,
        offset: int = 0,
    ) -> dict[str, Any]:
        if entity_type not in ENTITY_PERSON_TYPES:
            raise ValueError(f"Unknown entity type: {entity_type}")
        list_q, count_q = ENTITY_PERSON_TYPES[entity_type]
        params = {"entity_id": entity_id, "limit": limit, "offset": offset}
        count_row = self._fetchone(count_q, params)
        total = int(count_row["total"]) if count_row else 0
        results = self._fetchall(list_q, params)
        return {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": results,
        }

    def browse_address_children(
        self, parent_id: int, *, limit: int = 50, offset: int = 0
    ) -> dict[str, Any]:
        results = self._fetchall(
            "browse_address_children",
            {"parent_id": parent_id, "limit": limit, "offset": offset},
        )
        return {"parent_id": parent_id, "results": results, "limit": limit, "offset": offset}

    def browse_address_detail(self, addr_id: int) -> dict[str, Any] | None:
        if self._has_table("ADDRESSES"):
            row = self._fetchone("browse_address_detail", {"addr_id": addr_id})
            if row:
                return row
        return self._fetchone("addr_by_id", {"addr_id": addr_id})

    def browse_office_tree(
        self, parent_id: str | None = None, *, limit: int = 100, offset: int = 0
    ) -> dict[str, Any]:
        results = self._fetchall(
            "browse_office_tree",
            {"parent_id": parent_id, "limit": limit, "offset": offset},
        )
        return {"parent_id": parent_id, "results": results, "limit": limit, "offset": offset}

    def browse_office_tree_offices(
        self, node_id: str, *, limit: int = 50, offset: int = 0
    ) -> dict[str, Any]:
        results = self._fetchall(
            "browse_office_tree_offices",
            {"node_id": node_id, "limit": limit, "offset": offset},
        )
        return {"node_id": node_id, "results": results, "limit": limit, "offset": offset}

    def _enrich_nianhao_dynasties(self, person: dict[str, Any]) -> dict[str, Any]:
        if _is_blank_dynasty_label(person.get("c_by_dynasty_chn")):
            code = person.get("c_by_nh_code")
            if code is not None:
                with self._pool.borrow() as conn:
                    row = conn.execute(
                        "SELECT c_dynasty_chn FROM NIAN_HAO WHERE c_nianhao_id = ?",
                        (code,),
                    ).fetchone()
                if row and not _is_blank_dynasty_label(row[0]):
                    person["c_by_dynasty_chn"] = row[0]
        if _is_blank_dynasty_label(person.get("c_dy_nh_dynasty_chn")):
            code = person.get("c_dy_nh_code")
            if code is not None:
                with self._pool.borrow() as conn:
                    row = conn.execute(
                        "SELECT c_dynasty_chn FROM NIAN_HAO WHERE c_nianhao_id = ?",
                        (code,),
                    ).fetchone()
                if row and not _is_blank_dynasty_label(row[0]):
                    person["c_dy_nh_dynasty_chn"] = row[0]
        return person

    def get_person(self, person_id: int) -> dict[str, Any] | None:
        canonical, merged_from = self.resolve_person_id(person_id)
        person = self._fetchone("person_by_id", {"person_id": canonical})
        if person:
            person = self._enrich_nianhao_dynasties(person)
        if person and merged_from is not None:
            person["_merged_from"] = merged_from
            person["_canonical_id"] = canonical
        return person

    def module_counts(self, person_id: int) -> dict[str, int]:
        canonical, _ = self.resolve_person_id(person_id)
        now = time.monotonic()
        cached = self._module_counts_cache.get(canonical)
        if cached and now - cached[1] < MODULE_COUNTS_CACHE_TTL_SEC:
            return dict(cached[0])

        counts: dict[str, int] = {key: 0 for key in MODULE_VIEWS}
        try:
            rows = self._fetchall("module_counts", {"person_id": canonical})
            for row in rows:
                key = row.get("module_key")
                if key in counts:
                    counts[key] = int(row.get("c") or 0)
        except sqlite3.Error:
            for key, view in MODULE_VIEWS.items():
                try:
                    counts[key] = self._count_module(view, canonical)
                except sqlite3.Error:
                    counts[key] = 0

        if len(self._module_counts_cache) >= MODULE_COUNTS_CACHE_MAX:
            cutoff = now - MODULE_COUNTS_CACHE_TTL_SEC
            self._module_counts_cache = {
                pid: entry
                for pid, entry in self._module_counts_cache.items()
                if entry[1] >= cutoff
            }
        self._module_counts_cache[canonical] = (dict(counts), now)
        return counts

    @staticmethod
    def resolve_module_id(module: str) -> str:
        return MODULE_ALIASES.get(module, module)

    def module_rows(
        self,
        module: str,
        person_id: int,
        *,
        limit: int = 80,
        offset: int = 0,
    ) -> dict[str, Any]:
        module = self.resolve_module_id(module)
        if module not in MODULE_VIEWS:
            raise ValueError(f"Unknown module: {module}")
        canonical, _ = self.resolve_person_id(person_id)
        total = self._count_module(MODULE_VIEWS[module], canonical)
        rows = self._fetchall(
            module, {"person_id": canonical, "limit": limit, "offset": offset}
        )
        return {"total": total, "limit": limit, "offset": offset, "rows": rows}

    def module_rows_all(
        self,
        module: str,
        person_id: int,
        *,
        batch: int = 500,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page = self.module_rows(module, person_id, limit=batch, offset=offset)
            rows.extend(page["rows"])
            total = page["total"]
            offset += batch
            if offset >= total:
                break
        return rows

    def assoc_category_resolver(self) -> Any:
        if self._assoc_category_resolver is None:
            from cbdb_atlas.visual.edge_categories import AssocCategoryResolver

            self._assoc_category_resolver = AssocCategoryResolver(self.conn)
        return self._assoc_category_resolver

    def relations_graph(
        self,
        person_id: int,
        *,
        steps: int = 1,
        kind: str = "all",
    ) -> dict[str, Any]:
        person = self.get_person(person_id)
        if not person:
            raise ValueError("Person not found")
        canonical = int(person.get("_canonical_id") or person["c_personid"])
        cache_key = (canonical, steps, kind)
        now = time.monotonic()
        cached = self._relations_graph_cache.get(cache_key)
        if cached and now - cached[1] < RELATIONS_GRAPH_CACHE_TTL_SEC:
            return cached[0]

        from cbdb_atlas.visual.graph_service import GraphService

        result = GraphService(self, graph_index_path=self.graph_index_path).single(
            person_id, steps=steps, kind=kind
        )
        if len(self._relations_graph_cache) >= RELATIONS_GRAPH_CACHE_MAX:
            cutoff = now - RELATIONS_GRAPH_CACHE_TTL_SEC
            self._relations_graph_cache = {
                key: entry
                for key, entry in self._relations_graph_cache.items()
                if entry[1] >= cutoff
            }
        self._relations_graph_cache[cache_key] = (result, now)
        return result
