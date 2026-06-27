"""Family-view graph: kinship BFS with person enrichment and geo/choronym layer."""

from __future__ import annotations

from collections import Counter
from typing import Any, TYPE_CHECKING

from cbdb_atlas.visual.edge_categories import classify_kinship
from cbdb_atlas.visual.graph_labels import is_meaningless_graph_label, sanitize_graph_payload
from cbdb_atlas.visual.models import MAX_GRAPH_NODES

if TYPE_CHECKING:
    from cbdb_atlas.store import CbdbStore

MAX_GEO_NODES = 24


def family_graph(
    store: CbdbStore,
    person_id: int,
    *,
    max_up: int = 3,
    max_down: int = 3,
    max_col: int = 3,
    addr_split: bool = True,
    spouse_expand: bool = True,
    prune_by_addr: bool = False,
) -> dict[str, Any]:
    """Build a family kinship graph with optional choronym / index-addr hubs.

    ``addr_split`` (legacy name kept for API compat) enables the **geo layer**:
    choronym/index hubs and ``branch_stats``. When ``prune_by_addr`` is false
    (default), all kin within depth limits are included regardless of place.
    """
    person = store.get_person(person_id)
    if not person:
        raise ValueError("Person not found")
    canonical = int(person.get("_canonical_id") or person["c_personid"])
    center_label = str(
        person.get("c_name_chn") or person.get("c_name") or canonical
    ).strip()
    seed_split = _split_key(person)
    geo_layer = addr_split

    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    edge_ids: set[str] = set()
    truncated = False
    person_count = 0

    def ensure_person_node(
        pid: int,
        *,
        role: str,
        label: str,
        generation: int = 0,
        person_row: dict[str, Any] | None = None,
    ) -> str | None:
        nonlocal truncated, person_count
        key = str(pid)
        if key in nodes:
            if person_row:
                _merge_person_meta(nodes[key], person_row)
            return key
        if person_count >= MAX_GRAPH_NODES:
            truncated = True
            return None
        person_count += 1
        meta = _person_meta(person_row or {})
        nodes[key] = {
            "id": key,
            "node_type": "person",
            "person_id": pid,
            "label": label[:24],
            "full_label": label[:48],
            "role": role,
            "generation": generation,
            **meta,
        }
        return key

    def add_edge(
        eid: str,
        src: str,
        tgt: str,
        label: str,
        detail: dict[str, Any],
        etype: str,
        *,
        category: str = "",
    ) -> None:
        if eid in edge_ids:
            return
        edge_ids.add(eid)
        edges.append(
            {
                "id": eid,
                "source": src,
                "target": tgt,
                "type": etype,
                "label": label,
                "category": category or classify_kinship(detail) if etype.startswith("kinship") else "",
                "detail": detail,
            }
        )

    center_key = ensure_person_node(
        canonical,
        role="center",
        label=center_label,
        generation=0,
        person_row=person,
    )
    if not center_key:
        raise ValueError("Unable to create center node")

    states: dict[int, tuple[int, int, int]] = {canonical: (0, 0, 0)}
    queue: list[int] = [canonical]

    while queue:
        pid = queue.pop(0)
        state = states[pid]
        source_key = str(pid)
        if source_key not in nodes:
            continue
        for row in store.module_rows_all("kinship", pid):
            kin_id = row.get("c_kin_id")
            if kin_id is None:
                continue
            kin_id = int(kin_id)
            if kin_id == pid:
                continue
            up = int(row.get("c_upstep") or 0)
            dwn = int(row.get("c_dwnstep") or 0)
            col = int(row.get("c_colstep") or 0)
            mar = int(row.get("c_marstep") or 0)

            new_state = list(state)
            if up > 0:
                new_state[0] = state[0] + up
            elif dwn > 0:
                new_state[1] = state[1] + dwn
            elif col > 0:
                new_state[2] = state[2] + col
            elif mar > 0:
                pass
            else:
                new_state[2] = state[2] + 1

            if new_state[0] > max_up or new_state[1] > max_down or new_state[2] > max_col:
                continue

            kin_person = store.get_person(kin_id)
            if not kin_person:
                continue
            kin_split = _split_key(kin_person)
            if prune_by_addr and seed_split and kin_split and kin_split != seed_split:
                if mar == 0:
                    continue

            generation = new_state[1] - new_state[0]
            role = "kin" if generation != 0 else "center"
            label = str(row.get("c_kin_chn") or row.get("c_kin_name") or kin_id)
            kin_key = ensure_person_node(
                kin_id,
                role=role,
                label=label,
                generation=generation,
                person_row=kin_person,
            )
            if not kin_key:
                continue

            rel = str(row.get("c_kinrel_chn") or row.get("c_kinrel") or "親屬")
            etype = "kinship-marriage" if mar > 0 else "kinship"
            seq = row.get("c_sequence")
            eid = f"kin-{source_key}-{kin_key}-{row.get('c_kin_code')}-{seq}"
            add_edge(eid, source_key, kin_key, rel, row, etype)

            if kin_id in states:
                continue
            if mar > 0 and not spouse_expand:
                states[kin_id] = tuple(new_state)
                continue
            states[kin_id] = tuple(new_state)
            queue.append(kin_id)

    branch_stats: list[dict[str, Any]] = []
    if geo_layer:
        _attach_geo_layer(nodes, edges, edge_ids, branch_stats)

    kin_edges = sum(1 for e in edges if e["type"].startswith("kinship"))
    geo_edges = len(edges) - kin_edges
    return sanitize_graph_payload(
        {
            "center_id": center_key,
            "center_label": center_label,
            "center_split_key": seed_split,
            "nodes": list(nodes.values()),
            "edges": edges,
            "mode": "family",
            "branch_stats": branch_stats,
            "stats": {
                "node_count": len(nodes),
                "person_count": person_count,
                "edge_count": len(edges),
                "kin_edge_count": kin_edges,
                "geo_edge_count": geo_edges,
                "truncated": truncated,
                "max_nodes": MAX_GRAPH_NODES,
                "max_up": max_up,
                "max_down": max_down,
                "max_col": max_col,
            },
        }
    )


def _person_meta(person: dict[str, Any]) -> dict[str, Any]:
    chor = str(
        person.get("c_choronym_desc_chn") or person.get("c_choronym_chn") or ""
    ).strip()
    index_addr = str(
        person.get("c_index_addr_chn") or person.get("c_index_addr_name") or ""
    ).strip()
    split_key = _split_key(person)
    birth = person.get("c_birthyear")
    death = person.get("c_deathyear")
    years = ""
    if birth is not None or death is not None:
        years = f"{birth if birth is not None else '—'}–{death if death is not None else '—'}"
    return {
        "birth_year": birth,
        "death_year": death,
        "years": years,
        "dynasty_chn": person.get("c_dynasty_chn"),
        "choronym_chn": chor or None,
        "index_addr_chn": index_addr or None,
        "split_key": split_key or None,
        "female": person.get("c_female"),
    }


def _merge_person_meta(node: dict[str, Any], person: dict[str, Any]) -> None:
    node.update(_person_meta(person))


def _attach_geo_layer(
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    edge_ids: set[str],
    branch_stats: list[dict[str, Any]],
) -> None:
    split_members: dict[str, list[str]] = {}
    for node in nodes.values():
        if node.get("node_type") != "person":
            continue
        key = str(node.get("split_key") or "").strip()
        if is_meaningless_graph_label(key):
            continue
        split_members.setdefault(key, []).append(node["id"])

    counter = Counter({k: len(v) for k, v in split_members.items()})
    geo_added = 0
    for split_key, count in counter.most_common():
        member_ids = split_members[split_key]
        branch_stats.append(
            {
                "split_key": split_key,
                "addr_chn": split_key,
                "count": count,
                "sample_persons": [
                    {
                        "id": nodes[mid].get("person_id"),
                        "name": nodes[mid].get("full_label") or nodes[mid].get("label"),
                    }
                    for mid in member_ids[:5]
                    if mid in nodes
                ],
            }
        )
        if geo_added >= MAX_GEO_NODES:
            continue
        hub_id = f"geo:{split_key}"
        if hub_id in nodes:
            continue
        is_choronym = any(
            nodes[mid].get("choronym_chn") == split_key for mid in member_ids if mid in nodes
        )
        hub_type = "choronym" if is_choronym else "place"
        nodes[hub_id] = {
            "id": hub_id,
            "node_type": hub_type,
            "person_id": None,
            "label": split_key[:16],
            "full_label": split_key[:48],
            "role": f"geo-{hub_type}",
            "generation": 99,
            "split_key": split_key,
        }
        geo_added += 1
        for mid in member_ids:
            eid = f"geo-{mid}-{hub_id}"
            if eid in edge_ids:
                continue
            edge_ids.add(eid)
            person = nodes.get(mid, {})
            link_label = "郡望" if hub_type == "choronym" else "籍貫"
            edges.append(
                {
                    "id": eid,
                    "source": mid,
                    "target": hub_id,
                    "type": "geo-link",
                    "label": link_label,
                    "category": "",
                    "detail": {
                        "split_key": split_key,
                        "choronym_chn": person.get("choronym_chn"),
                        "index_addr_chn": person.get("index_addr_chn"),
                    },
                }
            )


def _split_key(person: dict[str, Any]) -> str:
    chor = str(
        person.get("c_choronym_desc_chn") or person.get("c_choronym_chn") or ""
    ).strip()
    if chor:
        return chor
    return str(
        person.get("c_index_addr_chn") or person.get("c_index_addr_name") or ""
    ).strip()
