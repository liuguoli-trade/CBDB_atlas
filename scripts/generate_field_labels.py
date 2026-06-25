#!/usr/bin/env python3
"""Generate web/field-labels.js from CBDB Codebook (xlsx)."""

from __future__ import annotations

import glob
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MONO_ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "field-labels.js"

sys.path.insert(0, str(MONO_ROOT / "scripts"))
from hanzi_traditional import to_traditional_cn  # noqa: E402

# UI column -> (codebook sheet, column_code)
MODULE_FIELDS: dict[str, dict[str, tuple[str, str]]] = {
    "basic": {
        "c_personid": ("BIOG_MAIN", "c_personid"),
        "c_name_chn": ("BIOG_MAIN", "c_name_chn"),
        "c_name": ("BIOG_MAIN", "c_name"),
        "c_birthyear": ("BIOG_MAIN", "c_birthyear"),
        "c_deathyear": ("BIOG_MAIN", "c_deathyear"),
        "c_dynasty_chn": ("DYNASTIES", "c_dynasty_chn"),
        "c_index_year": ("BIOG_MAIN", "c_index_year"),
        "c_index_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_choronym_desc_chn": ("CHORONYM_CODES", "c_choronym_chn"),
        "c_ethnicity_desc_chn": ("ETHNICITY_TRIBE_CODES", "c_name_chn"),
        "c_notes": ("BIOG_MAIN", "c_notes"),
    },
    "search": {
        "c_name_chn": ("BIOG_MAIN", "c_name_chn"),
        "c_name": ("BIOG_MAIN", "c_name"),
        "c_birthyear": ("BIOG_MAIN", "c_birthyear"),
        "c_deathyear": ("BIOG_MAIN", "c_deathyear"),
        "c_dynasty_chn": ("DYNASTIES", "c_dynasty_chn"),
        "c_index_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_personid": ("BIOG_MAIN", "c_personid"),
        "c_addr_id": ("ADDR_CODES", "c_addr_id"),
        "c_firstyear": ("ADDR_CODES", "c_firstyear"),
        "c_lastyear": ("ADDR_CODES", "c_lastyear"),
        "c_admin_type": ("ADDR_CODES", "c_admin_type"),
        "c_office_id": ("OFFICE_CODES", "c_office_id"),
        "c_office_chn": ("OFFICE_CODES", "c_office_chn"),
        "c_office_pinyin": ("OFFICE_CODES", "c_office_pinyin"),
        "c_office_trans": ("OFFICE_CODES", "c_office_trans"),
        "c_textid": ("TEXT_CODES", "c_textid"),
        "c_title_chn": ("TEXT_CODES", "c_title_chn"),
        "c_title": ("TEXT_CODES", "c_title"),
        "c_title_trans": ("TEXT_CODES", "c_title_trans"),
        "c_text_year": ("TEXT_CODES", "c_text_year"),
        "c_inst_name_code": ("SOCIAL_INSTITUTION_NAME_CODES", "c_inst_name_code"),
        "c_inst_name_hz": ("SOCIAL_INSTITUTION_NAME_CODES", "c_inst_name_hz"),
        "c_inst_name_py": ("SOCIAL_INSTITUTION_NAME_CODES", "c_inst_name_py"),
        "c_event_code": ("EVENT_CODES", "c_event_code"),
        "c_event_name_chn": ("EVENT_CODES", "c_event_name_chn"),
        "c_event_name": ("EVENT_CODES", "c_event_name"),
        "c_fy_yr": ("EVENT_CODES", "c_fy_yr"),
        "c_ly_yr": ("EVENT_CODES", "c_ly_yr"),
    },
    "altname": {
        "c_alt_name_chn": ("ALTNAME_DATA", "c_alt_name_chn"),
        "c_name_type_desc_chn": ("ALTNAME_CODES", "c_name_type_desc_chn"),
        "c_sequence": ("ASSOC_DATA", "c_sequence"),
    },
    "kinship": {
        "c_kinrel_chn": ("KINSHIP_CODES", "c_kinrel_chn"),
        "c_kin_chn": ("BIOG_MAIN", "c_name_chn"),
        "c_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_pages": ("KIN_DATA", "c_pages"),
    },
    "posting": {
        "c_office_chn": ("OFFICE_CODES", "c_office_chn"),
        "c_firstyear": ("POSTED_TO_OFFICE_DATA", "c_firstyear"),
        "c_lastyear": ("POSTED_TO_OFFICE_DATA", "c_lastyear"),
        "c_dynasty_chn": ("DYNASTIES", "c_dynasty_chn"),
    },
    "posting_addr": {
        "c_office_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_office_addr_name": ("ADDR_CODES", "c_name"),
    },
    "entry": {
        "c_entry_desc_chn": ("ENTRY_CODES", "c_entry_desc_chn"),
        "c_year": ("ENTRY_DATA", "c_year"),
        "c_exam_rank": ("ENTRY_DATA", "c_exam_rank"),
        "c_addr_chn": ("ADDR_CODES", "c_name_chn"),
    },
    "association": {
        "c_link_chn": ("ASSOC_CODES", "c_assoc_desc_chn"),
        "c_node_chn": ("BIOG_MAIN", "c_name_chn"),
        "c_assoc_first_year": ("ASSOC_DATA", "c_assoc_first_year"),
        "c_occasion_desc_chn": ("OCCASION_CODES", "c_occasion_desc_chn"),
    },
    "biog_address": {
        "c_addr_desc_chn": ("BIOG_ADDR_CODES", "c_addr_desc_chn"),
        "c_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_firstyear": ("BIOG_ADDR_DATA", "c_firstyear"),
        "c_lastyear": ("BIOG_ADDR_DATA", "c_lastyear"),
    },
    "text_role": {
        "c_title_chn": ("TEXT_CODES", "c_title_chn"),
        "c_role_desc_chn": ("TEXT_ROLE_CODES", "c_role_desc_chn"),
        "c_year": ("TEXT_DATA", "c_year"),
        "c_pages": ("TEXT_DATA", "c_pages"),
    },
    "status": {
        "c_status_desc_chn": ("STATUS_CODES", "c_status_desc_chn"),
        "c_firstyear": ("STATUS_DATA", "c_firstyear"),
        "c_lastyear": ("STATUS_DATA", "c_lastyear"),
    },
    "institution": {
        "c_inst_name_hz": ("SOCIAL_INSTITUTION_NAME_CODES", "c_inst_name_hz"),
        "c_bi_role_chn": ("BIOG_INST_CODES", "c_bi_role_chn"),
        "c_bi_begin_year": ("BIOG_INST_DATA", "c_bi_begin_year"),
        "c_bi_end_year": ("BIOG_INST_DATA", "c_bi_end_year"),
    },
    "institution_addr": {
        "c_inst_name_hz": ("SOCIAL_INSTITUTION_NAME_CODES", "c_inst_name_hz"),
        "c_inst_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_inst_addr_type_chn": ("SOCIAL_INSTITUTION_ADDR_TYPES", "c_inst_addr_type_chn"),
        "c_bi_begin_year": ("BIOG_INST_DATA", "c_bi_begin_year"),
        "c_bi_end_year": ("BIOG_INST_DATA", "c_bi_end_year"),
    },
    "biog_source": {
        "c_title_chn": ("TEXT_CODES", "c_title_chn"),
        "c_title": ("TEXT_CODES", "c_title"),
        "c_pages": ("BIOG_SOURCE_DATA", "c_pages"),
        "c_main_source": ("BIOG_SOURCE_DATA", "c_main_source"),
    },
    "event": {
        "c_event_name_chn": ("EVENT_CODES", "c_event_name_chn"),
        "c_role": ("EVENTS_DATA", "c_role"),
        "c_year": ("EVENTS_DATA", "c_year"),
        "c_nianhao_chn": ("NIAN_HAO", "c_nianhao_chn"),
    },
    "event_addr": {
        "c_event_name_chn": ("EVENT_CODES", "c_event_name_chn"),
        "c_event_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_year": ("EVENTS_DATA", "c_year"),
    },
    "people_addr": {
        "c_index_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_index_addr_type_chn": ("BIOG_ADDR_CODES", "c_addr_desc_chn"),
        "c_index_year": ("BIOG_MAIN", "c_index_year"),
    },
    "possessions": {
        "c_possession_act_desc_chn": ("POSSESSION_ACT_CODES", "c_possession_act_desc_chn"),
        "c_possession_desc_chn": ("POSSESSION_DATA", "c_possession_desc_chn"),
        "c_quantity": ("POSSESSION_DATA", "c_quantity"),
        "c_possession_yr": ("POSSESSION_DATA", "c_possession_yr"),
    },
    "possessions_addr": {
        "c_possession_desc_chn": ("POSSESSION_DATA", "c_possession_desc_chn"),
        "c_possession_addr_chn": ("ADDR_CODES", "c_name_chn"),
        "c_possession_yr": ("POSSESSION_DATA", "c_possession_yr"),
    },
}


def has_cjk(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def pick_label(meaning_cn: object, meaning_en: object) -> str:
    cn = str(meaning_cn or "").strip()
    en = str(meaning_en or "").strip()
    if cn and has_cjk(cn):
        return cn
    if en and has_cjk(en):
        return en
    return cn or en


def load_codebook(path: Path) -> dict[tuple[str, str], str]:
    """Parse Codebook xlsx with stdlib only (no openpyxl / heavy deps)."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

    def col_index(cell_ref: str) -> int:
        letters = "".join(ch for ch in cell_ref if ch.isalpha())
        n = 0
        for ch in letters.upper():
            n = n * 26 + (ord(ch) - 64)
        return n - 1

    def cell_text(cell, shared: list[str]) -> str:
        cell_type = cell.get("t")
        value = cell.find("m:v", ns)
        if value is None or value.text is None:
            return ""
        raw = value.text
        if cell_type == "s":
            return shared[int(raw)]
        return raw

    def row_values(row, shared: list[str]) -> list[str]:
        cells = row.findall("m:c", ns)
        if not cells:
            return []
        indexed: dict[int, str] = {}
        for cell in cells:
            ref = cell.get("r", "")
            idx = col_index(ref) if ref else len(indexed)
            indexed[idx] = cell_text(cell, shared)
        width = max(indexed) + 1
        return [indexed.get(i, "") for i in range(width)]

    labels: dict[tuple[str, str], str] = {}
    with zipfile.ZipFile(path) as archive:
        shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        shared: list[str] = []
        for item in shared_root.findall("m:si", ns):
            text = item.find("m:t", ns)
            if text is not None and text.text is not None:
                shared.append(text.text)
            else:
                parts = [part.text or "" for part in item.findall(".//m:t", ns)]
                shared.append("".join(parts))

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_map = {rel.get("Id"): rel.get("Target") for rel in rels}

        for sheet in workbook.findall("m:sheets/m:sheet", ns):
            sheet_name = sheet.get("name") or ""
            target = rel_map.get(sheet.get(rel_ns + "id") or "")
            if not target:
                continue
            sheet_path = "xl/" + target.lstrip("/")
            worksheet = ET.fromstring(archive.read(sheet_path))
            rows = worksheet.findall("m:sheetData/m:row", ns)
            if not rows:
                continue
            header = row_values(rows[0], shared)
            if not header or header[0] != "column_code":
                continue
            for row in rows[1:]:
                values = row_values(row, shared)
                if not values or not values[0]:
                    continue
                col = str(values[0]).strip()
                meaning_cn = values[1] if len(values) > 1 else ""
                meaning_en = values[2] if len(values) > 2 else ""
                labels[(sheet_name, col)] = pick_label(meaning_cn, meaning_en)
    return labels


def find_codebook() -> Path:
    downloads = Path.home() / "Downloads"
    candidates = [
        ROOT / "data" / "CBDB_Codebook.xlsx",
        downloads / "CBDB 逐表逐欄位介紹( CBDB Codebook).xlsx",
        *glob.glob(str(downloads / "*Codebook*.xlsx")),
    ]
    for c in candidates:
        p = Path(c)
        if p.is_file():
            return p
    raise FileNotFoundError("CBDB Codebook xlsx not found")


def main() -> int:
    codebook = find_codebook()
    labels = load_codebook(codebook)

    modules: dict[str, dict[str, str]] = {}
    missing: list[str] = []
    for module, fields in MODULE_FIELDS.items():
        modules[module] = {}
        for field, (sheet, col) in fields.items():
            key = (sheet, col)
            if key not in labels:
                missing.append(f"{module}.{field} -> {sheet}.{col}")
                modules[module][field] = field
            else:
                modules[module][field] = to_traditional_cn(labels[key])

    by_column: dict[str, str] = {}
    for (_sheet, col), label in labels.items():
        if col not in by_column and label:
            by_column[col] = to_traditional_cn(label)

    payload = {
        "source": codebook.name,
        "modules": modules,
        "by_column": by_column,
    }
    OUT.write_text(
        "/* Auto-generated by scripts/generate_field_labels.py — do not edit */\n"
        f"window.CBDB_FIELD_LABELS = {json.dumps(payload, ensure_ascii=False, indent=2)};\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT} ({len(missing)} missing)")
    for m in missing:
        print("  missing:", m)
    return 0 if not missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
