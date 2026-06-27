"""Classify kinship / association rows for graph edge category filters."""

from __future__ import annotations

import re
import sqlite3
from typing import Any

KIN_CATEGORY_CORE = "core"
KIN_CATEGORY_EXTENDED = "extended"

ASSOC_CATEGORY_POLITICAL = "political"
ASSOC_CATEGORY_SCHOLARLY = "scholarly"
ASSOC_CATEGORY_LITERARY = "literary"
ASSOC_CATEGORY_OTHER = "other"

ASSOC_CATEGORY_PRIORITY = {
    ASSOC_CATEGORY_POLITICAL: 0,
    ASSOC_CATEGORY_SCHOLARLY: 1,
    ASSOC_CATEGORY_LITERARY: 2,
    ASSOC_CATEGORY_OTHER: 3,
}

LITERARY_ASSOC_TYPE = "0207"
POLITICAL_ROOTS = frozenset({"04", "06"})
SCHOLARLY_ROOT = "02"
FRIEND_ROOT = "03"
LITERARY_ROOT = "05"
OTHER_ROOTS = frozenset({"01", "07", "08", "09", "10"})

_ADOPTION_RE = re.compile(r"過繼|过继|養子|养子|嗣子|出嗣|繼子|继子|義子|义子")
_SIBLING_RE = re.compile(r"兄|弟|姊|妹|兄弟|姐妹|同母|同父|連襟|连襟")
_SPOUSE_CORE_RE = re.compile(r"夫(?!君)|妻|配偶|室|继室|繼室|正室|側室|侧室|原配|再室|嫡妻|正妻")


def _int_field(row: dict[str, Any], key: str) -> int:
    try:
        return int(row.get(key) or 0)
    except (TypeError, ValueError):
        return 0


def _kin_label(row: dict[str, Any]) -> str:
    return str(row.get("c_kinrel_chn") or row.get("c_kinrel") or "").strip()


def classify_kinship(row: dict[str, Any]) -> str:
    """Return ``core`` (直系×家庭) or ``extended`` (姻亲×旁系)."""
    label = _kin_label(row)
    if label and _ADOPTION_RE.search(label):
        return KIN_CATEGORY_CORE

    up = _int_field(row, "c_upstep")
    dwn = _int_field(row, "c_dwnstep")
    col = _int_field(row, "c_colstep")
    mar = _int_field(row, "c_marstep")

    if up > 0 or dwn > 0:
        return KIN_CATEGORY_CORE

    if mar > 0:
        if label and _SPOUSE_CORE_RE.search(label):
            return KIN_CATEGORY_CORE
        return KIN_CATEGORY_EXTENDED

    if col > 0:
        if label and _SIBLING_RE.search(label):
            return KIN_CATEGORY_CORE
        return KIN_CATEGORY_EXTENDED

    return KIN_CATEGORY_EXTENDED


def _root_type_code(type_code: str, parent_map: dict[str, str | None]) -> str:
    code = str(type_code or "").strip()
    if not code:
        return ""
    seen: set[str] = set()
    while True:
        parent = parent_map.get(code)
        if parent is None or str(parent).strip() in {"", "0"}:
            return code
        if code in seen:
            return code
        seen.add(code)
        code = str(parent).strip()


def classify_assoc_type_code(type_code: str, parent_map: dict[str, str | None]) -> str:
    code = str(type_code or "").strip()
    if not code:
        return ASSOC_CATEGORY_OTHER
    if code == LITERARY_ASSOC_TYPE:
        return ASSOC_CATEGORY_LITERARY
    root = _root_type_code(code, parent_map)
    if root in POLITICAL_ROOTS:
        return ASSOC_CATEGORY_POLITICAL
    if root == LITERARY_ROOT:
        return ASSOC_CATEGORY_LITERARY
    if root == FRIEND_ROOT:
        return ASSOC_CATEGORY_SCHOLARLY
    if root == SCHOLARLY_ROOT:
        return ASSOC_CATEGORY_SCHOLARLY
    if root in OTHER_ROOTS:
        return ASSOC_CATEGORY_OTHER
    return ASSOC_CATEGORY_OTHER


def infer_assoc_category_from_row(row: dict[str, Any]) -> str:
    if row.get("c_litgenre_desc_chn") or row.get("c_text_title"):
        return ASSOC_CATEGORY_LITERARY
    if row.get("c_topic_desc_chn"):
        return ASSOC_CATEGORY_SCHOLARLY
    return ASSOC_CATEGORY_OTHER


class AssocCategoryResolver:
    """Resolve association link codes to UI categories via ASSOC_TYPES."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._link_types: dict[int, list[str]] = {}
        self._parent_map: dict[str, str | None] = {}
        self._load(conn)

    def _load(self, conn: sqlite3.Connection) -> None:
        try:
            for row in conn.execute(
                "SELECT c_assoc_type_code, c_assoc_type_parent_id FROM ASSOC_TYPES"
            ):
                self._parent_map[str(row[0])] = (
                    None if row[1] is None else str(row[1]).strip()
                )
        except sqlite3.Error:
            self._parent_map = {}

        try:
            for row in conn.execute(
                "SELECT c_assoc_code, c_assoc_type_code FROM ASSOC_CODE_TYPE_REL"
            ):
                code = int(row[0])
                type_code = str(row[1]).strip()
                self._link_types.setdefault(code, []).append(type_code)
        except sqlite3.Error:
            self._link_types = {}

    def categories_for_link(self, link_code: int) -> list[str]:
        type_codes = self._link_types.get(int(link_code or 0), [])
        if not type_codes:
            return []
        cats = {
            classify_assoc_type_code(type_code, self._parent_map)
            for type_code in type_codes
        }
        return sorted(cats, key=lambda c: ASSOC_CATEGORY_PRIORITY[c])

    def classify(self, row: dict[str, Any]) -> str:
        link_code = int(row.get("c_link_code") or 0)
        cats = self.categories_for_link(link_code)
        if cats:
            return cats[0]
        return infer_assoc_category_from_row(row)


KIN_CATEGORY_LABELS = {
    KIN_CATEGORY_CORE: "直系×家庭",
    KIN_CATEGORY_EXTENDED: "姻親×旁系",
}

ASSOC_CATEGORY_LABELS = {
    ASSOC_CATEGORY_POLITICAL: "官場政治",
    ASSOC_CATEGORY_SCHOLARLY: "師友學術",
    ASSOC_CATEGORY_LITERARY: "文學書寫",
    ASSOC_CATEGORY_OTHER: "其他社會",
}
