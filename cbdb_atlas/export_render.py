"""Build display payloads for person modules and full export (scheme B)."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from cbdb_atlas.display_format import (
    compose_chinese_name,
    format_altname_display,
    format_basic_person_name,
    format_basic_year_display,
    format_module_cell,
    format_source_display,
)
from cbdb_atlas.store import CbdbStore

WEB_DIR = Path(__file__).resolve().parents[1] / "web"
_SCHEMA: dict[str, Any] | None = None
_LABELS: dict[str, Any] | None = None


def load_export_schema() -> dict[str, Any]:
    global _SCHEMA
    if _SCHEMA is None:
        _SCHEMA = json.loads((WEB_DIR / "export-schema.json").read_text(encoding="utf-8"))
    return _SCHEMA


def load_field_labels() -> dict[str, Any]:
    global _LABELS
    if _LABELS is None:
        path = WEB_DIR / "field-labels.js"
        content = path.read_text(encoding="utf-8")
        marker = "window.CBDB_FIELD_LABELS = "
        start = content.index(marker) + len(marker)
        end = content.index(";\n", start)
        _LABELS = json.loads(content[start:end])
    return _LABELS


def field_label(module: str, key: str, labels: dict[str, Any] | None = None) -> str:
    labels = labels or load_field_labels()
    if key == "_source":
        return "參考文獻"
    modules = labels.get("modules", {})
    if key in modules.get(module, {}):
        return modules[module][key]
    return labels.get("by_column", {}).get(key, key)


def visible_columns(module: str, schema: dict[str, Any] | None = None) -> list[str]:
    schema = schema or load_export_schema()
    hidden = set(schema.get("hiddenColumns", []))
    cols = schema.get("moduleColumns", {}).get(module, [])
    return [c for c in cols if c not in hidden]


def _cell_link_meta(
    module: str,
    row: dict[str, Any],
    col: str,
    schema: dict[str, Any],
) -> dict[str, Any] | None:
    if module == "biog_source" and col == "_source" and row.get("c_hyperlink"):
        return {"type": "external", "href": str(row["c_hyperlink"])}
    for link in schema.get("personLinkColumns", {}).get(module, []):
        if link.get("col") == col and row.get(link.get("idCol")):
            return {"type": "person", "id": int(row[link["idCol"]])}
    for link in schema.get("externalLinkColumns", {}).get(module, []):
        if link.get("col") == col and row.get(link.get("hrefCol")):
            return {"type": "external", "href": str(row[link["hrefCol"]])}
    for link in schema.get("entityLinkColumns", {}).get(module, []):
        if link.get("col") == col and row.get(link.get("idCol")):
            return {
                "type": "entity",
                "entityType": link.get("entityType"),
                "id": row[link["idCol"]],
            }
    return None


def build_display_cell(
    module: str,
    row: dict[str, Any],
    col: str,
    *,
    schema: dict[str, Any] | None = None,
    labels: dict[str, Any] | None = None,
) -> dict[str, Any]:
    schema = schema or load_export_schema()
    text = format_module_cell(module, row, col)
    cell: dict[str, Any] = {"text": text}
    link = _cell_link_meta(module, row, col, schema)
    if link:
        cell["link"] = link
    return cell


def build_basic_display(
    store: CbdbStore,
    person_id: int,
    *,
    labels: dict[str, Any] | None = None,
) -> dict[str, Any]:
    labels = labels or load_field_labels()
    schema = load_export_schema()
    person = store.get_person(person_id)
    if not person:
        raise ValueError("Person not found")

    canonical = person.get("_canonical_id") or person["c_personid"]
    altnames = store.module_rows_all("altname", canonical)

    rows: list[dict[str, Any]] = []
    idx = 1

    def add_row(label: str, value: Any) -> None:
        nonlocal idx
        display = value if value not in (None, "") else "—"
        rows.append({"index": idx, "label": label, "value": str(display)})
        idx += 1

    add_row(field_label("basic", "c_personid", labels), person.get("c_personid"))
    add_row("姓名", format_basic_person_name(person))

    for alt in altnames:
        label = str(alt.get("c_name_type_desc_chn") or "").strip()
        if not label:
            label = field_label("altname", "c_alt_name_chn", labels)
        add_row(label, format_altname_display(alt))

    add_row(field_label("basic", "c_dynasty_chn", labels), person.get("c_dynasty_chn"))
    add_row(field_label("basic", "c_index_addr_chn", labels), person.get("c_index_addr_chn"))
    add_row(field_label("basic", "c_choronym_desc_chn", labels), person.get("c_choronym_desc_chn"))
    add_row(field_label("basic", "c_birthyear", labels), format_basic_year_display(person, "birth"))
    add_row(field_label("basic", "c_deathyear", labels), format_basic_year_display(person, "death"))

    index_source = format_source_display(person, "basic")
    if index_source != "—":
        add_row("參考文獻", index_source)

    title = schema["moduleLabels"]["basic"]
    return {
        "module": "basic",
        "format": "display",
        "title": title,
        "layout": "kv",
        "headers": ["#", "欄位", "內容"],
        "rows": rows,
    }


def build_table_display(
    store: CbdbStore,
    person_id: int,
    module: str,
    *,
    limit: int = 80,
    offset: int = 0,
    all_rows: bool = False,
    labels: dict[str, Any] | None = None,
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    labels = labels or load_field_labels()
    schema = schema or load_export_schema()
    module = store.resolve_module_id(module)

    if all_rows:
        raw_rows = store.module_rows_all(module, person_id)
        total = len(raw_rows)
        page_rows = raw_rows
        offset = 0
        limit = total or limit
    else:
        page = store.module_rows(module, person_id, limit=limit, offset=offset)
        total = page["total"]
        page_rows = page["rows"]

    cols = visible_columns(module, schema)
    headers = ["#"] + [field_label(module, c, labels) for c in cols]

    display_rows: list[dict[str, Any]] = []
    for i, row in enumerate(page_rows):
        cells = [build_display_cell(module, row, c, schema=schema, labels=labels) for c in cols]
        display_rows.append({"index": offset + i + 1, "cells": cells})

    title = schema["moduleLabels"].get(module, module)
    return {
        "module": module,
        "format": "display",
        "title": title,
        "layout": "table",
        "headers": headers,
        "columns": cols,
        "rows": display_rows,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def export_filename(person: dict[str, Any], *, now: datetime | None = None) -> str:
    now = now or datetime.now()
    chn = compose_chinese_name(person) or str(person.get("c_name_chn") or "").strip()
    eng = str(person.get("c_name") or "").strip()
    if chn and eng and chn != eng:
        name_part = f"{chn}（{eng}）"
    else:
        name_part = chn or eng or str(person.get("c_personid", ""))
    name_part = re.sub(r'[\\/:*?"<>|]', "_", name_part).strip() or "未知"
    ts = f"{now.year}年{now.month}月{now.day}日{now.hour}:{now.minute:02d}:{now.second:02d}"
    return f"CBDB_人物_{name_part}_{ts}.xlsx"


def build_export_payload(store: CbdbStore, person_id: int) -> dict[str, Any]:
    person = store.get_person(person_id)
    if not person:
        raise ValueError("Person not found")

    labels = load_field_labels()
    schema = load_export_schema()
    sheets: list[dict[str, Any]] = []

    basic = build_basic_display(store, person_id, labels=labels)
    sheets.append(_sheet_from_display(basic))

    for module in schema["moduleOrder"]:
        if module == "basic":
            continue
        if module not in schema.get("moduleColumns", {}):
            continue
        display = build_table_display(
            store, person_id, module, all_rows=True, labels=labels, schema=schema
        )
        sheets.append(_sheet_from_display(display))

    return {
        "person_id": person.get("c_personid"),
        "filename": export_filename(person),
        "sheets": sheets,
    }


def _sheet_from_display(display: dict[str, Any]) -> dict[str, Any]:
    layout = display["layout"]
    title = display["title"]
    headers = display["headers"]
    if layout == "kv":
        rows = [[r["index"], r["label"], r["value"]] for r in display["rows"]]
    else:
        rows = []
        for r in display["rows"]:
            rows.append([r["index"]] + [c["text"] for c in r["cells"]])
    return {"title": title, "layout": layout, "headers": headers, "rows": rows}
