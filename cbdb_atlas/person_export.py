from __future__ import annotations

import io
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.utils import get_column_letter

from cbdb_atlas.store import CbdbStore

WEB_DIR = Path(__file__).resolve().parents[1] / "web"

HIDDEN_MODULE_COLS = {
    "c_kin_id",
    "c_node_id",
    "c_office_id",
    "c_addr_id",
    "c_index_addr_id",
    "c_textid",
    "c_inst_name_code",
    "c_event_code",
    "c_hyperlink",
}

MODULE_LABELS: dict[str, str] = {
    "basic": "基本資料",
    "altname": "別名",
    "entry": "入仕",
    "status": "社會身份",
    "posting": "任官",
    "posting_addr": "任官地點",
    "biog_address": "傳記地址",
    "people_addr": "索引地址",
    "kinship": "親屬",
    "association": "社會關係",
    "text_role": "著述",
    "biog_source": "資料出處",
    "institution": "社會機構",
    "institution_addr": "機構地址",
    "event": "生平事件",
    "event_addr": "事件地點",
    "possessions": "財產",
    "possessions_addr": "財產地點",
}

MODULE_COLUMNS: dict[str, list[str]] = {
    "altname": ["c_name_type_desc_chn", "c_alt_name_chn", "c_sequence", "_source"],
    "kinship": ["c_kinrel_chn", "c_kin_chn", "c_addr_chn", "_source"],
    "posting": ["c_office_chn", "c_firstyear", "c_lastyear", "c_dynasty_chn", "_source"],
    "posting_addr": ["c_office_addr_chn", "c_office_addr_name", "_source"],
    "entry": ["c_entry_desc_chn", "c_year", "c_exam_rank", "c_addr_chn", "_source"],
    "association": ["c_link_chn", "c_node_chn", "c_assoc_first_year", "c_occasion_desc_chn", "_source"],
    "biog_address": ["c_addr_desc_chn", "c_addr_chn", "c_firstyear", "c_lastyear", "_source"],
    "people_addr": ["c_index_addr_chn", "c_index_addr_type_chn", "c_index_year", "_source"],
    "text_role": ["c_title_chn", "c_role_desc_chn", "c_year", "_source"],
    "biog_source": ["c_title_chn", "c_title", "c_main_source", "_source"],
    "status": ["c_status_desc_chn", "c_firstyear", "c_lastyear", "_source"],
    "institution": ["c_inst_name_hz", "c_bi_role_chn", "c_bi_begin_year", "c_bi_end_year", "_source"],
    "institution_addr": ["c_inst_name_hz", "c_inst_addr_chn", "c_inst_addr_type_chn", "c_bi_begin_year", "_source"],
    "event": ["c_event_name_chn", "c_role", "c_year", "c_nianhao_chn", "_source"],
    "event_addr": ["c_event_name_chn", "c_event_addr_chn", "c_year", "_source"],
    "possessions": ["c_possession_act_desc_chn", "c_possession_desc_chn", "c_quantity", "c_possession_yr", "_source"],
    "possessions_addr": ["c_possession_desc_chn", "c_possession_addr_chn", "c_possession_yr", "_source"],
}

MODULE_ORDER = list(MODULE_LABELS.keys())

CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]


def _load_field_labels() -> dict[str, Any]:
    path = WEB_DIR / "field-labels.js"
    content = path.read_text(encoding="utf-8")
    marker = "window.CBDB_FIELD_LABELS = "
    start = content.index(marker) + len(marker)
    end = content.index(";\n", start)
    return json.loads(content[start:end])


def _field_label(module: str, key: str, labels: dict[str, Any]) -> str:
    if key == "_source":
        return "出處"
    modules = labels.get("modules", {})
    if key in modules.get(module, {}):
        return modules[module][key]
    by_column = labels.get("by_column", {})
    return by_column.get(key, key)


def _format_source_display(row: dict[str, Any], module: str = "") -> str:
    if module == "text_role":
        title_keys = ["c_source_chn", "c_source_title"]
    elif module == "biog_source":
        title_keys = ["c_title_chn", "c_title"]
    else:
        title_keys = ["c_source_chn", "c_source_title", "c_title_chn", "c_title"]
    title = ""
    for key in title_keys:
        val = row.get(key)
        if val is not None and str(val).strip():
            title = str(val).strip()
            break
    pages = row.get("c_pages")
    parts: list[str] = []
    if title:
        parts.append(title)
    if pages is not None and pages != "" and pages != 0:
        parts.append(f"頁{str(pages).strip()}")
    if not parts and row.get("c_source") not in (None, ""):
        parts.append(f"文獻 #{row['c_source']}")
    return " · ".join(parts) if parts else "—"


def _fmt_gregorian_year(y: Any) -> str:
    try:
        n = int(y)
    except (TypeError, ValueError):
        return ""
    if n == 0 or n == -1 or n == -9999:
        return ""
    if n < 0:
        return f"前{abs(n)}"
    return str(n)


def _valid_dynasty_label(s: Any) -> str:
    t = str(s or "").strip()
    if not t or t in ("未詳", "不详"):
        return ""
    return t


def _valid_nianhao_label(s: Any) -> str:
    t = str(s or "").strip()
    if not t or t in ("未詳", "不详"):
        return ""
    return t


def _to_chinese_year_number(n: Any) -> str:
    try:
        num = int(n)
    except (TypeError, ValueError):
        return ""
    if num <= 0:
        return ""
    if num < 10:
        return CN_DIGITS[num]
    if num == 10:
        return "十"
    if num < 20:
        return f"十{CN_DIGITS[num - 10]}"
    if num < 100:
        tens = num // 10
        ones = num % 10
        s = "十" if tens == 1 else f"{CN_DIGITS[tens]}十"
        if ones:
            s += CN_DIGITS[ones]
        return s
    if num < 1000:
        hundreds = num // 100
        rest = num % 100
        s = f"{CN_DIGITS[hundreds]}百"
        if rest == 0:
            return s
        if rest < 10:
            return f"{s}零{CN_DIGITS[rest]}"
        tens = rest // 10
        ones = rest % 10
        s += "十" if tens == 1 else f"{CN_DIGITS[tens]}十"
        if ones:
            s += CN_DIGITS[ones]
        return s
    return str(num)


def _fmt_reign_year(n: Any) -> str:
    try:
        num = int(n)
    except (TypeError, ValueError):
        return ""
    if num <= 0:
        return ""
    return "元年" if num == 1 else f"{_to_chinese_year_number(num)}年"


def _format_year_display(
    row: dict[str, Any],
    *,
    greg_key: str,
    nh_key: str,
    nh_year_key: str,
    range_key: str,
    dynasty_key: str = "c_dynasty_chn",
) -> str:
    dynasty = _valid_dynasty_label(row.get(dynasty_key))
    nh = _valid_nianhao_label(row.get(nh_key))
    nh_year = _fmt_reign_year(row.get(nh_year_key))
    range_ = str(row.get(range_key) or "").strip()
    greg = _fmt_gregorian_year(row.get(greg_key))

    nianhao = nh
    if nh and nh_year:
        nianhao = nh + nh_year
    elif nh_year and not nh:
        nianhao = nh_year
    if nianhao and range_:
        nianhao += range_

    prefix = dynasty
    text = ""
    if prefix and nianhao:
        text = prefix + nianhao
    elif prefix:
        text = prefix
    elif nianhao:
        text = nianhao

    if greg:
        text += f"（{greg}）"
    if text:
        return text
    try:
        raw = int(row.get(greg_key))
    except (TypeError, ValueError):
        return "—"
    if raw > 0:
        return str(raw)
    return "—"


def _format_basic_person_name(person: dict[str, Any]) -> str:
    chn = str(person.get("c_name_chn") or "").strip()
    name = str(person.get("c_name") or "").strip()
    if chn and name and chn != name:
        return f"{chn}（{name}）"
    return chn or name or "—"


def _basic_rows(person: dict[str, Any], labels: dict[str, Any]) -> list[tuple[str, Any]]:
    fl = lambda key: _field_label("basic", key, labels)
    rows: list[tuple[str, Any]] = [
        (fl("c_personid"), person.get("c_personid")),
        ("姓名", _format_basic_person_name(person)),
        (fl("c_birthyear"), _format_year_display(person, greg_key="c_birthyear", nh_key="c_by_nh_chn", nh_year_key="c_by_nh_year", range_key="c_by_range_chn")),
        (fl("c_deathyear"), _format_year_display(person, greg_key="c_deathyear", nh_key="c_dy_nh_chn", nh_year_key="c_dy_nh_year", range_key="c_dy_range_chn")),
        (fl("c_dynasty_chn"), person.get("c_dynasty_chn")),
        (fl("c_index_year"), person.get("c_index_year")),
        (fl("c_index_addr_chn"), person.get("c_index_addr_chn")),
        (fl("c_choronym_desc_chn"), person.get("c_choronym_desc_chn")),
        (fl("c_ethnicity_desc_chn"), person.get("c_ethnicity_desc_chn")),
    ]
    index_source = _format_source_display(person, "basic")
    if index_source != "—":
        rows.append(("出處", index_source))
    return rows


def _cell_value(module: str, row: dict[str, Any], col: str) -> Any:
    if col == "_source":
        return _format_source_display(row, module)
    if module == "entry" and col == "c_year":
        return _format_year_display(
            row,
            greg_key="c_year",
            nh_key="c_nianhao_chn",
            nh_year_key="c_entry_nh_year",
            range_key="c_range_chn",
        )
    if module == "association" and col == "c_assoc_first_year":
        return _format_year_display(
            row,
            greg_key="c_assoc_first_year",
            nh_key="c_assoc_fy_nh_chn",
            nh_year_key="c_assoc_fy_nh_year",
            range_key="c_range_chn",
        )
    val = row.get(col)
    if val is None or val == "":
        return "—"
    return val


def _sanitize_filename_part(text: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", text).strip() or "未知"


def export_filename(person: dict[str, Any], *, now: datetime | None = None) -> str:
    now = now or datetime.now()
    chn = str(person.get("c_name_chn") or "").strip()
    eng = str(person.get("c_name") or "").strip()
    if chn and eng and chn != eng:
        name_part = f"{chn}（{eng}）"
    else:
        name_part = chn or eng or str(person.get("c_personid", ""))
    name_part = _sanitize_filename_part(name_part)
    ts = f"{now.year}年{now.month}月{now.day}日{now.hour}:{now.minute:02d}:{now.second:02d}"
    return f"CDBD数据库_人物_{name_part}_{ts}.xlsx"


def _autosize_columns(ws) -> None:
    for col_idx, column_cells in enumerate(ws.columns, start=1):
        width = 10
        for cell in column_cells:
            if cell.value is None:
                continue
            width = max(width, min(len(str(cell.value)) + 2, 48))
        ws.column_dimensions[get_column_letter(col_idx)].width = width


def build_person_workbook(store: CbdbStore, person_id: int) -> tuple[bytes, str]:
    person = store.get_person(person_id)
    if not person:
        raise ValueError("Person not found")

    labels = _load_field_labels()
    wb = Workbook()
    wb.remove(wb.active)

    basic_ws = wb.create_sheet(MODULE_LABELS["basic"])
    basic_ws.append(["#", "欄位", "內容"])
    for i, (label, value) in enumerate(_basic_rows(person, labels), start=1):
        basic_ws.append([i, label, value if value not in (None, "") else "—"])
    _autosize_columns(basic_ws)

    for module in MODULE_ORDER[1:]:
        if module not in MODULE_COLUMNS:
            continue
        cols = [c for c in MODULE_COLUMNS[module] if c not in HIDDEN_MODULE_COLS]
        rows = store.module_rows_all(module, person_id)
        ws = wb.create_sheet(MODULE_LABELS[module][:31])
        headers = ["#"] + [_field_label(module, c, labels) for c in cols]
        ws.append(headers)
        for i, row in enumerate(rows, start=1):
            ws.append([i] + [_cell_value(module, row, c) for c in cols])
        _autosize_columns(ws)

    buf = io.BytesIO()
    wb.save(buf)
    filename = export_filename(person)
    return buf.getvalue(), filename
