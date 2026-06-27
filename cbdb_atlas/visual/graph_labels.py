from __future__ import annotations

from typing import Any

MEANINGLESS_GRAPH_LABELS = frozenset({
    "",
    "—",
    "-",
    "－",
    "未详",
    "未詳",
    "不详",
    "不詳",
    "未知",
    "无",
    "無",
    "无记载",
    "無記載",
    "不明",
    "缺载",
    "缺載",
    "n/a",
    "na",
    "null",
    "none",
})

_LABEL_BRACKET_PAIRS = (
    ("【", "】"),
    ("[", "]"),
    ("(", ")"),
    ("（", "）"),
    ("「", "」"),
    ("『", "』"),
    ("《", "》"),
    ("〈", "〉"),
    ("［", "］"),
    ("｛", "｝"),
    ("{", "}"),
)


def normalize_graph_label(value: Any) -> str:
    """Strip outer brackets/quotes so 【未详】 matches 未详."""
    t = str(value or "").strip()
    if not t:
        return ""
    prev = None
    while t and t != prev:
        prev = t
        for open_c, close_c in _LABEL_BRACKET_PAIRS:
            min_len = len(open_c) + len(close_c)
            if len(t) > min_len and t.startswith(open_c) and t.endswith(close_c):
                t = t[len(open_c) : -len(close_c)].strip()
                break
    return t


def is_meaningless_graph_label(value: Any) -> bool:
    """True when a graph node label carries no useful information."""
    t = normalize_graph_label(value)
    if not t:
        return True
    if t in MEANINGLESS_GRAPH_LABELS:
        return True
    return t.lower() in MEANINGLESS_GRAPH_LABELS


def should_drop_graph_node(node: dict[str, Any] | None) -> bool:
    if not node or node.get("role") == "center":
        return False
    person_id = node.get("person_id")
    if person_id is not None:
        try:
            int(person_id)
            return False
        except (TypeError, ValueError):
            pass
    label = str(
        node.get("full_label") or node.get("label") or node.get("split_key") or ""
    ).strip()
    return is_meaningless_graph_label(label)


def sanitize_graph_payload(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if not data or not isinstance(data.get("nodes"), list) or not data["nodes"]:
        return data
    drop = {str(n["id"]) for n in data["nodes"] if should_drop_graph_node(n)}
    if not drop:
        return data
    nodes = [n for n in data["nodes"] if str(n["id"]) not in drop]
    edges = [
        e
        for e in data.get("edges") or []
        if str(e.get("source")) not in drop and str(e.get("target")) not in drop
    ]
    stats = dict(data.get("stats") or {})
    stats["node_count"] = len(nodes)
    stats["edge_count"] = len(edges)
    return {**data, "nodes": nodes, "edges": edges, "stats": stats}
