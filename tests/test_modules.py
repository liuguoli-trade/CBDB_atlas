"""Tests for merged biography modules (institution / event / possessions)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from cbdb_atlas.store import MODULE_ALIASES, MODULE_VIEWS, CbdbStore


class TestModuleViewsConfig:
    def test_merged_views(self):
        assert MODULE_VIEWS["institution"] == "View_BiogInstAddrData"
        assert MODULE_VIEWS["event"] == "View_EventFullData"
        assert MODULE_VIEWS["possessions"] == "View_PossessionsAddrData"

    def test_addr_modules_not_primary(self):
        for legacy in ("institution_addr", "event_addr", "possessions_addr"):
            assert legacy not in MODULE_VIEWS
            assert MODULE_ALIASES[legacy] == legacy.replace("_addr", "")

    def test_resolve_module_id(self):
        assert CbdbStore.resolve_module_id("event_addr") == "event"
        assert CbdbStore.resolve_module_id("institution") == "institution"


@pytest.fixture(scope="module")
def store() -> CbdbStore | None:
    db = Path(__file__).resolve().parents[1] / "data" / "source" / "cbdb.sqlite3"
    queries = Path(__file__).resolve().parents[1] / "queries"
    if not db.is_file():
        return None
    return CbdbStore(db, queries)


def _view_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='view' AND name=? LIMIT 1",
        (name,),
    ).fetchone()
    return row is not None


class TestMergedModulesIntegration:
    def test_event_full_view_queryable(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        if not _view_exists(store.conn, "View_EventFullData"):
            pytest.skip("Run scripts/create_views.sh to create View_EventFullData")

        row = store.conn.execute(
            "SELECT COUNT(*) FROM View_EventFullData WHERE c_personid = 3767"
        ).fetchone()
        assert row is not None
        assert row[0] >= 0

    def test_event_module_includes_events_without_addr(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        if not _view_exists(store.conn, "View_EventFullData"):
            pytest.skip("Run scripts/create_views.sh to create View_EventFullData")

        legacy = store.module_rows("event", 3767, limit=500, offset=0)
        full = store.conn.execute(
            "SELECT COUNT(*) FROM View_EventData WHERE c_personid = 3767"
        ).fetchone()[0]
        assert legacy["total"] >= full

    def test_legacy_module_alias(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")
        if not _view_exists(store.conn, "View_BiogInstAddrData"):
            pytest.skip("Views not built")

        a = store.module_rows("institution", 3767, limit=5, offset=0)
        b = store.module_rows("institution_addr", 3767, limit=5, offset=0)
        assert a["total"] == b["total"]
        assert a["rows"] == b["rows"]


class TestPlaceSearch:
    def test_place_search_returns_enriched_columns(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        data = store.search_places("州", limit=5, offset=0)
        assert data["total"] > 0
        row = data["results"][0]
        for key in (
            "c_name_chn",
            "c_alt_names",
            "c_dynasty_chn",
            "c_parent_addr_chn",
            "c_child_addrs_chn",
            "c_firstyear",
            "c_lastyear",
        ):
            assert key in row
        assert row["c_dynasty_chn"]
        assert "、" not in row["c_dynasty_chn"] or "–" in row["c_dynasty_chn"]

    def test_place_search_sorted_by_dynasty_and_years(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        data = store.search_places("長安", limit=30, offset=0)
        assert data["total"] > 1
        rows = data["results"]

        def dynasty_sort(row: dict) -> int:
            fy, ly = row.get("c_firstyear"), row.get("c_lastyear")
            for year in (fy, ly):
                if year is None:
                    continue
                hit = store.conn.execute(
                    """
                    SELECT d.c_sort FROM DYNASTIES d
                    WHERE ? >= COALESCE(d.c_start, -9999)
                      AND ? <= COALESCE(d.c_end, 9999)
                    ORDER BY d.c_sort
                    LIMIT 1
                    """,
                    (year, year),
                ).fetchone()
                if hit:
                    return int(hit[0])
            return 9999

        sort_keys = [
            (
                r.get("_sort_dynasty") if r.get("_sort_dynasty") is not None else dynasty_sort(r),
                r.get("c_firstyear") or 9999,
                r.get("c_lastyear") or 9999,
            )
            for r in rows
        ]
        assert sort_keys == sorted(sort_keys)

    def test_place_search_lists_subordinate_districts(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        belongs = store.conn.execute(
            "SELECT c_belongs_to FROM ADDR_BELONGS_DATA GROUP BY c_belongs_to HAVING COUNT(*) > 0 LIMIT 1"
        ).fetchone()
        if not belongs:
            pytest.skip("No address hierarchy in database")
        addr_id = belongs[0]
        data = store.search_places(str(addr_id), limit=1, offset=0)
        assert data["results"]
        child_text = data["results"][0].get("c_child_addrs_chn")
        assert child_text


class TestPersonNameFields:
    def test_person_search_includes_name_parts(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        data = store.search_persons("赵", limit=5)
        assert data["total"] > 0
        row = data["results"][0]
        for key in (
            "c_surname_chn",
            "c_mingzi_chn",
            "c_surname_proper",
            "c_mingzi_proper",
            "c_alt_names",
        ):
            assert key in row

    def test_person_search_alt_names_from_altname(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        row = store.conn.execute(
            """
            SELECT a.c_personid, a.c_alt_name_chn
            FROM View_AltnameData a
            WHERE a.c_alt_name_chn IS NOT NULL AND TRIM(a.c_alt_name_chn) != ''
            LIMIT 1
            """
        ).fetchone()
        if not row:
            pytest.skip("No alt names in database")

        pid, alt = row[0], row[1]
        data = store.search_persons(str(pid), limit=5)
        match = next((r for r in data["results"] if r["c_personid"] == pid), None)
        assert match is not None
        assert alt in (match.get("c_alt_names") or "")

    def test_rare_character_name_preserved_in_search(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        row = store.conn.execute(
            """
            SELECT c_personid, c_name_chn, c_mingzi_chn
            FROM BIOG_MAIN
            WHERE c_name_chn IS NOT NULL
            LIMIT 500000
            """
        )
        sample = None
        for pid, name_chn, mingzi in row:
            text = (name_chn or "") + (mingzi or "")
            if any(ord(ch) > 0x9FFF for ch in text):
                sample = (pid, name_chn)
                break
        if not sample:
            pytest.skip("No extension-B names in database sample")

        pid, name_chn = sample
        hit = store.search_persons(str(pid), limit=5)
        match = next((r for r in hit["results"] if r["c_personid"] == pid), None)
        assert match is not None
        assert match["c_name_chn"] == name_chn


class TestTextSearch:
    def test_text_search_returns_enriched_columns(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        data = store.search_texts("史", limit=5)
        assert data["total"] > 0
        row = data["results"][0]
        for key in (
            "c_textid",
            "c_title_chn",
            "c_title_alt_chn",
            "c_responsible_persons",
            "c_text_type_desc_chn",
            "c_text_cat_desc_chn",
            "c_dynasty_chn",
            "c_text_year",
            "c_nianhao_chn",
            "c_text_nh_year",
            "c_range_chn",
            "c_extant_desc_chn",
        ):
            assert key in row

    def test_text_search_responsible_persons(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        row = store.conn.execute(
            """
            SELECT t.c_textid, t.c_title_chn, p.c_name_chn
            FROM BIOG_TEXT_DATA btd
            JOIN BIOG_MAIN p ON p.c_personid = btd.c_personid
            JOIN TEXT_CODES t ON t.c_textid = btd.c_textid
            WHERE btd.c_personid > 0
              AND p.c_name_chn IS NOT NULL AND TRIM(p.c_name_chn) != ''
              AND t.c_title_chn IS NOT NULL AND TRIM(t.c_title_chn) != ''
            LIMIT 1
            """
        ).fetchone()
        if not row:
            pytest.skip("No biog-text links in database")

        textid, title, person_name = row[0], row[1], row[2]
        data = store.search_texts(str(textid), limit=5)
        match = next(
            (r for r in data["results"] if r.get("c_textid") == textid),
            None,
        )
        assert match is not None
        persons = match.get("c_responsible_persons") or ""
        assert person_name in persons
        assert "（" in persons

    def test_text_search_sort_by_dynasty_siku_title(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        query = "史"
        data = store.search_texts(query, limit=30)
        assert data["total"] > 1

        def sort_key(textid: int) -> tuple:
            row = store.conn.execute(
                """
                SELECT COALESCE(d.c_sort, 9999),
                  CASE
                    WHEN t.c_text_type_id LIKE '0101%' THEN 1
                    WHEN t.c_text_type_id LIKE '0102%' THEN 2
                    WHEN t.c_text_type_id LIKE '0103%' THEN 3
                    WHEN t.c_text_type_id LIKE '0104%' THEN 4
                    WHEN t.c_text_type_id LIKE '0105%' THEN 5
                    WHEN t.c_text_type_id LIKE '01%' THEN 6
                    ELSE 99
                  END,
                  COALESCE(NULLIF(TRIM(t.c_title), ''), t.c_title_chn) COLLATE NOCASE,
                  t.c_textid
                FROM TEXT_CODES t
                LEFT JOIN DYNASTIES d ON d.c_dy = t.c_text_dy
                WHERE t.c_textid = ?
                """,
                (textid,),
            ).fetchone()
            return tuple(row)

        def relevance_tier(title: str | None) -> int:
            name = title or ""
            if name == query:
                return 0
            if name.startswith(query):
                return 1
            return 2

        rows = data["results"]
        for left, right in zip(rows, rows[1:]):
            tier_l = relevance_tier(left.get("c_title_chn"))
            tier_r = relevance_tier(right.get("c_title_chn"))
            if tier_l != tier_r:
                assert tier_l <= tier_r
                continue
            assert sort_key(left["c_textid"]) <= sort_key(right["c_textid"])

    def test_text_search_related_person_filter(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        link = store.conn.execute(
            """
            SELECT p.c_name_chn, t.c_title_chn
            FROM BIOG_TEXT_DATA btd
            JOIN BIOG_MAIN p ON p.c_personid = btd.c_personid
            JOIN TEXT_CODES t ON t.c_textid = btd.c_textid
            WHERE p.c_name_chn IS NOT NULL AND TRIM(p.c_name_chn) != ''
              AND t.c_title_chn IS NOT NULL AND TRIM(t.c_title_chn) != ''
            LIMIT 1
            """
        ).fetchone()
        if not link:
            pytest.skip("No biog-text links in database")

        person_name, title = link[0], link[1]
        data = store.search_texts(title[:2] or "史", related_person=person_name, limit=20)
        assert data["total"] > 0
        assert any(r.get("c_title_chn") for r in data["results"])

    def test_text_search_dynasty_filter(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        row = store.conn.execute(
            "SELECT c_text_dy FROM TEXT_CODES WHERE c_text_dy IS NOT NULL LIMIT 1"
        ).fetchone()
        if not row:
            pytest.skip("No text dynasty data")
        dy = int(row[0])
        data = store.search_texts("史", dynasty_code=dy, limit=5)
        assert data["total"] >= 0
        for r in data["results"]:
            meta = store.conn.execute(
                "SELECT c_text_dy FROM TEXT_CODES WHERE c_textid = ?",
                (r["c_textid"],),
            ).fetchone()
            assert meta and meta[0] == dy

    def test_text_search_siku_bibliography_category(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        row = store.conn.execute(
            """
            SELECT t.c_textid, t.c_title_chn
            FROM TEXT_CODES t
            WHERE t.c_text_type_id = '010101'
              AND t.c_title_chn IS NOT NULL AND TRIM(t.c_title_chn) != ''
            LIMIT 1
            """
        ).fetchone()
        if not row:
            pytest.skip("No text with Siku type 010101")

        textid, title = row[0], row[1]
        bu = store.conn.execute(
            "SELECT c_text_type_desc_chn FROM TEXT_TYPE WHERE c_text_type_code = '0101'"
        ).fetchone()[0]
        xiao = store.conn.execute(
            "SELECT c_text_type_desc_chn FROM TEXT_TYPE WHERE c_text_type_code = '010101'"
        ).fetchone()[0]
        data = store.search_texts(str(textid), limit=5)
        match = next(
            (r for r in data["results"] if r.get("c_textid") == textid),
            None,
        )
        assert match is not None
        cat = match.get("c_text_cat_desc_chn") or ""
        assert cat == f"{bu}-{xiao}"

    def test_text_search_siku_biblcat_two_level(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        row = store.conn.execute(
            """
            SELECT t.c_textid
            FROM TEXT_CODES t
            WHERE t.c_bibl_cat_code = 1
              AND (t.c_text_type_id IS NULL OR t.c_text_type_id IN ('', '0', '01'))
            LIMIT 1
            """
        ).fetchone()
        if not row:
            pytest.skip("No text with biblcat 别集 fallback")

        textid = row[0]
        bu = store.conn.execute(
            "SELECT c_text_type_desc_chn FROM TEXT_TYPE WHERE c_text_type_code = '0104'"
        ).fetchone()[0]
        bc = store.conn.execute(
            "SELECT c_text_cat_desc_chn FROM TEXT_BIBLCAT_CODES WHERE c_text_cat_code = 1"
        ).fetchone()[0]
        data = store.search_texts(str(textid), limit=5)
        match = next(
            (r for r in data["results"] if r.get("c_textid") == textid),
            None,
        )
        assert match is not None
        assert match.get("c_text_cat_desc_chn") == f"{bu}-{bc}"

    def test_text_search_siku_level3_shows_level2(self, store: CbdbStore | None):
        if store is None:
            pytest.skip("CBDB database not present")

        row = store.conn.execute(
            """
            SELECT t.c_textid, t.c_text_type_id
            FROM TEXT_CODES t
            JOIN TEXT_TYPE tt ON tt.c_text_type_code = t.c_text_type_id
            WHERE tt.c_text_type_level = 3
            LIMIT 1
            """
        ).fetchone()
        if not row:
            pytest.skip("No level-3 text type assignments")

        textid, type_id = row[0], row[1]
        bu = store.conn.execute(
            """
            WITH RECURSIVE chain AS (
              SELECT c_text_type_code, c_text_type_desc_chn, c_text_type_parent_id, c_text_type_level
              FROM TEXT_TYPE WHERE c_text_type_code = ?
              UNION ALL
              SELECT p.c_text_type_code, p.c_text_type_desc_chn, p.c_text_type_parent_id, p.c_text_type_level
              FROM TEXT_TYPE p INNER JOIN chain ON p.c_text_type_code = chain.c_text_type_parent_id
              WHERE chain.c_text_type_parent_id IS NOT NULL AND chain.c_text_type_parent_id != '0'
            )
            SELECT c_text_type_desc_chn FROM chain WHERE c_text_type_level = 1 LIMIT 1
            """,
            (type_id,),
        ).fetchone()[0]
        xiao = store.conn.execute(
            """
            WITH RECURSIVE chain AS (
              SELECT c_text_type_code, c_text_type_desc_chn, c_text_type_parent_id, c_text_type_level
              FROM TEXT_TYPE WHERE c_text_type_code = ?
              UNION ALL
              SELECT p.c_text_type_code, p.c_text_type_desc_chn, p.c_text_type_parent_id, p.c_text_type_level
              FROM TEXT_TYPE p INNER JOIN chain ON p.c_text_type_code = chain.c_text_type_parent_id
              WHERE chain.c_text_type_parent_id IS NOT NULL AND chain.c_text_type_parent_id != '0'
            )
            SELECT c_text_type_desc_chn FROM chain WHERE c_text_type_level = 2 LIMIT 1
            """,
            (type_id,),
        ).fetchone()[0]
        leaf = store.conn.execute(
            "SELECT c_text_type_desc_chn FROM TEXT_TYPE WHERE c_text_type_code = ?",
            (type_id,),
        ).fetchone()[0]
        data = store.search_texts(str(textid), limit=5)
        match = next(
            (r for r in data["results"] if r.get("c_textid") == textid),
            None,
        )
        assert match is not None
        cat = match.get("c_text_cat_desc_chn") or ""
        assert cat == f"{bu}-{xiao}"
        assert leaf not in cat or leaf == xiao


class TestSimplifiedSearch:
    def test_person_search_simplified_name(self, store: CbdbStore | None):
        pytest.importorskip("opencc")
        if store is None:
            pytest.skip("CBDB database not present")

        data = store.search_persons("苏轼", limit=10)
        assert data["total"] > 0
        names = [
            (r.get("c_name_chn") or "") + (r.get("c_surname_chn") or "") + (r.get("c_mingzi_chn") or "")
            for r in data["results"]
        ]
        assert any("蘇軾" in n or "苏轼" in n for n in names)

    def test_place_search_simplified(self, store: CbdbStore | None):
        pytest.importorskip("opencc")
        if store is None:
            pytest.skip("CBDB database not present")

        data = store.search_places("长安", limit=10)
        assert data["total"] > 0
        labels = [r.get("c_addr_chn") or r.get("c_name_chn") or "" for r in data["results"]]
        assert any("長安" in label for label in labels)

    def test_office_search_simplified(self, store: CbdbStore | None):
        pytest.importorskip("opencc")
        if store is None:
            pytest.skip("CBDB database not present")

        data = store.search("尚书", search_type="office", limit=10)
        assert data["total"] > 0

    def test_person_index_addr_simplified(self, store: CbdbStore | None):
        pytest.importorskip("opencc")
        if store is None:
            pytest.skip("CBDB database not present")

        trad = store.search_persons("王", index_addr="开封", limit=10)
        assert trad["total"] >= 0
        if trad["total"] > 0:
            addrs = [r.get("c_index_addr_chn") or "" for r in trad["results"]]
            assert any("開封" in a or "开封" in a for a in addrs)
