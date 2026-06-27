from __future__ import annotations

from collections import Counter
from typing import Any, TYPE_CHECKING

from cbdb_atlas.visual.graph_service import GraphService

if TYPE_CHECKING:
    from cbdb_atlas.store import CbdbStore


def circle_graph(
    store: CbdbStore,
    person_id: int,
    *,
    steps: int = 2,
) -> dict[str, Any]:
    if steps not in {1, 2, 3, 4, 5}:
        raise ValueError("circle steps must be between 1 and 5")
    payload = GraphService(store).single(person_id, steps=steps, kind="association")
    payload["mode"] = "circle"

    center_id = int(payload["center_id"])
    addr_counter: Counter[str] = Counter()
    addr_meta: dict[str, dict[str, Any]] = {}

    for node in payload["nodes"]:
        pid = int(node["person_id"])
        if pid == center_id:
            continue
        person = store.get_person(pid)
        if not person:
            continue
        addr = str(
            person.get("c_index_addr_chn") or person.get("c_index_addr_name") or "未詳"
        ).strip()
        addr_counter[addr] += 1
        if addr not in addr_meta:
            addr_meta[addr] = {
                "addr_chn": addr,
                "addr_id": person.get("c_index_addr_id"),
                "sample_persons": [],
            }
        samples = addr_meta[addr]["sample_persons"]
        if len(samples) < 5:
            samples.append(
                {
                    "id": pid,
                    "name": node.get("label") or person.get("c_name_chn"),
                }
            )

    total = sum(addr_counter.values()) or 1
    addr_stats = []
    for addr, count in addr_counter.most_common(20):
        meta = addr_meta[addr]
        addr_stats.append(
            {
                **meta,
                "count": count,
                "ratio": round(count / total, 4),
            }
        )
    payload["addr_stats"] = addr_stats
    return payload
