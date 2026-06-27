"""Tests for graph index BFS helpers."""

from __future__ import annotations

from cbdb_atlas.visual.graph_index import _edge_types_for_kind


class TestGraphIndexBfs:
    def test_edge_types_all(self):
        allowed = _edge_types_for_kind("all")
        assert "kinship" in allowed
        assert "kinship-marriage" in allowed
        assert "association" in allowed

    def test_edge_types_kinship(self):
        allowed = _edge_types_for_kind("kinship")
        assert allowed == {"kinship", "kinship-marriage"}

    def test_edge_types_association(self):
        assert _edge_types_for_kind("association") == {"association"}
