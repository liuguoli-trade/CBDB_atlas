"""Simplified → Traditional Chinese for search (OpenCC s2t)."""

from __future__ import annotations

from functools import lru_cache


@lru_cache(maxsize=1)
def _converter():
    import opencc

    return opencc.OpenCC("s2t")


def to_traditional_cn(text: str) -> str:
    if not text:
        return text
    try:
        return _converter().convert(text)
    except Exception:
        return text


def normalize_search_query(text: str | None) -> str | None:
    """Normalize user search text: simplified Chinese → traditional; other text unchanged."""
    if text is None:
        return None
    s = text.strip()
    if not s:
        return s
    return to_traditional_cn(s)
