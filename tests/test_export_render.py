"""Tests for scheme-B export/display rendering."""

from __future__ import annotations

from pathlib import Path

import pytest

from cbdb_atlas.export_render import (
    build_export_payload,
    export_filename,
    load_export_schema,
)
from cbdb_atlas.person_export import build_person_workbook, payload_to_workbook
from cbdb_atlas.store import CbdbStore


@pytest.fixture(scope="module")
def store() -> CbdbStore | None:
    db = Path(__file__).resolve().parents[1] / "data" / "source" / "cbdb.sqlite3"
    queries = Path(__file__).resolve().parents[1] / "queries"
    if not db.is_file():
        return None
    return CbdbStore(db, queries)


class TestExportSchema:
    def test_excludes_graph_modules(self):
        schema = load_export_schema()
        assert "graph" in schema["exportExcludeModules"]
        assert "relations" in schema["exportExcludeModules"]
        assert "graph" not in schema["moduleOrder"]
        assert "relations" not in schema["moduleOrder"]
        assert "kinship" in schema["moduleOrder"]
        assert "association" in schema["moduleOrder"]


class TestExportRender:
    def test_export_filename_uses_cbdb_prefix(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        person = store.get_person(3767)
        assert person
        name = export_filename(person)
        assert name.startswith("CBDB_人物_")
        assert name.endswith(".xlsx")
        assert "CDBD" not in name

    def test_build_export_payload_structure(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        payload = build_export_payload(store, 3767)
        assert payload["person_id"] == 3767
        assert payload["filename"].startswith("CBDB_人物_")
        titles = [s["title"] for s in payload["sheets"]]
        assert titles[0] == "基本資料"
        assert "人物關係" not in titles
        assert "關係星圖" not in titles

    def test_workbook_bytes(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        content, filename = build_person_workbook(store, 3767)
        assert filename.startswith("CBDB_人物_")
        assert content[:2] == b"PK"

    def test_display_basic_via_api_shape(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        from cbdb_atlas.export_render import build_basic_display

        data = build_basic_display(store, 3767)
        assert data["format"] == "display"
        assert data["layout"] == "kv"
        assert data["rows"]
        assert "label" in data["rows"][0]
        assert "value" in data["rows"][0]

    def test_display_table_cells_have_text(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        from cbdb_atlas.export_render import build_table_display

        data = build_table_display(store, 3767, "posting", limit=5, offset=0)
        assert data["format"] == "display"
        assert data["layout"] == "table"
        if data["rows"]:
            assert "text" in data["rows"][0]["cells"][0]

    def test_payload_to_workbook_roundtrip(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        payload = build_export_payload(store, 3767)
        xlsx = payload_to_workbook(payload)
        assert len(xlsx) > 1000
