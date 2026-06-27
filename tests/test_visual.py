"""Tests for visual search module."""

from __future__ import annotations

import pytest

from cbdb_atlas.visual.edge_categories import (
    ASSOC_CATEGORY_LITERARY,
    ASSOC_CATEGORY_OTHER,
    ASSOC_CATEGORY_POLITICAL,
    ASSOC_CATEGORY_SCHOLARLY,
    KIN_CATEGORY_CORE,
    KIN_CATEGORY_EXTENDED,
    AssocCategoryResolver,
    classify_assoc_type_code,
    classify_kinship,
    infer_assoc_category_from_row,
)
from cbdb_atlas.visual.explore import _normalize_edge_types
from cbdb_atlas.visual.family import _attach_geo_layer, _person_meta, _split_key
from cbdb_atlas.visual.graph_labels import is_meaningless_graph_label
from cbdb_atlas.visual.models import (
    EXPLORE_STRATEGIES,
    GRAPH_KINDS,
    MAX_EXPLORE_PERSONS,
    MAX_GRAPH_NODES,
)


class TestEdgeCategories:
    def test_kinship_core_lineal(self):
        assert classify_kinship({"c_upstep": 1, "c_kinrel_chn": "父"}) == KIN_CATEGORY_CORE
        assert classify_kinship({"c_dwnstep": 1, "c_kinrel_chn": "子"}) == KIN_CATEGORY_CORE

    def test_kinship_core_sibling(self):
        row = {"c_colstep": 1, "c_marstep": 0, "c_kinrel_chn": "兄"}
        assert classify_kinship(row) == KIN_CATEGORY_CORE

    def test_kinship_core_spouse(self):
        row = {"c_marstep": 1, "c_kinrel_chn": "妻"}
        assert classify_kinship(row) == KIN_CATEGORY_CORE

    def test_kinship_extended_collateral(self):
        row = {"c_colstep": 1, "c_marstep": 0, "c_kinrel_chn": "侄"}
        assert classify_kinship(row) == KIN_CATEGORY_EXTENDED

    def test_kinship_core_adoption_whitelist(self):
        row = {"c_colstep": 2, "c_kinrel_chn": "養子"}
        assert classify_kinship(row) == KIN_CATEGORY_CORE

    def test_assoc_type_roots(self):
        parent_map = {
            "04": "0",
            "0402": "04",
            "02": "0",
            "0202": "02",
            "0207": "02",
            "05": "0",
            "0509": "05",
            "03": "0",
            "0301": "03",
            "01": "0",
            "0103": "01",
        }
        assert classify_assoc_type_code("0402", parent_map) == ASSOC_CATEGORY_POLITICAL
        assert classify_assoc_type_code("0202", parent_map) == ASSOC_CATEGORY_SCHOLARLY
        assert classify_assoc_type_code("0207", parent_map) == ASSOC_CATEGORY_LITERARY
        assert classify_assoc_type_code("0509", parent_map) == ASSOC_CATEGORY_LITERARY
        assert classify_assoc_type_code("0301", parent_map) == ASSOC_CATEGORY_SCHOLARLY
        assert classify_assoc_type_code("0103", parent_map) == ASSOC_CATEGORY_OTHER

    def test_infer_assoc_from_row(self):
        assert infer_assoc_category_from_row({"c_text_title": "某某序"}) == ASSOC_CATEGORY_LITERARY
        assert infer_assoc_category_from_row({"c_topic_desc_chn": "經學"}) == ASSOC_CATEGORY_SCHOLARLY
        assert infer_assoc_category_from_row({}) == ASSOC_CATEGORY_OTHER


class TestVisualModels:
    def test_graph_kinds(self):
        assert "all" in GRAPH_KINDS
        assert "kinship" in GRAPH_KINDS
        assert "association" in GRAPH_KINDS

    def test_limits(self):
        assert MAX_GRAPH_NODES == 120
        assert MAX_EXPLORE_PERSONS == 10
        assert "pairwise_shortest" in EXPLORE_STRATEGIES


class TestExploreEdgeTypes:
    def test_default_includes_all(self):
        allowed = _normalize_edge_types(None)
        assert "kinship" in allowed
        assert "association" in allowed

    def test_kinship_includes_marriage(self):
        allowed = _normalize_edge_types(["kinship"])
        assert "kinship-marriage" in allowed

    def test_association_only(self):
        allowed = _normalize_edge_types(["association"])
        assert allowed == {"association"}


class TestFamilySplitKey:
    def test_choronym_preferred(self):
        person = {
            "c_choronym_desc_chn": "隴西李氏",
            "c_index_addr_chn": "眉州",
        }
        assert _split_key(person) == "隴西李氏"

    def test_index_addr_fallback(self):
        person = {"c_index_addr_chn": "眉州"}
        assert _split_key(person) == "眉州"

    def test_empty(self):
        assert _split_key({}) == ""


class TestFamilyGeoLayer:
    def test_person_meta_years(self):
        meta = _person_meta({
            "c_birthyear": 1021,
            "c_deathyear": 1086,
            "c_dynasty_chn": "宋",
        })
        assert meta["years"] == "1021–1086"
        assert meta["dynasty_chn"] == "宋"

    def test_attach_geo_layer(self):
        nodes = {
            "1": {
                "id": "1",
                "node_type": "person",
                "split_key": "隴西",
                "choronym_chn": "隴西",
                "person_id": 1,
                "label": "A",
            },
            "2": {
                "id": "2",
                "node_type": "person",
                "split_key": "隴西",
                "choronym_chn": "隴西",
                "person_id": 2,
                "label": "B",
            },
        }
        edges: list = []
        edge_ids: set[str] = set()
        branch_stats: list = []
        _attach_geo_layer(nodes, edges, edge_ids, branch_stats)
        assert "geo:隴西" in nodes
        assert len(branch_stats) == 1
        assert branch_stats[0]["count"] == 2
        assert len(edges) == 2

    def test_attach_geo_layer_skips_unknown_split(self):
        nodes = {
            "1": {
                "id": "1",
                "node_type": "person",
                "split_key": None,
                "person_id": 1,
                "label": "A",
            },
            "2": {
                "id": "2",
                "node_type": "person",
                "split_key": "未詳",
                "person_id": 2,
                "label": "B",
            },
        }
        edges: list = []
        edge_ids: set[str] = set()
        branch_stats: list = []
        _attach_geo_layer(nodes, edges, edge_ids, branch_stats)
        assert "geo:未詳" not in nodes
        assert not any(str(k).startswith("geo:") for k in nodes)
        assert len(edges) == 0
        assert len(branch_stats) == 0

    def test_geo_layer_skips_bracketed_unknown_split(self):
        nodes = {
            "1": {
                "id": "1",
                "node_type": "person",
                "split_key": "隴西",
                "person_id": 1,
                "label": "A",
            },
            "2": {
                "id": "2",
                "node_type": "person",
                "split_key": "【未详】",
                "person_id": 2,
                "label": "B",
            },
        }
        edges: list = []
        edge_ids: set[str] = set()
        branch_stats: list = []
        _attach_geo_layer(nodes, edges, edge_ids, branch_stats)
        assert "geo:【未详】" not in nodes
        assert "geo:未详" not in nodes
        assert "geo:隴西" in nodes


class TestGraphLabels:
    def test_meaningless_variants(self):
        assert is_meaningless_graph_label("")
        assert is_meaningless_graph_label("未详")
        assert is_meaningless_graph_label("未詳")
        assert is_meaningless_graph_label("不详")
        assert is_meaningless_graph_label("—")
        assert is_meaningless_graph_label("【未详】")
        assert is_meaningless_graph_label("【未詳】")
        assert is_meaningless_graph_label("[无]")
        assert is_meaningless_graph_label("（無）")

    def test_meaningful_label(self):
        assert not is_meaningless_graph_label("隴西")
        assert not is_meaningless_graph_label("張先")
        assert not is_meaningless_graph_label("【隴西】")

    def test_sanitize_drops_bracketed_unknown_nodes(self):
        from cbdb_atlas.visual.graph_labels import sanitize_graph_payload

        payload = {
            "nodes": [
                {"id": "1", "role": "center", "person_id": 1, "label": "張先"},
                {"id": "attr-0", "role": "hop1", "label": "【未详】"},
                {"id": "attr-1", "role": "hop1", "label": "隴西"},
            ],
            "edges": [
                {"id": "e0", "source": "1", "target": "attr-0", "type": "association"},
                {"id": "e1", "source": "1", "target": "attr-1", "type": "association"},
            ],
            "stats": {"node_count": 3, "edge_count": 2},
        }
        out = sanitize_graph_payload(payload)
        assert len(out["nodes"]) == 2
        assert len(out["edges"]) == 1
        assert out["stats"]["node_count"] == 2
    def test_simplified_to_traditional(self):
        pytest.importorskip("opencc")
        from cbdb_atlas.textnorm import to_traditional_cn

        assert to_traditional_cn("苏轼") == "蘇軾"
        assert to_traditional_cn("王安石") == "王安石"

    def test_empty_passthrough(self):
        from cbdb_atlas.textnorm import to_traditional_cn

        assert to_traditional_cn("") == ""

    def test_normalize_search_query(self):
        pytest.importorskip("opencc")
        from cbdb_atlas.textnorm import normalize_search_query

        assert normalize_search_query("苏轼") == "蘇軾"
        assert normalize_search_query("  长安 ") == "長安"
        assert normalize_search_query("3767") == "3767"
        assert normalize_search_query("Su Shi") == "Su Shi"
        assert normalize_search_query(None) is None
        assert normalize_search_query("") == ""
