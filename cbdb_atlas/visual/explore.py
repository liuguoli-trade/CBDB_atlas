from __future__ import annotations

from pathlib import Path
from typing import Any, TYPE_CHECKING

from cbdb_atlas.visual.graph_index import GraphIndex, canonical_id, build_merge_map
from cbdb_atlas.visual.models import (
    DEFAULT_EXPLORE_DEPTH,
    EXPLORE_STRATEGIES,
    MAX_EXPLORE_DEPTH,
    MAX_EXPLORE_PERSONS,
    MAX_GRAPH_NODES,
)

if TYPE_CHECKING:
    from cbdb_atlas.store import CbdbStore


def explore_graph(
    store: CbdbStore,
    index_path: Path,
    person_ids: list[int],
    *,
    strategy: str = "pairwise_shortest",
    edge_types: list[str] | None = None,
    max_depth: int = DEFAULT_EXPLORE_DEPTH,
) -> dict[str, Any]:
    if strategy not in EXPLORE_STRATEGIES:
        raise ValueError(f"Unknown strategy: {strategy}")
    if len(person_ids) < 2:
        raise ValueError("At least 2 persons required")
    if len(person_ids) > MAX_EXPLORE_PERSONS:
        raise ValueError(f"At most {MAX_EXPLORE_PERSONS} persons allowed")
    max_depth = max(1, min(max_depth, MAX_EXPLORE_DEPTH))

    merge_map = build_merge_map(store.conn)
    canonical_ids = []
    for pid in person_ids:
        c = canonical_id(int(pid), merge_map)
        if not store.get_person(c):
            raise ValueError(f"Person not found: {pid}")
        canonical_ids.append(c)
    unique_ids = list(dict.fromkeys(canonical_ids))

    allowed = _normalize_edge_types(edge_types)
    index = GraphIndex(index_path)
    try:
        paths: list[dict[str, Any]] = []
        for i, a in enumerate(unique_ids):
            for b in unique_ids[i + 1 :]:
                path_steps = index.shortest_path(
                    a, b, max_depth=max_depth, edge_types=allowed
                )
                pa = store.get_person(a) or {}
                pb = store.get_person(b) or {}
                name_a = str(pa.get("c_name_chn") or pa.get("c_name") or a)
                name_b = str(pb.get("c_name_chn") or pb.get("c_name") or b)
                paths.append(
                    {
                        "from": a,
                        "to": b,
                        "from_name": name_a,
                        "to_name": name_b,
                        "found": path_steps is not None,
                        "hops": len(path_steps) if path_steps else 0,
                        "steps": path_steps or [],
                    }
                )

        union = _build_union_graph(store, unique_ids, paths)
        union["mode"] = "explore"
        union["strategy"] = strategy
        union["paths"] = paths
        union["stats"] = {
            **union.get("stats", {}),
            "pairs_total": len(paths),
            "pairs_found": sum(1 for p in paths if p["found"]),
            "max_depth": max_depth,
        }
        return union
    finally:
        index.close()


def _normalize_edge_types(edge_types: list[str] | None) -> set[str]:
    if not edge_types:
        return {"kinship", "kinship-marriage", "association"}
    allowed: set[str] = set()
    for t in edge_types:
        if t == "kinship":
            allowed.add("kinship")
            allowed.add("kinship-marriage")
        elif t in {"association", "kinship-marriage"}:
            allowed.add(t)
    return allowed or {"kinship", "kinship-marriage", "association"}


def _build_union_graph(
    store: CbdbStore,
    endpoint_ids: list[int],
    paths: list[dict[str, Any]],
) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    edge_ids: set[str] = set()
    truncated = False

    def ensure_node(pid: int, *, role: str) -> str | None:
        nonlocal truncated
        key = str(pid)
        if key in nodes:
            return key
        if len(nodes) >= MAX_GRAPH_NODES:
            truncated = True
            return None
        person = store.get_person(pid)
        label = str(
            (person or {}).get("c_name_chn")
            or (person or {}).get("c_name")
            or pid
        )[:24]
        nodes[key] = {
            "id": key,
            "person_id": pid,
            "label": label,
            "role": role,
        }
        return key

    endpoint_set = set(endpoint_ids)
    for pid in endpoint_ids:
        ensure_node(pid, role="path-endpoint")

    for path_info in paths:
        if not path_info.get("found"):
            continue
        for step in path_info["steps"]:
            a, b = int(step["from"]), int(step["to"])
            for pid, role in ((a, "path-via"), (b, "path-via")):
                if pid not in endpoint_set:
                    ensure_node(pid, role=role)
            ak, bk = str(a), str(b)
            if not ak or not bk:
                continue
            eid = f"path-{ak}-{bk}-{step.get('link_code', 0)}"
            if eid in edge_ids:
                continue
            edge_ids.add(eid)
            edges.append(
                {
                    "id": eid,
                    "source": ak,
                    "target": bk,
                    "type": "path",
                    "label": step.get("label") or "",
                    "detail": step.get("detail") or {},
                    "on_path": True,
                }
            )

    labels = []
    for pid in endpoint_ids:
        p = store.get_person(pid)
        if p:
            labels.append(str(p.get("c_name_chn") or p.get("c_name") or pid))

    return {
        "center_id": str(endpoint_ids[0]),
        "center_label": " · ".join(labels[:3]) + (" …" if len(labels) > 3 else ""),
        "nodes": list(nodes.values()),
        "edges": edges,
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "truncated": truncated,
            "max_nodes": MAX_GRAPH_NODES,
        },
    }
