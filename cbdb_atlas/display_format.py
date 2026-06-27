"""Display formatting for person modules (shared by API display export and Excel)."""

from __future__ import annotations

from typing import Any

INVALID_LABELS = frozenset({"未詳", "不详", "未知"})
CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]


def _pick_chinese_part(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text and text not in INVALID_LABELS:
            return text
    return ""


def compose_chinese_name(row: dict[str, Any] | None) -> str:
    if not row:
        return ""
    name_chn = _pick_chinese_part(row.get("c_name_chn"))
    surname = _pick_chinese_part(row.get("c_surname_chn"), row.get("c_surname_proper"))
    mingzi = _pick_chinese_part(row.get("c_mingzi_chn"), row.get("c_mingzi_proper"))
    composed = surname + mingzi if surname and mingzi else ""

    if composed:
        if not name_chn or name_chn == surname or len(name_chn) < len(composed):
            return composed
    if name_chn:
        return name_chn
    if composed:
        return composed
    return surname or mingzi or ""


def format_basic_person_name(person: dict[str, Any]) -> str:
    chn = compose_chinese_name(person)
    name = str(person.get("c_name") or "").strip()
    if chn and name and chn != name:
        return f"{chn}（{name}）"
    return chn or name or "—"


def format_altname_display(row: dict[str, Any]) -> str:
    return str(row.get("c_alt_name_chn") or row.get("c_alt_name") or "").strip() or "—"


def _fmt_gregorian_year(y: Any) -> str:
    try:
        n = int(y)
    except (TypeError, ValueError):
        return ""
    if n in (0, -1, -9999):
        return ""
    if n < 0:
        return f"前{abs(n)}"
    return str(n)


def _valid_dynasty_label(s: Any) -> str:
    t = str(s or "").strip()
    if not t or t in INVALID_LABELS:
        return ""
    return t


def _valid_nianhao_label(s: Any) -> str:
    t = str(s or "").strip()
    if not t or t in INVALID_LABELS:
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


def format_year_display(
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


def format_basic_year_display(person: dict[str, Any], kind: str) -> str:
    is_birth = kind == "birth"
    prefix = "by" if is_birth else "dy"
    return format_year_display(
        person,
        greg_key="c_birthyear" if is_birth else "c_deathyear",
        nh_key=f"c_{prefix}_nh_chn",
        nh_year_key=f"c_{prefix}_nh_year",
        range_key=f"c_{prefix}_range_chn",
        dynasty_key="c_by_dynasty_chn" if is_birth else "c_dy_nh_dynasty_chn",
    )


def format_source_display(row: dict[str, Any], module: str = "") -> str:
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


def format_module_cell(module: str, row: dict[str, Any], col: str) -> str:
    if col == "_source":
        return format_source_display(row, module)
    if module == "entry" and col == "c_year":
        return format_year_display(
            row,
            greg_key="c_year",
            nh_key="c_nianhao_chn",
            nh_year_key="c_entry_nh_year",
            range_key="c_range_chn",
        )
    if module == "association" and col == "c_assoc_first_year":
        return format_year_display(
            row,
            greg_key="c_assoc_first_year",
            nh_key="c_assoc_fy_nh_chn",
            nh_year_key="c_assoc_fy_nh_year",
            range_key="c_range_chn",
        )
    if module == "posting" and col == "c_firstyear":
        return format_year_display(
            row,
            greg_key="c_firstyear",
            nh_key="c_fy_nh_chn",
            nh_year_key="c_fy_nh_year",
            range_key="c_fy_range_chn",
        )
    if module == "posting" and col == "c_lastyear":
        return format_year_display(
            row,
            greg_key="c_lastyear",
            nh_key="c_ly_nh_chn",
            nh_year_key="c_ly_nh_year",
            range_key="c_ly_range_chn",
        )
    val = row.get(col)
    if val is None or val == "":
        return "—"
    return str(val)
