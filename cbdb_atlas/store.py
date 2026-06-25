from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

from cbdb_atlas.queries import QueryRegistry


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def _parse_numeric_id(q: str) -> int | None:
    q = q.strip()
    if re.fullmatch(r"\d+", q):
        return int(q)
    return None


def _parse_person_id(q: str) -> int | None:
    q = q.strip()
    pid = _parse_numeric_id(q)
    if pid is not None:
        return pid
    if m := re.fullmatch(r"[Pp]:(\d+)", q):
        return int(m.group(1))
    return None


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
    "institution": "View_BiogInstData",
    "institution_addr": "View_BiogInstAddrData",
    "biog_source": "View_BiogSourceData",
    "event": "View_EventData",
    "event_addr": "View_EventAddrData",
    "people_addr": "View_PeopleAddrData",
    "possessions": "View_PossessionsData",
    "possessions_addr": "View_PossessionsAddrData",
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

    def __init__(self, db_path: Path, queries_dir: Path) -> None:
        self.db_path = db_path
        self.queries = QueryRegistry(queries_dir)
        self.conn = sqlite3.connect(
            f"file:{db_path}?mode=ro",
            uri=True,
            timeout=30.0,
            check_same_thread=False,
        )
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA query_only=ON")
        self.conn.execute("PRAGMA cache_size=-64000")
        self._table_cache: set[str] | None = None

    def close(self) -> None:
        self.conn.close()

    def reload(self, db_path: Path) -> None:
        self.close()
        self.db_path = db_path
        self._table_cache = None
        self.conn = sqlite3.connect(
            f"file:{db_path}?mode=ro",
            uri=True,
            timeout=30.0,
            check_same_thread=False,
        )
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA query_only=ON")

    def _has_table(self, name: str) -> bool:
        if self._table_cache is None:
            rows = self.conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
            self._table_cache = {r[0] for r in rows}
        return name in self._table_cache

    def _fetchall(self, query_name: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        sql = self.queries.get_sql(query_name)
        rows = self.conn.execute(sql, params).fetchall()
        return [_row_to_dict(r) for r in rows]

    def _fetchone(self, query_name: str, params: dict[str, Any]) -> dict[str, Any] | None:
        rows = self._fetchall(query_name, params)
        return rows[0] if rows else None

    def _count_module(self, view_table: str, person_id: int) -> int:
        row = self.conn.execute(
            f"SELECT COUNT(*) AS c FROM {view_table} WHERE c_personid = ?",
            (person_id,),
        ).fetchone()
        return int(row[0]) if row else 0

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
        views = [
            r[0]
            for r in self.conn.execute(
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
    ) -> dict[str, Any]:
        q = query.strip()
        pid = _parse_person_id(q)
        pattern = f"%{q}%"
        index_addr_pattern = f"%{index_addr.strip()}%" if index_addr and index_addr.strip() else None
        params = {
            "pattern": pattern,
            "exact": q,
            "exact_prefix": f"{q}%",
            "exact_id": str(pid) if pid is not None else q,
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
        if pid is not None:
            canonical, merged_from = self.resolve_person_id(pid)
            person = self.get_person(canonical)
            if person:
                if merged_from is not None:
                    person["_merged_from"] = merged_from
                results = [person]
            else:
                results = []
            return {
                "type": "person",
                "total": len(results),
                "limit": limit,
                "offset": 0,
                "results": results,
            }

        count_row = self._fetchone("person_search_count", params)
        total = int(count_row["total"]) if count_row else 0
        results = self._fetchall("person_search", params)
        return {
            "type": "person",
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": results,
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
        q = query.strip()
        pattern = f"%{q}%"
        params = {
            "pattern": pattern,
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
        q = query.strip()
        numeric_id = _parse_numeric_id(q)
        pattern = f"%{q}%"
        params = {
            "pattern": pattern,
            "exact_id": str(numeric_id) if numeric_id is not None else q,
            "year_min": year_min,
            "year_max": year_max,
            "limit": limit,
            "offset": offset,
        }
        count_row = self._fetchone("search_persons_by_event_count", params)
        total = int(count_row["total"]) if count_row else 0
        results = self._fetchall("search_persons_by_event", params)
        return {"type": "person", "mode": "event", "total": total, "limit": limit, "offset": offset, "results": results}

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
        limit: int = 30,
        offset: int = 0,
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
            )
        if search_type not in SEARCH_TYPES:
            raise ValueError(f"Unknown search type: {search_type}")

        q = query.strip()
        numeric_id = _parse_numeric_id(q)
        pattern = f"%{q}%"
        params = {
            "pattern": pattern,
            "exact": q,
            "exact_prefix": f"{q}%",
            "exact_id": str(numeric_id) if numeric_id is not None else q,
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

    def get_person(self, person_id: int) -> dict[str, Any] | None:
        canonical, merged_from = self.resolve_person_id(person_id)
        person = self._fetchone("person_by_id", {"person_id": canonical})
        if person and merged_from is not None:
            person["_merged_from"] = merged_from
            person["_canonical_id"] = canonical
        return person

    def module_counts(self, person_id: int) -> dict[str, int]:
        canonical, _ = self.resolve_person_id(person_id)
        counts: dict[str, int] = {}
        for key, view in MODULE_VIEWS.items():
            try:
                counts[key] = self._count_module(view, canonical)
            except sqlite3.Error:
                counts[key] = 0
        return counts

    def module_rows(
        self,
        module: str,
        person_id: int,
        *,
        limit: int = 80,
        offset: int = 0,
    ) -> dict[str, Any]:
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
