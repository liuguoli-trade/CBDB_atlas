from __future__ import annotations

from pathlib import Path
from typing import Any, TYPE_CHECKING

from cbdb_atlas.store import MAX_NEIGHBORS_PER_HOP
from cbdb_atlas.visual.edge_categories import classify_kinship
from cbdb_atlas.visual.graph_index import GraphIndex, ego_bfs, is_index_ready
from cbdb_atlas.visual.graph_labels import sanitize_graph_payload
from cbdb_atlas.visual.models import GRAPH_KINDS, MAX_GRAPH_NODES

if TYPE_CHECKING:
    from cbdb_atlas.store import CbdbStore


def _node_role_for_hop(hop: int, edge_type: str) -> str:
    if edge_type == "association":
        return "assoc" if hop == 1 else f"hop{hop}"
    return "kin" if hop == 1 else f"hop{hop}"


def _category_counts_from_edges(edges: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {
        "kin": {"core": 0, "extended": 0},
        "assoc": {
            "political": 0,
            "scholarly": 0,
            "literary": 0,
            "other": 0,
        },
    }
    for edge in edges:
        etype = edge.get("type", "")
        cat = edge.get("category", "")
        if etype.startswith("kinship") and cat in counts["kin"]:
            counts["kin"][cat] += 1
        elif etype == "association" and cat in counts["assoc"]:
            counts["assoc"][cat] += 1
    return counts


def _graph_payload(
    *,
    center_key: str,
    center_label: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    steps: int,
    truncated: bool,
    source: str,
) -> dict[str, Any]:
    kin_rows = sum(1 for e in edges if e["type"].startswith("kinship"))
    assoc_rows = sum(1 for e in edges if e["type"] == "association")
    return sanitize_graph_payload(
        {
            "center_id": center_key,
            "center_label": center_label,
            "nodes": nodes,
            "edges": edges,
            "mode": "single",
            "stats": {
                "node_count": len(nodes),
                "edge_count": len(edges),
                "kinship_edges": kin_rows,
                "association_edges": assoc_rows,
                "steps": steps,
                "truncated": truncated,
                "max_nodes": MAX_GRAPH_NODES,
                "category_counts": _category_counts_from_edges(edges),
                "source": source,
            },
        }
    )


class GraphService:
    """Build ego-network graph payloads from CBDB store views or graph index."""

    def __init__(
        self,
        store: CbdbStore,
        *,
        graph_index_path: Path | None = None,
    ) -> None:
        self.store = store
        self.graph_index_path = graph_index_path or store.graph_index_path

    def single(
        self,
        person_id: int,
        *,
        steps: int = 1,
        kind: str = "all",
    ) -> dict[str, Any]:
        if kind not in GRAPH_KINDS:
            raise ValueError(f"Unknown graph kind: {kind}")
        if steps not in {1, 2, 3, 4, 5}:
            raise ValueError("steps must be between 1 and 5")

        person = self.store.get_person(person_id)
        if not person:
            raise ValueError("Person not found")
        canonical = int(person.get("_canonical_id") or person["c_personid"])
        center_label = str(
            person.get("c_name_chn") or person.get("c_name") or canonical
        ).strip()

        if self.graph_index_path and is_index_ready(self.graph_index_path):
            try:
                return self._single_from_index(
                    canonical, center_label, steps=steps, kind=kind
                )
            except (FileNotFoundError, OSError, ValueError):
                pass

        return self._single_from_store(
            canonical, center_label, steps=steps, kind=kind
        )

    def _single_from_index(
        self,
        canonical: int,
        center_label: str,
        *,
        steps: int,
        kind: str,
    ) -> dict[str, Any]:
        index = GraphIndex(self.graph_index_path)  # type: ignore[arg-type]
        try:
            nodes, edges, truncated = ego_bfs(
                index,
                canonical,
                steps=steps,
                kind=kind,
                max_nodes=MAX_GRAPH_NODES,
                max_neighbors=MAX_NEIGHBORS_PER_HOP,
                assoc_classify=self.store.assoc_category_resolver().classify,
            )
        finally:
            index.close()
        return _graph_payload(
            center_key=str(canonical),
            center_label=center_label,
            nodes=nodes,
            edges=edges,
            steps=steps,
            truncated=truncated,
            source="index",
        )

    def _single_from_store(
        self,
        canonical: int,
        center_label: str,
        *,
        steps: int,
        kind: str,
    ) -> dict[str, Any]:
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        edge_ids: set[str] = set()
        truncated = False

        def ensure_node(pid: int, *, role: str, label: str | None = None) -> str | None:
            nonlocal truncated
            key = str(pid)
            if key in nodes:
                return key
            if len(nodes) >= MAX_GRAPH_NODES:
                truncated = True
                return None
            nodes[key] = {
                "id": key,
                "person_id": pid,
                "label": (label or str(pid))[:24],
                "role": role,
            }
            return key

        def add_edge(
            edge_id: str,
            source: str,
            target: str,
            *,
            edge_type: str,
            label: str,
            detail: dict[str, Any],
            category: str,
        ) -> None:
            if edge_id in edge_ids:
                return
            edge_ids.add(edge_id)
            edges.append(
                {
                    "id": edge_id,
                    "source": source,
                    "target": target,
                    "type": edge_type,
                    "label": label,
                    "category": category,
                    "detail": detail,
                }
            )

        def expand_from(source_pid: int, source_key: str, hop: int) -> set[int]:
            nonlocal truncated
            discovered: set[int] = set()
            neighbor_cap = MAX_NEIGHBORS_PER_HOP

            if kind in {"all", "kinship"}:
                kin_rows = self.store.module_rows_all("kinship", source_pid)
                if len(kin_rows) > neighbor_cap:
                    truncated = True
                    kin_rows = kin_rows[:neighbor_cap]
                for row in kin_rows:
                    kin_id = row.get("c_kin_id")
                    if kin_id is None:
                        continue
                    kin_id = int(kin_id)
                    if kin_id == source_pid:
                        continue
                    role = _node_role_for_hop(hop, "kinship")
                    kin_key = ensure_node(
                        kin_id,
                        role=role,
                        label=str(row.get("c_kin_chn") or row.get("c_kin_name") or kin_id),
                    )
                    if not kin_key and str(kin_id) in nodes:
                        kin_key = str(kin_id)
                    if not kin_key:
                        continue
                    rel = str(row.get("c_kinrel_chn") or row.get("c_kinrel") or "親屬")
                    seq = row.get("c_sequence")
                    marstep = int(row.get("c_marstep") or 0)
                    etype = "kinship-marriage" if marstep > 0 else "kinship"
                    eid = f"kin-{source_key}-{kin_key}-{row.get('c_kin_code')}-{seq}"
                    kin_cat = classify_kinship(row)
                    add_edge(
                        eid,
                        source_key,
                        kin_key,
                        edge_type=etype,
                        label=rel,
                        detail=row,
                        category=kin_cat,
                    )
                    discovered.add(kin_id)

            if kind in {"all", "association"}:
                assoc_rows = self.store.module_rows_all("association", source_pid)
                if len(assoc_rows) > neighbor_cap:
                    truncated = True
                    assoc_rows = assoc_rows[:neighbor_cap]
                for row in assoc_rows:
                    node_id = row.get("c_node_id")
                    if node_id is None:
                        continue
                    node_id = int(node_id)
                    if node_id == source_pid:
                        continue
                    role = _node_role_for_hop(hop, "association")
                    node_key = ensure_node(
                        node_id,
                        role=role,
                        label=str(row.get("c_node_chn") or row.get("c_node_name") or node_id),
                    )
                    if not node_key and str(node_id) in nodes:
                        node_key = str(node_id)
                    if not node_key:
                        continue
                    rel = str(row.get("c_link_chn") or row.get("c_link_desc") or "關係")
                    seq = row.get("c_sequence")
                    eid = f"assoc-{source_key}-{node_key}-{row.get('c_link_code')}-{seq}"
                    assoc_cat = self.store.assoc_category_resolver().classify(row)
                    add_edge(
                        eid,
                        source_key,
                        node_key,
                        edge_type="association",
                        label=rel,
                        detail=row,
                        category=assoc_cat,
                    )
                    discovered.add(node_id)

            return discovered

        center_key = ensure_node(canonical, role="center", label=center_label)
        if not center_key:
            raise ValueError("Unable to create center node")

        frontier = {canonical}
        seen = {canonical}

        for hop in range(1, steps + 1):
            if not frontier:
                break
            next_frontier: set[int] = set()
            for pid in frontier:
                source_key = str(pid)
                if source_key not in nodes:
                    continue
                for target_pid in expand_from(pid, source_key, hop):
                    if target_pid not in seen:
                        next_frontier.add(target_pid)
                        seen.add(target_pid)
            frontier = next_frontier

        return _graph_payload(
            center_key=center_key,
            center_label=center_label,
            nodes=list(nodes.values()),
            edges=edges,
            steps=steps,
            truncated=truncated,
            source="store",
        )
