/**
 * CBDB Atlas — rare / variant Han character display helpers.
 * Pair with web/fonts/ (CBDB UniFonts) and --font-han in styles.css.
 */
(function (global) {
  const INVALID_LABELS = new Set(["未詳", "不详", "未知"]);

  function isInvalidLabel(value) {
    const text = String(value ?? "").trim();
    return !text || INVALID_LABELS.has(text);
  }

  function escapeHanText(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** True when code point is outside common CJK (needs extension font). */
  function isRareHanChar(ch) {
    const cp = ch.codePointAt(0);
    return cp > 0x9FFF && !(cp >= 0xf900 && cp <= 0xfaff);
  }

  function hasRareHan(text) {
    return Array.from(String(text ?? "")).some(isRareHanChar);
  }

  function pickChinesePart(...values) {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (!isInvalidLabel(text)) return text;
    }
    return "";
  }

  /**
   * Build the fullest Chinese name available from CBDB name fields.
   */
  function composeChineseName(row) {
    if (!row) return "";
    const nameChn = pickChinesePart(row.c_name_chn);
    const surname = pickChinesePart(row.c_surname_chn, row.c_surname_proper);
    const mingzi = pickChinesePart(row.c_mingzi_chn, row.c_mingzi_proper);
    const composed = surname && mingzi ? surname + mingzi : "";

    if (composed) {
      if (!nameChn || nameChn === surname || nameChn.length < composed.length) {
        return composed;
      }
    }
    if (nameChn) return nameChn;
    if (composed) return composed;
    return surname || mingzi || "";
  }

  function formatPersonDisplayName(row, opts = {}) {
    const chn = composeChineseName(row);
    const roman = String(row?.c_name ?? "").trim();
    if (!chn) return roman || "—";
    if (opts.includeRoman && roman && chn !== roman && !roman.startsWith(chn)) {
      return `${chn}（${roman}）`;
    }
    return chn;
  }

  function personNameTitle(row) {
    const chn = composeChineseName(row);
    const roman = String(row?.c_name ?? "").trim();
    if (!roman || roman === chn) return "";
    if (!chn || (chn.length <= 1 && roman.includes(" "))) return roman;
    if (hasRareHan(chn) && roman) return roman;
    return "";
  }

  function hanFontFamily() {
    return 'CBDBHanFont, "Noto Serif TC", "Noto Serif SC", "SimSun-ExtB", "SimSun", serif';
  }

  global.CBDBHanzi = {
    composeChineseName,
    formatPersonDisplayName,
    personNameTitle,
    escapeHanText,
    hasRareHan,
    isRareHanChar,
    hanFontFamily,
  };
})(typeof window !== "undefined" ? window : globalThis);
