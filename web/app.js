const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const PAGE_SIZE_STORAGE_KEY = "cbdbPageSize";
const HOME_SEEN_KEY = "cbdbHomeSeen";

const SEARCH_EMPTY_HINTS = {
  person: "輸入姓名、拼音、別名或人物編號開始檢索",
  place: "輸入地名、拼音或地址編號，例如「長安」",
  text: "輸入文獻題名、拼音或文獻編號",
  office: "輸入官職名、拼音或官職編號",
};

function loadPageSize() {
  const stored = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
  return PAGE_SIZE_OPTIONS.includes(stored) ? stored : PAGE_SIZE_OPTIONS[0];
}

let pageSize = loadPageSize();

let selectedPersonId = null;
let openPersonSeq = 0;
let searchAbort = null;
const PERSON_CACHE_TTL_MS = 30000;
const MODULE_COUNTS_CACHE_TTL_MS = 600000;
const SEARCH_DEBOUNCE_MS = 300;
const personCache = new Map();
const moduleCountsCache = new Map();
const relationsGraphDataCache = new Map();
const RELATIONS_GRAPH_CACHE_TTL_MS = 900000;
let relationsGraphPrefetchCtrl = null;
let graphLibsPromise = null;
let searchOffset = 0;
let searchTotal = 0;
let searchHasMore = false;
let searchDebounceTimer = null;
let searchSession = 0;
let moduleId = "basic";
let moduleOffset = 0;
let moduleTotal = 0;
let moduleCounts = {};
let relationsTab = "kinship";
const relationsOffsets = { kinship: 0, association: 0 };
let relationsGraphKind = "all";
let relationsGraphSteps = 1;
let relationsGraphShowEdgeLabels = false;
let relationsGraphCategoryFilters = globalThis.GraphEdgeSchema
  ? globalThis.GraphEdgeSchema.fullCategoryFilters()
  : {
    kin: { core: true, extended: true },
    assoc: { political: true, scholarly: true, literary: true, other: true },
  };
let relationsGraphCenter = null;
let relationsGraphLoadSeq = 0;
let relationsGraphAbort = null;
let currentSearchType = "person";
let entityContext = null;
let entityOffset = 0;
let entityTotal = 0;

const NAV_STACK_MAX = 20;
let navStack = [];
let navRestoring = false;
let currentPersonName = null;
let currentPersonExportName = null;
let lastSearchData = null;
let lastSearchQuery = "";
let lastSearchFingerprint = "";
let searchAdvancedOpen = false;
let advancedScrollCollapsePausedUntil = 0;
let lastSearchScrollY = 0;

function pauseAdvancedScrollCollapse(ms = 480) {
  advancedScrollCollapsePausedUntil = Date.now() + ms;
  lastSearchScrollY = window.scrollY;
}

const PRIMARY_NAV_MODULES = [
  ["basic", "基本資料", null],
  ["entry", "入仕", "entry"],
  ["status", "社會身份", "status"],
  ["posting", "任官", "posting"],
  ["biog_address", "傳記地址", "biog_address"],
  ["relations", "人物關係", "relations"],
  ["text_role", "著述", "text_role"],
  ["biog_source", "資料出處", "biog_source"],
  ["institution", "社會機構", "institution"],
  ["event", "生平事件", "event"],
  ["possessions", "財產", "possessions"],
];

const ADVANCED_FILTER_IDS = [
  "dynastyFilter", "birthMin", "deathMax",
  "femaleFilter", "indexAddrFilter",
  "advYearMin", "advYearMax", "advDynastyFilter", "advancedMode",
];

const PLACE_ADVANCED_FILTER_IDS = [
  "placeDynastyFilter", "placeFirstYear", "placeLastYear",
];

const TEXT_ADVANCED_FILTER_IDS = [
  "textRelatedPersonFilter", "textDynastyFilter",
];

function advancedFilterIdsForType(type = document.getElementById("searchTypeFilter")?.value) {
  if (type === "person") return ADVANCED_FILTER_IDS;
  if (type === "place") return PLACE_ADVANCED_FILTER_IDS;
  if (type === "text") return TEXT_ADVANCED_FILTER_IDS;
  return [];
}

function countActiveAdvancedFilters() {
  const ids = advancedFilterIdsForType();
  if (!ids.length) return 0;
  let count = 0;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const value = String(el.value ?? "").trim();
    if (value !== "") count += 1;
  }
  return count;
}

function hasActiveAdvancedFilters() {
  return countActiveAdvancedFilters() > 0;
}

function isAdvancedSearchActive() {
  return hasActiveAdvancedFilters();
}

function syncExpandPanel(panel, open) {
  if (!panel) return;
  panel.classList.toggle("is-open", open);
  panel.classList.toggle("is-collapsed", !open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
}

function updateExpandToggleButton(btn, { open, labelOpen, labelClosed, badgeCount = 0, highlight = false }) {
  if (!btn) return;
  const label = btn.querySelector(".expand-toggle-label");
  const badge = btn.querySelector(".expand-toggle-badge");
  const chevron = btn.querySelector(".expand-toggle-chevron");
  if (label) label.textContent = open ? labelOpen : labelClosed;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.classList.toggle("active", highlight || open);
  if (badge) {
    const showBadge = !open && badgeCount > 0;
    badge.classList.toggle("hidden", !showBadge);
    badge.textContent = showBadge ? String(badgeCount) : "";
    badge.title = showBadge ? `已設 ${badgeCount} 項篩選` : "";
  }
  if (chevron) chevron.classList.toggle("is-open", open);
}

function updateAdvancedToggleChrome() {
  updateExpandToggleButton(document.getElementById("advancedToggleBtn"), {
    open: searchAdvancedOpen,
    labelOpen: "收起",
    labelClosed: "高級檢索",
    badgeCount: countActiveAdvancedFilters(),
    highlight: hasActiveAdvancedFilters(),
  });
}

function setAdvancedSearchOpen(open, { userToggle = false } = {}) {
  if (open === searchAdvancedOpen) {
    updateAdvancedToggleChrome();
    return;
  }
  searchAdvancedOpen = open;
  syncExpandPanel(document.getElementById("advancedSearchPanel"), open);
  updateAdvancedToggleChrome();
  updateSearchFormForType();
  if (userToggle && open) {
    pauseAdvancedScrollCollapse();
    requestAnimationFrame(() => {
      lastSearchScrollY = window.scrollY;
    });
  }
}

function bindAdvancedFilterListeners() {
  const ids = new Set([...ADVANCED_FILTER_IDS, ...PLACE_ADVANCED_FILTER_IDS, ...TEXT_ADVANCED_FILTER_IDS]);
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const onChange = () => {
      updateAdvancedToggleChrome();
      updateSearchFormForType();
    };
    el.addEventListener("input", onChange);
    el.addEventListener("change", onChange);
  }
}

/** 僅收起高級檢索面板，不清除已填寫的篩選條件 */
function collapseAdvancedSearchPreserveValues() {
  if (!searchAdvancedOpen) return;
  setAdvancedSearchOpen(false);
}

function bindSearchResultsScrollCollapse() {
  const scrollTops = new WeakMap();
  let collapseScheduled = false;
  const onScroll = (ev) => {
    if (Date.now() < advancedScrollCollapsePausedUntil) {
      lastSearchScrollY = window.scrollY;
      return;
    }
    if (getActiveView() !== "search" || !searchAdvancedOpen) {
      lastSearchScrollY = window.scrollY;
      return;
    }
    const target = ev.target;
    if (target instanceof Element && target.classList.contains("table-wrap")) {
      const prevTop = scrollTops.get(target) ?? target.scrollTop;
      scrollTops.set(target, target.scrollTop);
      if (target.scrollTop === prevTop) return;
    }
    const y = window.scrollY;
    if (Math.abs(y - lastSearchScrollY) < 8 || collapseScheduled) return;
    lastSearchScrollY = y;
    collapseScheduled = true;
    requestAnimationFrame(() => {
      collapseScheduled = false;
      collapseAdvancedSearchPreserveValues();
    });
  };
  lastSearchScrollY = window.scrollY;
  window.addEventListener("scroll", onScroll, { passive: true });
  document.getElementById("searchView")?.addEventListener("scroll", onScroll, { passive: true });
  document.querySelectorAll("#searchView .table-wrap").forEach((el) => {
    scrollTops.set(el, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
  });
}

function searchFingerprint() {
  const q = document.getElementById("searchInput").value.trim();
  const type = document.getElementById("searchTypeFilter").value;
  const parts = { q, type };
  if (!isAdvancedSearchActive()) return JSON.stringify(parts);

  const advMode = document.getElementById("advancedMode")?.value || "";
  parts.advMode = advMode;
  if (type === "person") {
    parts.dynasty = document.getElementById("dynastyFilter").value;
    parts.birthMin = document.getElementById("birthMin").value;
    parts.deathMax = document.getElementById("deathMax").value;
    parts.female = document.getElementById("femaleFilter").value;
    parts.indexAddr = document.getElementById("indexAddrFilter").value.trim();
  }
  if (type === "place") {
    parts.placeDynasty = document.getElementById("placeDynastyFilter").value;
    parts.placeFirstYear = document.getElementById("placeFirstYear").value;
    parts.placeLastYear = document.getElementById("placeLastYear").value;
  }
  if (type === "text") {
    parts.textRelatedPerson = document.getElementById("textRelatedPersonFilter").value.trim();
    parts.textDynasty = document.getElementById("textDynastyFilter").value;
  }
  if (advMode === "posting") {
    parts.advYearMin = document.getElementById("advYearMin").value;
    parts.advYearMax = document.getElementById("advYearMax").value;
    parts.advDynasty = document.getElementById("advDynastyFilter").value;
  }
  if (advMode === "event") {
    parts.advYearMin = document.getElementById("advYearMin").value;
    parts.advYearMax = document.getElementById("advYearMax").value;
  }
  return JSON.stringify(parts);
}

const ENTITY_TYPES = {
  office: { idCol: "c_office_id", labelCol: "c_office_chn" },
  place: { idCol: "c_addr_id", labelCol: "c_name_chn" },
  text: { idCol: "c_textid", labelCol: "c_title_chn" },
  institution: { idCol: "c_inst_name_code", labelCol: "c_inst_name_hz" },
  event: { idCol: "c_event_code", labelCol: "c_event_name_chn" },
};

const CODE_SEARCH_TYPES = new Set(["kinship", "assoc", "entry", "status", "choronym", "nianhao"]);

const SEARCH_CONFIG = {
  person: {
    inputLabel: "姓名",
    placeholder: "姓名、拼音、別名或人物編號",
    columns: [
      "c_name_chn", "c_alt_names", "c_dynasty_chn", "_years",
      "c_index_addr_chn", "c_personid", "_visual_action",
    ],
    personLink: "c_name_chn",
  },
  place: {
    inputLabel: "地名",
    placeholder: "地名、拼音或地址編號",
    columns: [
      "c_name_chn", "c_alt_names", "c_dynasty_chn", "c_parent_addr_chn", "c_child_addrs_chn",
      "c_firstyear", "c_lastyear", "_entity_action",
    ],
    entityType: "place",
  },
  office: {
    inputLabel: "官職",
    placeholder: "官職名、拼音或官職編號",
    columns: ["c_office_chn", "c_office_pinyin", "c_office_trans", "c_dynasty_chn", "c_office_id", "_entity_action"],
    entityType: "office",
  },
  text: {
    inputLabel: "文獻題名",
    placeholder: "文獻題名、拼音或文獻編號",
    columns: [
      "c_title_chn", "c_title_alt_chn", "c_responsible_persons",
      "c_text_cat_desc_chn", "c_dynasty_chn", "_text_year", "c_extant_desc_chn", "_entity_action",
    ],
    entityType: "text",
  },
  institution: {
    inputLabel: "機構名稱",
    placeholder: "機構名稱、拼音或機構編碼",
    columns: ["c_inst_name_hz", "c_inst_name_py", "c_inst_name_code", "_entity_action"],
    entityType: "institution",
  },
  event: {
    inputLabel: "事件名稱",
    placeholder: "事件名稱或事件編碼",
    columns: ["c_event_name_chn", "c_event_name", "_event_years", "c_event_code", "_entity_action"],
    entityType: "event",
  },
  kinship: {
    inputLabel: "親屬關係",
    placeholder: "親屬關係關鍵詞或代碼",
    columns: ["c_name_chn", "c_name", "c_code"],
  },
  assoc: {
    inputLabel: "社會關係",
    placeholder: "社會關係關鍵詞或代碼",
    columns: ["c_name_chn", "c_name", "c_code"],
  },
  entry: {
    inputLabel: "入仕途徑",
    placeholder: "入仕途徑關鍵詞或代碼",
    columns: ["c_name_chn", "c_name", "c_code"],
  },
  status: {
    inputLabel: "社會身份",
    placeholder: "社會身份關鍵詞或代碼",
    columns: ["c_name_chn", "c_name", "c_code"],
  },
  choronym: {
    inputLabel: "郡望",
    placeholder: "郡望關鍵詞或代碼",
    columns: ["c_name_chn", "c_name", "c_code"],
  },
  nianhao: {
    inputLabel: "年號",
    placeholder: "年號或年號 ID",
    columns: ["c_name_chn", "c_name", "c_dynasty_chn", "_year_range", "c_code"],
  },
};

const HIDDEN_MODULE_COLS = new Set([
  "c_kin_id", "c_node_id", "c_office_id", "c_addr_id", "c_index_addr_id",
  "c_textid", "c_inst_name_code", "c_event_code", "c_hyperlink",
]);

const MODULE_PERSON_LINKS = {
  kinship: [{ col: "c_kin_chn", idCol: "c_kin_id" }],
  association: [{ col: "c_node_chn", idCol: "c_node_id" }],
  biog_source: [{ col: "c_title_chn", hrefCol: "c_hyperlink" }],
};

const MODULE_ENTITY_LINKS = {
  posting: [{ col: "c_office_chn", entityType: "office", idCol: "c_office_id" }],
  text_role: [{ col: "c_title_chn", entityType: "text", idCol: "c_textid" }],
  institution: [
    { col: "c_inst_name_hz", entityType: "institution", idCol: "c_inst_name_code" },
    { col: "c_inst_addr_chn", entityType: "place", idCol: "c_inst_addr_id" },
  ],
  event: [
    { col: "c_event_name_chn", entityType: "event", idCol: "c_event_code" },
    { col: "c_event_addr_chn", entityType: "place", idCol: "c_addr_id" },
  ],
  possessions: [
    { col: "c_possession_addr_chn", entityType: "place", idCol: "c_addr_id" },
  ],
  biog_address: [{ col: "c_addr_chn", entityType: "place", idCol: "c_addr_id" }],
  people_addr: [{ col: "c_index_addr_chn", entityType: "place", idCol: "c_index_addr_id" }],
};

async function api(url, opts = 15000) {
  let timeout = 15000;
  let loading = null;
  let signal = null;
  if (typeof opts === "number") {
    timeout = opts;
  } else if (opts != null && typeof opts === "object") {
    timeout = opts.timeout ?? 15000;
    loading = opts.loading ?? null;
    signal = opts.signal ?? null;
  }

  const run = async () => {
    const ctrl = new AbortController();
    const merged = globalThis.CbdbLoading?.mergeSignal?.(signal) ?? signal;
    const onExternalAbort = () => {
      ctrl.abort(merged?.reason ?? signal?.reason ?? new DOMException("請求已取消", "AbortError"));
    };
    if (merged) {
      if (merged.aborted) {
        onExternalAbort();
      } else {
        merged.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    const t = setTimeout(
      () => ctrl.abort(new DOMException("請求超時，請稍後重試", "TimeoutError")),
      timeout,
    );
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
      if (merged) merged.removeEventListener("abort", onExternalAbort);
    }
  };

  if (loading && globalThis.CbdbLoading) {
    return CbdbLoading.withLoading(run, loading);
  }
  return run();
}

function isBenignAbortError(err) {
  if (!err) return false;
  if (isUserLoadingCancel(err)) return true;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const msg = String(err.message || "");
  return /aborted|abort/i.test(msg);
}

function isUserLoadingCancel(err) {
  if (globalThis.CbdbLoading?.isUserCancelError?.(err)) return true;
  if (!err || err.name !== "AbortError") return false;
  return /已取消載入/.test(String(err.message || ""));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve();
        return;
      }
      const markLoaded = () => {
        existing.dataset.loaded = "1";
        resolve();
      };
      // Scripts already parsed from index.html never fire load again.
      if (
        existing.readyState === "complete"
        || existing.readyState === "loaded"
        || document.readyState === "complete"
      ) {
        markLoaded();
        return;
      }
      existing.addEventListener("load", markLoaded, { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => {
      el.dataset.loaded = "1";
      resolve();
    };
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(el);
  });
}

function ensureGraphLibs() {
  if (globalThis.cytoscape && globalThis.RelationsGraph) {
    return Promise.resolve();
  }
  if (!graphLibsPromise) {
    graphLibsPromise = Promise.resolve()
      .then(() => (globalThis.cytoscape ? undefined : loadScript("/vendor/cytoscape.min.js?v=1")))
      .then(() => (globalThis.GraphEdgeSchema ? undefined : loadScript("/graph-edge-schema.js?v=6")))
      .then(() => (globalThis.RelationsGraph ? undefined : loadScript("/cbdb-graph.js?v=38")));
  }
  return graphLibsPromise;
}

let relationsGraphBarActive = false;
let relationsGraphBarRaf = null;
let relationsGraphBarStart = 0;
let relationsGraphBarPct = 0;

function relationsGraphBarEls() {
  return {
    bar: document.getElementById("relationsGraphLoadingBar"),
    fill: document.getElementById("relationsGraphLoadingBarFill"),
  };
}

function relationsGraphBarStopAnim() {
  if (relationsGraphBarRaf) {
    cancelAnimationFrame(relationsGraphBarRaf);
    relationsGraphBarRaf = null;
  }
}

function relationsGraphBarSetPct(pct) {
  const { fill, bar } = relationsGraphBarEls();
  relationsGraphBarPct = Math.max(0, Math.min(100, pct));
  if (fill) fill.style.width = `${relationsGraphBarPct}%`;
  if (bar) bar.setAttribute("aria-valuenow", String(Math.round(relationsGraphBarPct)));
}

function relationsGraphBarStartAnim() {
  relationsGraphBarStopAnim();
  relationsGraphBarStart = performance.now();
  const { fill } = relationsGraphBarEls();
  if (fill) fill.style.transition = "width 0.25s ease-out";
  relationsGraphBarSetPct(8);
  const tick = (now) => {
    if (!relationsGraphBarActive) return;
    const elapsed = now - relationsGraphBarStart;
    relationsGraphBarSetPct(Math.min(8 + 82 * (1 - Math.exp(-elapsed / 2200)), 92));
    if (relationsGraphBarActive && relationsGraphBarPct < 92) {
      relationsGraphBarRaf = requestAnimationFrame(tick);
    }
  };
  relationsGraphBarRaf = requestAnimationFrame(tick);
}

function relationsGraphLoadingBegin() {
  const { bar } = relationsGraphBarEls();
  relationsGraphBarActive = true;
  if (bar) {
    bar.classList.remove("hidden");
    bar.setAttribute("aria-hidden", "false");
    bar.setAttribute("aria-busy", "true");
  }
  relationsGraphBarStartAnim();
}

function relationsGraphLoadingEnd() {
  if (!relationsGraphBarActive) return;
  relationsGraphBarActive = false;
  relationsGraphBarStopAnim();
  const { bar, fill } = relationsGraphBarEls();
  if (fill) fill.style.transition = "width 0.18s ease-out";
  relationsGraphBarSetPct(100);
  setTimeout(() => {
    if (relationsGraphBarActive) return;
    if (bar) {
      bar.classList.add("hidden");
      bar.setAttribute("aria-hidden", "true");
      bar.setAttribute("aria-busy", "false");
    }
    if (fill) {
      fill.style.transition = "none";
      fill.style.width = "0%";
    }
    relationsGraphBarPct = 0;
  }, 200);
}

function getCachedPerson(id) {
  const entry = personCache.get(Number(id));
  if (!entry) return null;
  if (Date.now() - entry.ts > PERSON_CACHE_TTL_MS) {
    personCache.delete(Number(id));
    return null;
  }
  return entry.data;
}

function setCachedPerson(id, data) {
  personCache.set(Number(id), { data, ts: Date.now() });
}

async function loadPersonModuleCounts(personId, { signal, stale } = {}) {
  const pid = Number(personId);
  const cached = moduleCountsCache.get(pid);
  if (cached && Date.now() - cached.ts < MODULE_COUNTS_CACHE_TTL_MS) {
    if (stale?.()) return;
    moduleCounts = cached.counts;
    renderModuleNav();
    renderRelationsTabs();
    return;
  }
  try {
    const countsData = await api(`/api/person/${personId}/module-counts`, {
      signal,
      timeout: 45000,
    });
    if (stale?.()) return;
    moduleCounts = countsData.module_counts || {};
    moduleCountsCache.set(pid, { counts: { ...moduleCounts }, ts: Date.now() });
    renderModuleNav();
    renderRelationsTabs();
    if (relationsModuleCount() > 0) warmRelationsGraph(personId);
  } catch (err) {
    if (stale?.() || isBenignAbortError(err)) return;
  }
}

function formatSearchMeta(data) {
  const modeLabel = data.mode === "posting" ? "（任官）" : data.mode === "event" ? "（事件）" : "";
  const n = data.results?.length ?? 0;
  if (data.total != null && data.total > 0) {
    return `共 ${fmt(data.total)} 條${modeLabel}`;
  }
  if (n > 0 && data.has_more) {
    return `本頁 ${fmt(n)} 條${modeLabel}（還有更多，翻頁載入總數）`;
  }
  if (n > 0) {
    return `本頁 ${fmt(n)} 條${modeLabel}`;
  }
  return "未找到匹配項";
}

function updateSearchPager(offset, total, rowCount, hasMore = false) {
  const pager = document.getElementById("searchPager");
  if (!pager) return;
  const prev = pager.querySelector("[data-pager-prev]");
  const next = pager.querySelector("[data-pager-next]");
  const info = pager.querySelector("[data-pager-info]");
  const show = rowCount > 0 || (total != null && total > 0);

  pager.classList.toggle("hidden", !show);
  if (prev) prev.disabled = offset <= 0;
  if (next) {
    next.disabled = total != null
      ? offset + pageSize >= total
      : !hasMore;
  }
  if (!info) return;

  if (total != null && total > 0) {
    const currentPage = Math.floor(offset / pageSize) + 1;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    info.textContent = `第 ${currentPage}/${totalPages} 頁`;
    return;
  }
  if (rowCount > 0) {
    const page = Math.floor(offset / pageSize) + 1;
    info.textContent = hasMore ? `第 ${page} 頁（總數待載入）` : `第 ${page} 頁`;
    return;
  }
  info.textContent = "—";
}

function toast(msg, err = false) {
  const el = document.createElement("div");
  el.className = "toast" + (err ? " err" : "");
  el.textContent = msg;
  document.getElementById("toastHost").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function fmt(n) { return Number(n || 0).toLocaleString(); }

function fieldLabel(moduleId, key) {
  if (key === "_source") return "參考文獻";
  const L = window.CBDB_FIELD_LABELS;
  return L?.modules?.[moduleId]?.[key] || L?.by_column?.[key] || key;
}

function formatAltnameDisplay(row) {
  return row.c_alt_name_chn || row.c_alt_name || "—";
}

function normalizeModuleId(id) {
  if (id === "people_addr" || id === "altname") return "basic";
  if (id === "posting_addr") return "posting";
  if (id === "kinship" || id === "association" || id === "graph") return "relations";
  if (id === "institution_addr") return "institution";
  if (id === "event_addr") return "event";
  if (id === "possessions_addr") return "possessions";
  return id;
}

const RELATIONS_TABS = [
  ["kinship", "親屬關係"],
  ["association", "社會關係"],
  ["graph", "關係星圖"],
];

function relationsModuleCount() {
  return (moduleCounts.kinship ?? 0) + (moduleCounts.association ?? 0);
}

function relationsTabLabel(tabId) {
  return RELATIONS_TABS.find(([id]) => id === tabId)?.[1] || tabId;
}

function ensureModuleTableVisible() {
  document.getElementById("moduleTableWrap")?.classList.remove("hidden");
  document.getElementById("moduleRelationsGraph")?.classList.add("hidden");
  document.getElementById("moduleRelationsGraph")?.classList.remove("is-fullscreen");
}

function showModuleLoadingPlaceholder(message = "載入中…") {
  ensureModuleTableVisible();
  const table = document.getElementById("moduleTable");
  table?.classList.add("kv-mode");
  document.getElementById("moduleHead").innerHTML = "<tr><th>#</th><th>欄位</th><th>內容</th></tr>";
  const body = document.getElementById("moduleBody");
  if (body) body.innerHTML = `<tr><td colspan="3" class="empty">${escapeHtml(message)}</td></tr>`;
}

function setRelationsViewMode(isGraph) {
  const tableWrap = document.getElementById("moduleTableWrap");
  const pager = document.getElementById("modulePager");
  const graphPanel = document.getElementById("moduleRelationsGraph");
  tableWrap?.classList.toggle("hidden", isGraph);
  pager?.classList.toggle("hidden", isGraph);
  graphPanel?.classList.toggle("hidden", !isGraph);
  if (!isGraph) {
    setRelationsGraphFullscreen(false);
    try {
      globalThis.RelationsGraph?.destroy?.();
    } catch {
      /* graph teardown must not block module tables */
    }
    ensureModuleTableVisible();
  }
}

function formatGraphNodeRole(role) {
  if (role === "center") return "中心人物";
  const hop = Number.parseInt(String(role || "").replace("hop", ""), 10);
  if (Number.isFinite(hop)) return `第 ${hop} 步節點`;
  if (role === "assoc") return "社會關係對象";
  return "親屬";
}

function formatEdgeCategoryLabel(edgeType, category) {
  return globalThis.GraphShell?.formatEdgeCategoryLabel?.(edgeType, category)
    ?? globalThis.RelationsGraph?.categoryLabel?.(edgeType, category)
    ?? category
    ?? "—";
}

function syncRelationsGraphCategoryButtons() {
  document.querySelectorAll(".relations-graph-cat").forEach((btn) => {
    const group = btn.dataset.catGroup;
    const cat = btn.dataset.cat;
    if (!group || !cat) return;
    const on = relationsGraphCategoryFilters[group]?.[cat] !== false;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function resetRelationsGraphFilters() {
  relationsGraphKind = "all";
  relationsGraphSteps = 1;
  relationsGraphShowEdgeLabels = false;
  relationsGraphCategoryFilters = globalThis.GraphEdgeSchema
    ? globalThis.GraphEdgeSchema.categoryFiltersForGraphKind("all")
    : {
      kin: { core: true, extended: true },
      assoc: { political: true, scholarly: true, literary: true, other: true },
    };
  syncRelationsGraphToolbarUi();
}

function syncRelationsGraphToolbarUi() {
  document.querySelectorAll(".relations-graph-filter").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.graphKind === relationsGraphKind);
  });
  document.querySelectorAll(".relations-graph-steps").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.graphSteps) === relationsGraphSteps);
  });
  syncRelationsGraphCategoryButtons();
  updateRelationsGraphCategoryToolbar();
}

function ensureRelationsGraphDefaults() {
  relationsGraphKind = "all";
  relationsGraphSteps = 1;
  relationsGraphCategoryFilters = globalThis.GraphEdgeSchema
    ? globalThis.GraphEdgeSchema.categoryFiltersForGraphKind("all")
    : {
      kin: { core: true, extended: true },
      assoc: { political: true, scholarly: true, literary: true, other: true },
    };
  syncRelationsGraphToolbarUi();
}

function applyCategoryFiltersForGraphKind(kind) {
  relationsGraphCategoryFilters = globalThis.GraphEdgeSchema
    ? globalThis.GraphEdgeSchema.categoryFiltersForGraphKind(kind)
    : relationsGraphCategoryFilters;
  syncRelationsGraphCategoryButtons();
}

function updateRelationsGraphCategoryToolbar() {
  document.getElementById("relationsKinCatGroup")?.classList.toggle(
    "hidden",
    relationsGraphKind === "association",
  );
  document.getElementById("relationsAssocCatGroup")?.classList.toggle(
    "hidden",
    relationsGraphKind === "kinship",
  );
}

let relationsGraphSelection = { kind: "none" };

function relationsGraphRenderOptions() {
  return {
    mode: "ego",
    graphKind: relationsGraphKind,
    categoryFilters: relationsGraphCategoryFilters,
  };
}

function applyRelationsGraphCategoryFilters() {
  globalThis.RelationsGraph?.setCategoryFilters?.(relationsGraphCategoryFilters);
  renderRelationsGraphDetail(relationsGraphSelection, relationsGraphCenter);
}

function renderRelationsGraphDetail(selection, graphData = relationsGraphCenter) {
  if (selection) relationsGraphSelection = selection;
  const host = document.querySelector("#relationsGraphDetail .relations-graph-detail-inner");
  if (!host || !globalThis.GraphShell) return;

  host.innerHTML = GraphShell.renderGraphDetail(selection, graphData, {
    centerLabel: currentPersonName,
    centerPersonId: selectedPersonId,
    showEdgeLabels: relationsGraphShowEdgeLabels,
    graphOptions: relationsGraphRenderOptions(),
    idleHint: "點擊節點或連線查看詳情；默認僅顯示與中心相連的連線，點選節點可展開其關係。分類按鈕可即時隱藏/顯示邊，無需重載。",
    emptyHint: "請嘗試「全部 / 1 步」，或切換至列表查看原始記錄。",
  });

  GraphShell.bindDetailActions(host, {
    onOpenPerson: (pid) => {
      openPerson(Number(pid), { moduleId: "relations", relationsTab: "graph" });
    },
    onToggleEdgeLabels: () => {
      relationsGraphShowEdgeLabels = !relationsGraphShowEdgeLabels;
      RelationsGraph.setEdgeLabelsVisible?.(relationsGraphShowEdgeLabels);
      renderRelationsGraphDetail({ kind: "none" }, relationsGraphCenter);
    },
  });
}

function relationsGraphCacheKey(personId, steps, kind) {
  return `${personId}:${steps}:${kind}`;
}

function getCachedRelationsGraph(personId, steps, kind) {
  const entry = relationsGraphDataCache.get(relationsGraphCacheKey(personId, steps, kind));
  if (!entry) return null;
  if (Date.now() - entry.ts > RELATIONS_GRAPH_CACHE_TTL_MS) {
    relationsGraphDataCache.delete(relationsGraphCacheKey(personId, steps, kind));
    return null;
  }
  return entry.data;
}

function setCachedRelationsGraph(personId, steps, kind, data) {
  relationsGraphDataCache.set(relationsGraphCacheKey(personId, steps, kind), {
    data,
    ts: Date.now(),
  });
}

function pruneRelationsGraphCache(activePersonId) {
  const prefix = `${activePersonId}:`;
  for (const key of relationsGraphDataCache.keys()) {
    if (!key.startsWith(prefix)) relationsGraphDataCache.delete(key);
  }
}

function prefetchRelationsGraph(personId, steps = 1, kind = "all") {
  if (!personId) return;
  if (getCachedRelationsGraph(personId, steps, kind)) return;
  relationsGraphPrefetchCtrl?.abort(new DOMException("新的預取請求", "AbortError"));
  const ctrl = new AbortController();
  relationsGraphPrefetchCtrl = ctrl;
  const params = new URLSearchParams({ steps: String(steps), kind });
  api(`/api/person/${personId}/relations-graph?${params}`, {
    signal: ctrl.signal,
    timeout: 120000,
  })
    .then((data) => {
      if (ctrl.signal.aborted) return;
      setCachedRelationsGraph(personId, steps, kind, data);
    })
    .catch((err) => {
      if (!isBenignAbortError(err)) return;
    });
}

function warmRelationsGraph(personId) {
  if (!personId) return;
  ensureGraphLibs().catch(() => {});
  prefetchRelationsGraph(personId, 1, "all");
}

function paintRelationsGraphStats(data) {
  const stats = data?.stats || {};
  const countEl = document.getElementById("moduleCount");
  if (!countEl) return;
  let text = stats.edge_count ? `節點 ${stats.node_count} · 關係 ${stats.edge_count}` : "";
  if (stats.steps) text += (text ? " · " : "") + `${stats.steps} 步`;
  if (stats.truncated) text += (text ? " · " : "") + "已截斷";
  if (stats.source === "index") text += (text ? " · " : "") + "索引";
  countEl.textContent = text;
}

async function renderRelationsGraphData(data, { stale } = {}) {
  const canvas = document.getElementById("relationsGraphCanvas");
  if (!canvas) return;

  paintRelationsGraphStats(data);
  relationsGraphCenter = data;
  renderRelationsGraphDetail(relationsGraphSelection, data);

  if (!data.edges?.length) {
    if (globalThis.RelationsGraph) RelationsGraph.destroy();
    canvas.innerHTML = '<p class="empty">暫無可繪製的關係，請調整篩選或查看列表。</p>';
    renderRelationsGraphDetail({ kind: "empty", center: data }, data);
    return;
  }

  setRelationsViewMode(true);
  if (globalThis.RelationsGraph) RelationsGraph.destroy();
  canvas.innerHTML = '<p class="empty">正在繪製關係星圖…</p>';

  try {
    await ensureGraphLibs();
    if (stale?.()) return;

    if (canvas.getBoundingClientRect().height < 10) {
      canvas.style.minHeight = "420px";
    }
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    if (stale?.()) return;

    canvas.innerHTML = "";
    RelationsGraph.mount(canvas);
    await RelationsGraph.render(
      data,
      {
        onSelect: (sel) => renderRelationsGraphDetail(sel, data),
        onReady: () => {
          if (stale?.()) return;
          RelationsGraph.setEdgeLabelsVisible?.(relationsGraphShowEdgeLabels);
          renderRelationsGraphDetail({ kind: "none" }, data);
        },
      },
      { mode: "ego", graphKind: relationsGraphKind, categoryFilters: relationsGraphCategoryFilters },
    );
    if (stale?.()) {
      RelationsGraph.destroy?.();
      canvas.innerHTML = "";
      return;
    }
    applyRelationsGraphCategoryFilters();
    requestAnimationFrame(() => RelationsGraph.resize?.({ refit: true }));
  } catch (err) {
    if (stale?.() || isBenignAbortError(err)) return;
    RelationsGraph.destroy?.();
    canvas.innerHTML = `<p class="empty">${escapeHtml(err.message || "圖譜繪製失敗")}</p>`;
    toast(err.message || "圖譜繪製失敗", true);
    throw err;
  }
}

async function loadRelationsGraph({ forceRefresh = false } = {}) {
  const canvas = document.getElementById("relationsGraphCanvas");
  if (!canvas || !selectedPersonId) return;
  const personId = selectedPersonId;
  const steps = relationsGraphSteps;
  const kind = relationsGraphKind;
  const seq = ++relationsGraphLoadSeq;
  relationsGraphAbort?.abort(new DOMException("已切換人物或篩選", "AbortError"));
  const ctrl = new AbortController();
  relationsGraphAbort = ctrl;

  setRelationsViewMode(true);
  updateRelationsGraphCategoryToolbar();
  syncRelationsGraphCategoryButtons();
  document.getElementById("modulePager")?.classList.add("hidden");
  relationsGraphLoadingBegin();

  const stale = () => (
    seq !== relationsGraphLoadSeq
    || personId !== selectedPersonId
    || ctrl.signal.aborted
  );

  try {
    const cached = !forceRefresh ? getCachedRelationsGraph(personId, steps, kind) : null;
    if (cached) {
      canvas.innerHTML = '<p class="empty">正在繪製關係星圖…</p>';
      renderRelationsGraphDetail({ kind: "none" }, cached);
      try {
        await renderRelationsGraphData(cached, { stale });
      } catch (e) {
        if (stale() || isBenignAbortError(e)) return;
        canvas.innerHTML = `<p class="empty">${escapeHtml(e.message || "圖譜繪製失敗")}</p>`;
        toast(e.message || "圖譜繪製失敗", true);
      }
      return;
    }

    if (globalThis.RelationsGraph) RelationsGraph.destroy();
    canvas.innerHTML = '<p class="empty">正在載入關係星圖…</p>';
    renderRelationsGraphDetail({ kind: "none" });

    await ensureGraphLibs();
    if (stale()) return;
    const params = new URLSearchParams({ steps: String(steps), kind });
    const data = await api(`/api/person/${personId}/relations-graph?${params}`, {
      signal: ctrl.signal,
      timeout: 120000,
    });
    if (stale()) return;
    setCachedRelationsGraph(personId, steps, kind, data);
    await renderRelationsGraphData(data, { stale });
  } catch (e) {
    if (stale() || isBenignAbortError(e)) return;
    if (globalThis.RelationsGraph) RelationsGraph.destroy();
    canvas.innerHTML = `<p class="empty">${escapeHtml(e.message || "圖譜加載失敗")}</p>`;
    toast(e.message || "圖譜加載失敗", true);
  } finally {
    if (seq === relationsGraphLoadSeq) relationsGraphLoadingEnd();
  }
}

function setRelationsGraphFullscreen(on) {
  const panel = document.getElementById("moduleRelationsGraph");
  const btn = document.getElementById("relationsGraphFullscreenBtn");
  if (!panel) return;
  panel.classList.toggle("is-fullscreen", on);
  btn?.setAttribute("aria-pressed", on ? "true" : "false");
  if (btn) btn.textContent = on ? "退出全屏" : "全屏";
  requestAnimationFrame(() => globalThis.RelationsGraph?.resize?.({ refit: true }));
}

function bindRelationsGraphToolbar() {
  document.querySelectorAll(".relations-graph-filter").forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.graphKind;
      if (!kind || kind === relationsGraphKind) return;
      relationsGraphKind = kind;
      applyCategoryFiltersForGraphKind(kind);
      syncRelationsGraphToolbarUi();
      updateRelationsGraphCategoryToolbar();
      if (moduleId === "relations" && relationsTab === "graph") loadRelationsGraph();
    };
  });
  document.querySelectorAll(".relations-graph-cat").forEach((btn) => {
    btn.onclick = () => {
      const group = btn.dataset.catGroup;
      const cat = btn.dataset.cat;
      if (!group || !cat || !relationsGraphCategoryFilters[group]) return;
      relationsGraphCategoryFilters[group][cat] = !relationsGraphCategoryFilters[group][cat];
      syncRelationsGraphCategoryButtons();
      applyRelationsGraphCategoryFilters();
    };
  });
  document.querySelectorAll(".relations-graph-steps").forEach((btn) => {
    btn.onclick = () => {
      const steps = Number(btn.dataset.graphSteps);
      if (!steps || steps === relationsGraphSteps) return;
      relationsGraphSteps = steps;
      document.querySelectorAll(".relations-graph-steps").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.graphSteps) === steps);
      });
      if (moduleId === "relations" && relationsTab === "graph") loadRelationsGraph();
    };
  });
  document.getElementById("relationsGraphFullscreenBtn")?.addEventListener("click", () => {
    const panel = document.getElementById("moduleRelationsGraph");
    setRelationsGraphFullscreen(!panel?.classList.contains("is-fullscreen"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const panel = document.getElementById("moduleRelationsGraph");
    if (panel?.classList.contains("is-fullscreen")) {
      e.preventDefault();
      setRelationsGraphFullscreen(false);
    }
  });
  window.addEventListener("resize", () => {
    if (moduleId === "relations" && relationsTab === "graph") RelationsGraph.resize?.();
  });
}

function renderRelationsTabs() {
  const el = document.getElementById("moduleRelationsTabs");
  if (!el) return;
  const show = moduleId === "relations";
  el.classList.toggle("hidden", !show);
  if (!show) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = RELATIONS_TABS.map(([tabId, label]) => {
    const count = tabId === "graph" ? relationsModuleCount() : moduleCounts[tabId];
    const active = tabId === relationsTab ? " active" : "";
    const badge = count != null && count > 0 ? `<span class="relations-tab-badge">${count}</span>` : "";
    return `<button type="button" class="relations-tab${active}" role="tab" aria-selected="${tabId === relationsTab ? "true" : "false"}" data-relations-tab="${tabId}">${escapeHtml(label)}${badge}</button>`;
  }).join("");
  el.querySelectorAll("[data-relations-tab]").forEach((btn) => {
    btn.onclick = () => {
      const tab = btn.dataset.relationsTab;
      if (tab === relationsTab) return;
      relationsTab = tab;
      if (tab === "graph") {
        ensureRelationsGraphDefaults();
        loadModule("relations", 0).catch((err) => {
          if (err?.message) toast(err.message, true);
        });
      } else {
        warmRelationsGraph(selectedPersonId);
        loadModule("relations", relationsOffsets[tab] || 0);
      }
    };
  });
}

function formatSourceDisplay(row, moduleKey = "") {
  const titleKeys = moduleKey === "text_role"
    ? ["c_source_chn", "c_source_title"]
    : moduleKey === "biog_source"
      ? ["c_title_chn", "c_title"]
      : ["c_source_chn", "c_source_title", "c_title_chn", "c_title"];
  let title = "";
  for (const key of titleKeys) {
    const v = row[key];
    if (v != null && String(v).trim()) {
      title = String(v).trim();
      break;
    }
  }
  const pages = row.c_pages;
  const parts = [];
  if (title) parts.push(title);
  if (pages != null && pages !== "" && pages !== 0) {
    parts.push(`頁${String(pages).trim()}`);
  }
  if (!parts.length && row.c_source != null && row.c_source !== "") {
    parts.push(`文獻 #${row.c_source}`);
  }
  return parts.length ? parts.join(" · ") : "—";
}

function searchCellValue(row, col) {
  if (col === "_years") {
    const y = [row.c_birthyear, row.c_deathyear].filter(Boolean).join("–");
    return y || "—";
  }
  if (col === "_year_range") {
    const y = [row.c_firstyear, row.c_lastyear].filter(Boolean).join("–");
    return y || "—";
  }
  if (col === "_event_years") {
    const y = [row.c_fy_yr, row.c_ly_yr].filter(Boolean).join("–");
    return y || "—";
  }
  if (col === "_entity_action") return "";
  if (col === "_text_year") return formatTextYearDisplay(row);
  if (col === "c_dynasty_chn") {
    return validDynastyLabel(row[col]) ? String(row[col]).trim() : "—";
  }
  if (col === "c_name_chn" && row.c_personid != null) {
    return formatPersonSearchName(row);
  }
  if (col === "c_firstyear" || col === "c_lastyear") {
    const formatted = fmtGregorianYear(row[col]);
    return formatted || "—";
  }
  const v = row[col];
  return v == null || v === "" ? "—" : String(v);
}

function syncPagerSizeButtons() {
  document.querySelectorAll(".pager-size").forEach((btn) => {
    const active = Number(btn.dataset.size) === pageSize;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function updatePager(pagerId, offset, total, rowCount) {
  const pager = document.getElementById(pagerId);
  if (!pager) return;
  const prev = pager.querySelector("[data-pager-prev]");
  const next = pager.querySelector("[data-pager-next]");
  const info = pager.querySelector("[data-pager-info]");
  const show = total > 0;

  pager.classList.toggle("hidden", !show);
  if (prev) prev.disabled = offset <= 0;
  if (next) next.disabled = offset + pageSize >= total;
  if (!info) return;

  if (!total) {
    info.textContent = "—";
    return;
  }
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  info.textContent = `第 ${currentPage}/${totalPages} 頁`;
}

function setPageSize(size) {
  if (!PAGE_SIZE_OPTIONS.includes(size) || size === pageSize) return false;
  pageSize = size;
  localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
  syncPagerSizeButtons();
  return true;
}

function onPageSizeChange() {
  const entityPanel = document.getElementById("entityPersonsPanel");
  const entityOpen = entityPanel && !entityPanel.classList.contains("hidden");
  if (entityOpen && entityContext) {
    openEntityPersons(entityContext.entityType, entityContext.entityId, "", 0, { push: false });
    return;
  }
  if (getActiveView() === "person" && selectedPersonId && moduleId !== "basic") {
    loadModule(moduleId, 0);
    return;
  }
  if (lastSearchQuery) {
    runSearch(0);
  }
}

function bindPagerControls() {
  const handlers = {
    searchPager: {
      prev: () => searchOffset > 0 && runSearch(searchOffset - pageSize),
      next: () => {
        const canNext = searchTotal != null
          ? searchOffset + pageSize < searchTotal
          : searchHasMore;
        if (canNext) runSearch(searchOffset + pageSize);
      },
    },
    entityPager: {
      prev: () => {
        if (entityContext && entityOffset > 0) {
          openEntityPersons(entityContext.entityType, entityContext.entityId, "", entityOffset - pageSize, { push: false });
        }
      },
      next: () => {
        if (entityContext && entityOffset + pageSize < entityTotal) {
          openEntityPersons(entityContext.entityType, entityContext.entityId, "", entityOffset + pageSize, { push: false });
        }
      },
    },
    modulePager: {
      prev: () => moduleOffset > 0 && loadModule(moduleId, moduleOffset - pageSize),
      next: () => moduleOffset + pageSize < moduleTotal && loadModule(moduleId, moduleOffset + pageSize),
    },
  };

  for (const [pagerId, { prev, next }] of Object.entries(handlers)) {
    const pager = document.getElementById(pagerId);
    if (!pager) continue;
    pager.querySelector("[data-pager-prev]")?.addEventListener("click", prev);
    pager.querySelector("[data-pager-next]")?.addEventListener("click", next);
  }

  document.querySelectorAll(".pager-size").forEach((btn) => {
    btn.addEventListener("click", () => {
      const size = Number(btn.dataset.size);
      if (setPageSize(size)) onPageSizeChange();
    });
  });
  syncPagerSizeButtons();
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hanzi() {
  return window.CBDBHanzi || {
    composeChineseName: (row) => String(row?.c_name_chn ?? row?.c_name ?? "").trim(),
    formatPersonDisplayName: (row) => String(row?.c_name_chn ?? row?.c_name ?? "—").trim() || "—",
    personNameTitle: () => "",
    escapeHanText: escapeHtml,
    hanFontFamily: () => '"Noto Serif TC", "Noto Serif SC", serif',
  };
}

function formatPersonSearchName(row) {
  return hanzi().formatPersonDisplayName(row);
}

function personSearchNameTitle(row) {
  return hanzi().personNameTitle(row);
}

function renderDisplayCell(cell) {
  const text = cell?.text ?? "—";
  if (text === "—" || !cell?.link) return escapeHtml(text);
  const link = cell.link;
  if (link.type === "external") {
    const href = String(link.href);
    return `<a class="link external" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
  }
  if (link.type === "person") {
    return `<button type="button" class="link" data-person-id="${link.id}">${escapeHtml(text)}</button>`;
  }
  if (link.type === "entity") {
    return `<button type="button" class="link" data-entity-type="${link.entityType}" data-entity-id="${link.id}">${escapeHtml(text)}</button>`;
  }
  return escapeHtml(text);
}

function bindModuleRowLinks(tr) {
  tr.querySelectorAll("[data-person-id]").forEach((btn) => {
    btn.onclick = (e) => { e.stopPropagation(); openPersonFromLink(Number(btn.dataset.personId), e); };
  });
  tr.querySelectorAll("[data-entity-type]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openEntityPersons(btn.dataset.entityType, Number(btn.dataset.entityId), "", 0, { push: true });
    };
  });
}

function renderDisplayBasic(data) {
  ensureModuleTableVisible();
  document.getElementById("moduleTitle").textContent = data.title || "基本資料";
  renderRelationsTabs();
  document.getElementById("moduleCount").textContent = "";
  document.getElementById("modulePager").classList.add("hidden");
  document.getElementById("moduleTable").classList.add("kv-mode");
  document.getElementById("moduleHead").innerHTML = `<tr>${(data.headers || ["#", "欄位", "內容"]).map((h) =>
    `<th>${escapeHtml(h)}</th>`
  ).join("")}</tr>`;
  document.getElementById("moduleBody").innerHTML = (data.rows || []).map((row) =>
    `<tr><td>${row.index}</td><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value ?? "—")}</td></tr>`
  ).join("");
}

function renderDisplayTable(data) {
  ensureModuleTableVisible();
  document.getElementById("moduleTable").classList.remove("kv-mode");
  document.getElementById("moduleCount").textContent = data.total ? `共 ${data.total} 條` : "";
  document.getElementById("moduleHead").innerHTML = `<tr>${(data.headers || []).map((h) =>
    `<th>${escapeHtml(h)}</th>`
  ).join("")}</tr>`;
  const body = document.getElementById("moduleBody");
  body.innerHTML = "";
  const colCount = (data.headers || []).length || 1;
  if (!data.rows?.length) {
    body.innerHTML = `<tr><td colspan="${colCount}" class="empty">本模塊暫無記錄</td></tr>`;
    updatePager("modulePager", data.offset || 0, data.total || 0, 0);
    return;
  }
  data.rows.forEach((row) => {
    const tr = document.createElement("tr");
    const cells = (row.cells || []).map((c) => renderDisplayCell(c));
    tr.innerHTML = `<td>${row.index}</td>` + cells.map((c) => `<td>${c}</td>`).join("");
    bindModuleRowLinks(tr);
    body.appendChild(tr);
  });
  updatePager("modulePager", data.offset || 0, data.total || 0, data.rows.length);
}

function renderModuleCell(moduleKey, row, col, rawVal) {
  if (moduleKey === "entry" && col === "c_year") {
    return escapeHtml(formatEntryYearDisplay(row));
  }
  if (moduleKey === "association" && col === "c_assoc_first_year") {
    return escapeHtml(formatAssociationFirstYearDisplay(row));
  }
  if (moduleKey === "posting" && col === "c_firstyear") {
    return escapeHtml(formatPostingFirstYearDisplay(row));
  }
  if (moduleKey === "posting" && col === "c_lastyear") {
    return escapeHtml(formatPostingLastYearDisplay(row));
  }
  if (col === "_source") {
    const text = formatSourceDisplay(row, moduleKey);
    if (text === "—") return text;
    if (moduleKey === "biog_source" && row.c_hyperlink) {
      const href = String(row.c_hyperlink);
      return `<a class="link external" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
    }
    return escapeHtml(text);
  }
  const val = rawVal == null || rawVal === "" ? "—" : String(rawVal);
  if (val === "—") return val;

  const personLinks = MODULE_PERSON_LINKS[moduleKey] || [];
  for (const link of personLinks) {
    if (link.col === col && row[link.idCol]) {
      if (link.hrefCol && row[link.hrefCol]) {
        const href = String(row[link.hrefCol]);
        return `<a class="link external" href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(val)}</a>`;
      }
      const pid = row[link.idCol];
      return `<button type="button" class="link" data-person-id="${pid}">${escapeHtml(val)}</button>`;
    }
  }

  const entityLinks = MODULE_ENTITY_LINKS[moduleKey] || [];
  for (const link of entityLinks) {
    if (link.col === col && row[link.idCol]) {
      const eid = row[link.idCol];
      return `<button type="button" class="link" data-entity-type="${link.entityType}" data-entity-id="${eid}">${escapeHtml(val)}</button>`;
    }
  }
  return escapeHtml(val);
}

function updateSearchFormForType() {
  const type = document.getElementById("searchTypeFilter").value;
  currentSearchType = type;
  const cfg = SEARCH_CONFIG[type] || SEARCH_CONFIG.person;
  const advMode = document.getElementById("advancedMode")?.value || "";

  let inputLabel = cfg.inputLabel || "關鍵詞";
  if (hasActiveAdvancedFilters() && type === "person" && advMode === "posting") {
    inputLabel = "官職關鍵詞";
  } else if (hasActiveAdvancedFilters() && type === "person" && advMode === "event") {
    inputLabel = "事件關鍵詞";
  }
  document.getElementById("searchInputLabel").textContent = inputLabel;
  document.getElementById("searchInput").placeholder = cfg.placeholder;

  const personBlock = document.getElementById("personAdvancedFilters");
  const placeBlock = document.getElementById("placeAdvancedFilters");
  const textBlock = document.getElementById("textAdvancedFilters");
  const typeHint = document.getElementById("advancedTypeHint");
  const showPersonAdvanced = type === "person";
  const showPlaceAdvanced = type === "place";
  const showTextAdvanced = type === "text";
  personBlock?.classList.toggle("hidden", !showPersonAdvanced);
  placeBlock?.classList.toggle("hidden", !showPlaceAdvanced);
  textBlock?.classList.toggle("hidden", !showTextAdvanced);
  typeHint?.classList.toggle("hidden", showPersonAdvanced || showPlaceAdvanced || showTextAdvanced);

  const postingFields = ["advYearMin", "advYearMax", "advDynastyFilter"];
  for (const id of postingFields) {
    const el = document.getElementById(id)?.closest(".field");
    if (el) el.classList.toggle("hidden", advMode !== "posting" && advMode !== "event");
  }
  document.getElementById("advDynastyFilter")?.closest(".field")
    ?.classList.toggle("hidden", advMode !== "posting");

  const standardPersonFilterIds = [
    "dynastyFilter", "birthMin", "deathMax",
    "femaleFilter", "indexAddrFilter",
  ];
  for (const id of standardPersonFilterIds) {
    const el = document.getElementById(id)?.closest(".field");
    if (el) el.classList.toggle("hidden", advMode === "posting" || advMode === "event");
  }

  initSearchHeaders();
}

function visualPersonUrl(personId, mode = "single") {
  return `/visual?${new URLSearchParams({
    person_id: String(personId),
    mode,
    run: "1",
  })}`;
}

const PERSON_SEARCH_HEADERS = {
  c_name_chn: "姓名",
  c_alt_names: "別名",
  c_dynasty_chn: "朝代",
  c_index_addr_chn: "籍貫",
  c_personid: "人物ID",
};

const PLACE_SEARCH_HEADERS = {
  c_name_chn: "地名",
  c_alt_names: "別名",
  c_dynasty_chn: "朝代",
  c_parent_addr_chn: "上級行政區",
  c_child_addrs_chn: "下級行政區",
  c_firstyear: "起始年",
  c_lastyear: "終止年",
};

const TEXT_SEARCH_HEADERS = {
  c_title_chn: "文獻題名",
  c_title_alt_chn: "別名",
  c_responsible_persons: "責任者",
  c_text_cat_desc_chn: "書目分類",
  c_dynasty_chn: "朝代",
  _text_year: "成書時間",
  c_extant_desc_chn: "存佚",
};

function syncSearchTableLayout(type) {
  const table = document.getElementById("searchResultsTable");
  if (!table) return;
  table.classList.toggle("place-search-table", type === "place");
  table.classList.toggle("text-search-table", type === "text");
  table.classList.toggle("person-search-table", type === "person");
}

function initSearchHeaders() {
  const row = document.getElementById("searchHeadRow");
  if (!row) return;
  const type = currentSearchType;
  const cfg = SEARCH_CONFIG[type] || SEARCH_CONFIG.person;
  const L = (k) => fieldLabel("search", k);
  const headers = cfg.columns.map((c) => {
    if (type === "person" && PERSON_SEARCH_HEADERS[c]) return PERSON_SEARCH_HEADERS[c];
    if (type === "place" && PLACE_SEARCH_HEADERS[c]) return PLACE_SEARCH_HEADERS[c];
    if (type === "text" && TEXT_SEARCH_HEADERS[c]) return TEXT_SEARCH_HEADERS[c];
    if (c === "_years") return `${L("c_birthyear")}–${L("c_deathyear")}`;
    if (c === "_year_range") return `${L("c_firstyear")}–${L("c_lastyear")}`;
    if (c === "_event_years") return `${L("c_fy_yr")}–${L("c_ly_yr")}`;
    if (c === "_entity_action") return "操作";
    if (c === "_visual_action") return "圖譜";
    if (CODE_SEARCH_TYPES.has(type) && c === "c_code") return "代碼";
    return L(c);
  });
  row.innerHTML = `<th>#</th>${headers.map((h) => `<th>${h}</th>`).join("")}`;
  syncSearchTableLayout(type);
}

function switchView(view) {
  const target = view === "person" ? "person" : view === "home" ? "home" : "search";
  for (const name of ["home", "search", "person"]) {
    document.getElementById(`${name}View`)?.classList.toggle("active", name === target);
  }
  if (!document.getElementById(`${target}View`)) {
    if (target !== "search") switchView("search");
    return;
  }
  syncHeaderSearchChrome(target);
  if (target === "home") {
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

function hasSeenHome() {
  try {
    return localStorage.getItem(HOME_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markHomeSeen() {
  try {
    localStorage.setItem(HOME_SEEN_KEY, "1");
  } catch { /* ignore */ }
}

function resetAdvancedFilterInputs() {
  for (const id of [
    ...ADVANCED_FILTER_IDS,
    ...PLACE_ADVANCED_FILTER_IDS,
    ...TEXT_ADVANCED_FILTER_IDS,
  ]) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.tagName === "SELECT") el.selectedIndex = 0;
    else el.value = "";
  }
}

function clearSearchSessionState({ clearInput = true, clearNavStack = false } = {}) {
  cancelPendingSearch();
  searchSession += 1;
  searchAbort?.abort(new DOMException("已重置檢索", "AbortError"));

  lastSearchData = null;
  lastSearchQuery = "";
  lastSearchFingerprint = "";
  searchOffset = 0;
  searchTotal = 0;
  searchHasMore = false;

  if (clearNavStack) navStack = [];

  closeEntityPersons();
  document.getElementById("entityPersonsBody")?.replaceChildren();

  if (clearInput) {
    const searchInput = document.getElementById("searchInput");
    if (searchInput) searchInput.value = "";
  }

  document.getElementById("searchMeta")?.replaceChildren();
  document.getElementById("searchBody")?.replaceChildren();
  updateSearchPager(0, 0, 0, false);
}

function onSearchTypeChange() {
  clearSearchSessionState({ clearInput: true, clearNavStack: true });
  resetAdvancedFilterInputs();
  setAdvancedSearchOpen(false);
  updateSearchFormForType();
  updateAdvancedToggleChrome();
  syncSearchTableLayout(currentSearchType);
  updateSearchEmptyMeta(currentSearchType);
  renderNavChrome();
  if (getActiveView() === "person") {
    syncHeaderSearchChrome("person");
  }
}

function clearPersonViewUi() {
  setRelationsViewMode(false);
  try {
    globalThis.RelationsGraph?.destroy?.();
  } catch { /* ignore */ }
  relationsGraphLoadingEnd();
  const header = document.getElementById("personHeader");
  if (header) {
    header.classList.add("placeholder");
    header.innerHTML = "<p>選擇人物查看傳記模塊</p>";
  }
  document.getElementById("moduleNav")?.replaceChildren();
  ensureModuleTableVisible();
  const body = document.getElementById("moduleBody");
  if (body) body.innerHTML = '<tr><td colspan="3" class="empty">選擇模塊</td></tr>';
  document.getElementById("moduleHead")?.replaceChildren();
  document.getElementById("modulePager")?.classList.add("hidden");
  const detailHost = document.querySelector("#relationsGraphDetail .relations-graph-detail-inner");
  if (detailHost) detailHost.innerHTML = "";
}

function resetAppSessionForHome() {
  cancelPendingSearch();
  searchSession += 1;
  searchAbort?.abort(new DOMException("已返回首頁", "AbortError"));
  relationsGraphAbort?.abort(new DOMException("已返回首頁", "AbortError"));
  relationsGraphPrefetchCtrl?.abort(new DOMException("已返回首頁", "AbortError"));
  openPersonSeq += 1;

  selectedPersonId = null;
  currentPersonName = null;
  currentPersonExportName = null;
  moduleId = "basic";
  moduleOffset = 0;
  moduleTotal = 0;
  moduleCounts = {};
  relationsTab = "kinship";
  relationsOffsets.kinship = 0;
  relationsOffsets.association = 0;
  relationsGraphCenter = null;
  relationsGraphSelection = { kind: "none" };
  relationsGraphLoadSeq += 1;
  relationsGraphDataCache.clear();
  resetRelationsGraphFilters();

  entityContext = null;
  entityOffset = 0;
  entityTotal = 0;

  const searchTypeFilter = document.getElementById("searchTypeFilter");
  if (searchTypeFilter) searchTypeFilter.value = "person";
  currentSearchType = "person";
  const homeQuickInput = document.getElementById("homeQuickInput");
  if (homeQuickInput) homeQuickInput.value = "";

  clearSearchSessionState({ clearInput: true, clearNavStack: true });
  resetAdvancedFilterInputs();
  setAdvancedSearchOpen(false);
  updateSearchFormForType();
  updateAdvancedToggleChrome();
  initSearchHeaders();
  syncSearchTableLayout("person");
  updateSearchEmptyMeta("person");

  document.getElementById("entityPersonsTitle")?.replaceChildren();

  clearPersonViewUi();

  try {
    localStorage.removeItem(HOME_SEEN_KEY);
  } catch { /* ignore */ }

  if (globalThis.location.pathname === "/" && globalThis.location.search) {
    globalThis.history.replaceState(null, "", "/");
  }
}

function showHomeView() {
  resetAppSessionForHome();
  switchView("home");
  renderNavChrome();
}

function updateSearchEmptyMeta(type = currentSearchType) {
  const meta = document.getElementById("searchMeta");
  if (!meta || lastSearchData) return;
  meta.textContent = SEARCH_EMPTY_HINTS[type] || SEARCH_EMPTY_HINTS.person;
}

function submitHomeQuickSearch() {
  const q = document.getElementById("homeQuickInput")?.value?.trim() || "";
  enterSearchFromHome("person", { query: q, runQuery: Boolean(q), focusInput: !q });
}

async function submitHomeVisualSearch() {
  const q = document.getElementById("homeQuickInput")?.value?.trim() || "";
  if (!q) {
    globalThis.location.href = "/visual";
    return;
  }
  if (/^\d+$/.test(q)) {
    globalThis.location.href = visualPersonUrl(Number(q));
    return;
  }
  globalThis.location.href = `/visual?${new URLSearchParams({
    mode: "single",
    run: "1",
    q,
  })}`;
}

async function enterSearchFromHome(type, { query = "", runQuery = false, focusInput = true } = {}) {
  markHomeSeen();
  const sel = document.getElementById("searchTypeFilter");
  if (sel && type) sel.value = type;
  currentSearchType = type || currentSearchType;
  updateSearchFormForType();
  const input = document.getElementById("searchInput");
  const trimmed = query.trim();
  if (input) input.value = query;
  setAdvancedSearchOpen(false);
  switchView("search");
  updateSearchEmptyMeta(currentSearchType);
  renderNavChrome();
  if (runQuery && trimmed) {
    await runSearch(0, { query: trimmed });
  } else if (focusInput) {
    requestAnimationFrame(() => input?.focus());
  }
}

async function handleInitialRoute() {
  const params = new URLSearchParams(location.search);
  const forceHome = params.get("home") === "1";
  const type = params.get("type") || "";
  const q = params.get("q") || "";

  if (forceHome) {
    showHomeView();
    return;
  }
  if (type || q) {
    markHomeSeen();
    if (type) {
      const sel = document.getElementById("searchTypeFilter");
      if (sel) sel.value = type;
      currentSearchType = type;
    }
    const input = document.getElementById("searchInput");
    if (input && q) input.value = q;
    updateSearchFormForType();
    switchView("search");
    updateSearchEmptyMeta(currentSearchType);
    if (q.trim()) await runSearch(0);
    return;
  }
  if (!hasSeenHome()) {
    showHomeView();
    return;
  }
  switchView("search");
  updateSearchEmptyMeta(currentSearchType);
}

function renderStats(stats) {
  const html =
    `<div>${fmt(stats.person_count)} 人物</div><div style="opacity:.8;font-size:.72rem">${stats.view_count} 個視圖</div>`;
  const headerStats = document.getElementById("headerStats");
  if (headerStats) headerStats.innerHTML = html;
}

function bindHomeView() {
  document.getElementById("homeBrandBtn")?.addEventListener("click", () => showHomeView());
  document.querySelectorAll(".home-card[data-search-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      enterSearchFromHome(btn.dataset.searchType || "person");
    });
  });
  document.getElementById("homeMoreSearchBtn")?.addEventListener("click", () => {
    enterSearchFromHome(currentSearchType || "person", { focusInput: false });
    requestAnimationFrame(() => document.getElementById("searchTypeFilter")?.focus());
  });
  document.getElementById("homeQuickSearch")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitHomeQuickSearch();
  });
  document.getElementById("homeVisualSearchBtn")?.addEventListener("click", () => {
    submitHomeVisualSearch();
  });
}

function searchTypeLabel(type) {
  const sel = document.getElementById("searchTypeFilter");
  const opt = sel?.querySelector(`option[value="${CSS.escape(type || "person")}"]`);
  return opt?.textContent?.trim() || type || "人物";
}

function hasSearchSession() {
  return Boolean(lastSearchQuery || lastSearchData);
}

function renderSearchContextBar() {
  const textEl = document.getElementById("searchContextText");
  const badge = document.getElementById("searchContextFilterBadge");
  if (!textEl) return;
  const typeLabel = searchTypeLabel(currentSearchType);
  const q = lastSearchQuery || document.getElementById("searchInput")?.value?.trim() || "—";
  let summary = `檢索：${typeLabel} · 「${q}」`;
  if (lastSearchData?.total != null) {
    summary += ` · ${fmt(lastSearchData.total)} 條`;
  }
  textEl.textContent = summary;
  if (badge) {
    const filterCount = countActiveAdvancedFilters();
    badge.classList.toggle("hidden", filterCount === 0);
    badge.textContent = filterCount > 0 ? `+${filterCount} 篩選` : "";
  }
}

function findSearchFrameIndex() {
  const trail = [...navStack, captureCurrentFrame()];
  for (let i = trail.length - 2; i >= 0; i -= 1) {
    if (trail[i].view === "search") return i;
  }
  return -1;
}

async function returnToSearchForEdit() {
  const idx = findSearchFrameIndex();
  if (idx >= 0) {
    await navGoToIndex(idx);
    return;
  }
  setAdvancedSearchOpen(false);
  switchView("search");
  renderNavChrome();
}

function syncHeaderSearchChrome(view) {
  const isPerson = view === "person";
  const isHome = view === "home";
  const searchPanel = document.getElementById("searchPanel");
  const contextBar = document.getElementById("searchContextBar");
  const showContext = isPerson && hasSearchSession();

  document.body.classList.toggle("home-active", isHome);
  document.documentElement.classList.toggle("home-active-root", isHome);

  if (searchPanel) {
    searchPanel.classList.toggle("search-panel--hidden", isPerson || isHome);
    searchPanel.setAttribute("aria-hidden", isPerson || isHome ? "true" : "false");
  }
  if (contextBar) {
    contextBar.classList.toggle("hidden", !showContext);
    contextBar.setAttribute("aria-hidden", showContext ? "false" : "true");
  }
  if (showContext) renderSearchContextBar();

  if (isPerson) {
    requestAnimationFrame(() => {
      const header = document.getElementById("personHeader");
      if (header && !header.classList.contains("placeholder")) {
        header.setAttribute("tabindex", "-1");
        header.focus({ preventScroll: true });
      }
    });
  }
}

function getActiveView() {
  if (document.getElementById("personView")?.classList.contains("active")) return "person";
  if (document.getElementById("searchView")?.classList.contains("active")) return "search";
  if (document.getElementById("homeView")?.classList.contains("active")) return "home";
  return "search";
}

function captureCurrentFrame() {
  const entityPanel = document.getElementById("entityPersonsPanel");
  const frame = {
    view: getActiveView(),
    searchOffset,
    currentSearchType,
    entityPanelOpen: entityPanel ? !entityPanel.classList.contains("hidden") : false,
    entityContext: entityContext
      ? { entityType: entityContext.entityType, entityId: entityContext.entityId, entityOffset }
      : null,
  };
  if (selectedPersonId) {
    frame.personId = selectedPersonId;
    frame.personName = currentPersonName;
    frame.moduleId = moduleId;
    frame.moduleOffset = moduleOffset;
    if (moduleId === "relations") frame.relationsTab = relationsTab;
  }
  return frame;
}

function framesEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.view === b.view
    && a.personId === b.personId
    && a.moduleId === b.moduleId
    && a.moduleOffset === b.moduleOffset
    && (a.moduleId !== "relations" || a.relationsTab === b.relationsTab)
    && a.searchOffset === b.searchOffset
    && a.currentSearchType === b.currentSearchType
    && a.entityPanelOpen === b.entityPanelOpen
    && JSON.stringify(a.entityContext) === JSON.stringify(b.entityContext)
  );
}

function pushNavFrame() {
  if (navRestoring) return;
  const frame = captureCurrentFrame();
  const top = navStack[navStack.length - 1];
  if (framesEqual(top, frame)) return;
  navStack.push(frame);
  if (navStack.length > NAV_STACK_MAX) navStack.shift();
}

function frameLabel(f) {
  if (f.view === "person" && f.personId) {
    let label = f.personName || `人物 ${f.personId}`;
    if (f.moduleId === "relations") {
      label += ` · 人物關係 · ${relationsTabLabel(f.relationsTab || "kinship")}`;
    } else if (f.moduleId && f.moduleId !== "basic") {
      label += ` · ${MODULE_LABELS[f.moduleId] || f.moduleId}`;
    }
    if (f.entityPanelOpen) label += " · 相關人物";
    return label;
  }
  if (f.view === "search") {
    if (f.entityPanelOpen) return "檢索 · 相關人物";
    return lastSearchQuery ? `檢索 · ${lastSearchQuery}` : "檢索結果";
  }
  if (f.view === "home") return "首頁";
  if (f.personId) {
    return f.personName || `人物 ${f.personId}`;
  }
  return f.view;
}

function renderNavChrome() {
  const bar = document.getElementById("contextNav");
  if (!bar) return;
  const canBack = navStack.length > 0;
  bar.classList.toggle("hidden", !canBack);
  if (!canBack) return;

  const prev = navStack[navStack.length - 1];
  const backBtn = document.getElementById("navBackBtn");
  if (backBtn) backBtn.textContent = `← 返回${frameLabel(prev)}`;

  const trail = [...navStack, captureCurrentFrame()];
  const bc = document.getElementById("navBreadcrumb");
  if (!bc) return;
  bc.innerHTML = trail.map((f, i) => {
    const sep = i > 0 ? '<span class="bc-sep">›</span>' : "";
    const isLast = i === trail.length - 1;
    const cls = isLast ? "bc-current" : "bc-link";
    return `${sep}<button type="button" class="${cls}" data-bc-index="${i}">${escapeHtml(frameLabel(f))}</button>`;
  }).join("");
  bc.querySelectorAll(".bc-link").forEach((btn) => {
    btn.onclick = () => navGoToIndex(Number(btn.dataset.bcIndex));
  });
}

async function restoreFrame(frame) {
  if (frame.view === "browse" || frame.view === "queries") {
    await restoreFrame({ ...frame, view: "search" });
    return;
  }
  navRestoring = true;
  try {
    if (frame.view === "search") {
      setAdvancedSearchOpen(false);
      if (lastSearchQuery && (frame.searchOffset ?? 0) !== (lastSearchData?.offset ?? 0)) {
        await runSearch(frame.searchOffset ?? 0, { restoring: true });
        switchView("search");
      } else {
        switchView("search");
        searchOffset = frame.searchOffset ?? 0;
        if (lastSearchData) {
          currentSearchType = frame.currentSearchType || lastSearchData.type;
          searchTotal = lastSearchData.total;
          searchHasMore = !!lastSearchData.has_more;
          document.getElementById("searchMeta").textContent = formatSearchMeta(lastSearchData);
          renderSearch(
            lastSearchData.results,
            lastSearchData.offset,
            lastSearchData.total,
            currentSearchType,
            searchHasMore,
          );
        }
      }
      closeEntityPersons();
      if (frame.entityPanelOpen && frame.entityContext) {
        const ec = frame.entityContext;
        await openEntityPersons(ec.entityType, ec.entityId, "", ec.entityOffset ?? 0, { push: false });
      }
      return;
    }

    if (frame.personId) {
      closeEntityPersons();
      await openPerson(frame.personId, {
        push: false,
        moduleId: frame.moduleId || "basic",
        moduleOffset: frame.moduleOffset || 0,
        relationsTab: frame.relationsTab,
      });
      if (frame.entityPanelOpen && frame.entityContext) {
        const ec = frame.entityContext;
        await openEntityPersons(ec.entityType, ec.entityId, "", ec.entityOffset ?? 0, { push: false });
      }
    }
  } finally {
    navRestoring = false;
    renderNavChrome();
  }
}

async function navBack() {
  if (!navStack.length) return;
  const target = navStack[navStack.length - 1];
  const rollback = captureCurrentFrame();
  let popped = false;

  try {
    const run = async () => {
      navStack.pop();
      popped = true;
      await restoreFrame(target);
    };
    if (globalThis.CbdbLoading) {
      await CbdbLoading.withLoading(run, {
        message: "恢復瀏覽位置…",
        mode: "bar",
      });
    } else {
      await run();
    }
  } catch (err) {
    if (isBenignAbortError(err)) {
      if (popped) navStack.push(target);
      await restoreFrame(rollback);
      renderNavChrome();
      return;
    }
    if (popped) navStack.push(target);
    throw err;
  }
}

async function navGoToIndex(index) {
  const trail = [...navStack, captureCurrentFrame()];
  if (index < 0 || index >= trail.length - 1) return;
  const target = trail[index];
  const rollback = captureCurrentFrame();
  const prevStack = [...navStack];
  let stackApplied = false;

  try {
    const run = async () => {
      navStack = trail.slice(0, index);
      stackApplied = true;
      await restoreFrame(target);
    };
    if (globalThis.CbdbLoading) {
      await CbdbLoading.withLoading(run, {
        message: "恢復瀏覽位置…",
        mode: "bar",
      });
    } else {
      await run();
    }
  } catch (err) {
    if (isBenignAbortError(err)) {
      navStack = prevStack;
      await restoreFrame(rollback);
      renderNavChrome();
      return;
    }
    if (stackApplied) navStack = prevStack;
    throw err;
  }
}

function openPersonFromLink(personId, e) {
  if (e?.ctrlKey || e?.metaKey || e?.button === 1) return;
  const pid = Number(personId);
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (pid === selectedPersonId && getActiveView() === "person") return;
  pushNavFrame();
  openPerson(pid, { push: false, moduleId: "basic", moduleOffset: 0 }).catch((err) => {
    if (isUserLoadingCancel(err)) return;
    toast(err?.message || "無法打開人物", true);
  });
}

function navigateToView(view) {
  if (view !== "search") {
    switchView("search");
    renderNavChrome();
    return;
  }

  switchView("search");
  const q = document.getElementById("searchInput").value.trim();
  if (q) {
    runSearch(0, { fromNav: true });
  } else if (lastSearchData) {
    currentSearchType = lastSearchData.type || currentSearchType;
    searchOffset = lastSearchData.offset;
    searchTotal = lastSearchData.total;
    searchHasMore = !!lastSearchData.has_more;
    document.getElementById("searchMeta").textContent = formatSearchMeta(lastSearchData);
    renderSearch(
      lastSearchData.results,
      lastSearchData.offset,
      lastSearchData.total,
      lastSearchData.type,
      searchHasMore,
    );
    renderNavChrome();
  } else {
    renderNavChrome();
  }
}

function buildSearchUrl(q, offset = 0) {
  const useAdvanced = isAdvancedSearchActive();
  const advMode = useAdvanced ? document.getElementById("advancedMode")?.value : "";
  if (advMode === "posting") {
    const p = new URLSearchParams({ q, limit: String(pageSize), offset: String(offset) });
    const ymin = document.getElementById("advYearMin").value;
    const ymax = document.getElementById("advYearMax").value;
    const dy = document.getElementById("advDynastyFilter").value;
    if (ymin) p.set("year_min", ymin);
    if (ymax) p.set("year_max", ymax);
    if (dy) p.set("dynasty_code", dy);
    return `/api/search/persons-by-posting?${p}`;
  }
  if (advMode === "event") {
    const p = new URLSearchParams({ q, limit: String(pageSize), offset: String(offset) });
    const ymin = document.getElementById("advYearMin").value;
    const ymax = document.getElementById("advYearMax").value;
    if (ymin) p.set("year_min", ymin);
    if (ymax) p.set("year_max", ymax);
    return `/api/search/persons-by-event?${p}`;
  }

  const p = new URLSearchParams({ q, limit: String(pageSize), offset: String(offset) });
  const type = document.getElementById("searchTypeFilter").value;
  if (type && type !== "person") p.set("type", type);
  if (useAdvanced && type === "person") {
    const dy = document.getElementById("dynastyFilter").value;
    const bmin = document.getElementById("birthMin").value;
    const dmax = document.getElementById("deathMax").value;
    const female = document.getElementById("femaleFilter").value;
    const idxAddr = document.getElementById("indexAddrFilter").value.trim();
    if (dy) p.set("dynasty_code", dy);
    if (bmin) p.set("birth_min", bmin);
    if (dmax) p.set("death_max", dmax);
    if (female !== "") p.set("female", female);
    if (idxAddr) p.set("index_addr", idxAddr);
  }
  if (useAdvanced && type === "place") {
    const dy = document.getElementById("placeDynastyFilter").value;
    const fy = document.getElementById("placeFirstYear").value;
    const ly = document.getElementById("placeLastYear").value;
    if (dy) p.set("dynasty_code", dy);
    if (fy) p.set("firstyear", fy);
    if (ly) p.set("lastyear", ly);
  }
  if (useAdvanced && type === "text") {
    const rp = document.getElementById("textRelatedPersonFilter").value.trim();
    const dy = document.getElementById("textDynastyFilter").value;
    if (rp) p.set("related_person", rp);
    if (dy) p.set("dynasty_code", dy);
  }
  if (offset > 0) {
    p.set("defer_count", "false");
  }
  return `/api/search?${p}`;
}

function renderSearch(results, offset, total, searchType = currentSearchType, hasMore = false) {
  initSearchHeaders();
  const cfg = SEARCH_CONFIG[searchType] || SEARCH_CONFIG.person;
  const cols = cfg.columns;
  const colCount = cols.length + 1;
  const tb = document.getElementById("searchBody");
  tb.innerHTML = "";
  if (!results.length) {
    tb.innerHTML = `<tr><td colspan="${colCount}" class="empty">未找到匹配項</td></tr>`;
    updateSearchPager(offset, total, 0, false);
    return;
  }
  results.forEach((r, i) => {
    const tr = document.createElement("tr");
    const isPerson = (searchType === "person" || r.c_personid != null) && !cfg.entityType;
    tr.className = (isPerson ? "clickable" : "") + (r.c_personid === selectedPersonId ? " sel" : "");
    const cells = cols.map((col) => {
      if (col === "_entity_action" && cfg.entityType) {
        const ent = ENTITY_TYPES[cfg.entityType];
        const eid = r[ent.idCol];
        if (!eid) return `<td class="action-cell">—</td>`;
        return `<td class="action-cell"><button type="button" class="btn-link" data-entity-type="${cfg.entityType}" data-entity-id="${eid}">相關人物</button></td>`;
      }
      if (col === "_visual_action" && isPerson) {
        const pid = r.c_personid;
        if (!pid) return `<td class="action-cell">—</td>`;
        const href = visualPersonUrl(pid);
        return `<td class="action-cell"><a href="${href}" class="btn-link visual-row-link">可視化檢索</a></td>`;
      }
      const val = searchCellValue(r, col);
      if (isPerson && col === cfg.personLink) {
        const title = personSearchNameTitle(r);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        const pid = Number(r.c_personid);
        return `<td><button type="button" class="link han-text" data-person-id="${pid}"${titleAttr}>${escapeHtml(val)}</button></td>`;
      }
      const hanCols = new Set([
        "c_name_chn", "c_title_chn", "c_title_alt_chn", "c_alt_names",
        "c_parent_addr_chn", "c_child_addrs_chn", "c_index_addr_chn",
        "c_dynasty_chn", "c_text_type_desc_chn", "c_text_cat_desc_chn", "c_extant_desc_chn",
      ]);
      const hanClass = col.endsWith("_chn") || hanCols.has(col) ? " han-text" : "";
      return `<td${hanClass ? ` class="${hanClass.trim()}"` : ""}>${escapeHtml(val)}</td>`;
    });
    tr.innerHTML = `<td>${offset + i + 1}</td>` + cells.join("");
    if (isPerson && r.c_personid != null) {
      tr.dataset.personId = String(r.c_personid);
      tr.querySelectorAll(".link[data-person-id]").forEach((btn) => {
        btn.onclick = (ev) => {
          ev.stopPropagation();
          openPersonFromSearch(btn.dataset.personId, ev);
        };
      });
      tr.onclick = (ev) => {
        if (ev.target.closest(".visual-row-link")) return;
        if (ev.target.closest(".link[data-person-id]")) return;
        openPersonFromSearch(r.c_personid, ev);
      };
      tr.querySelectorAll(".visual-row-link").forEach((a) => {
        a.onclick = (ev) => ev.stopPropagation();
      });
    }
    tr.querySelectorAll("[data-entity-type]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openEntityPersons(btn.dataset.entityType, Number(btn.dataset.entityId), btn.closest("tr"));
      };
    });
    tb.appendChild(tr);
  });
  updateSearchPager(offset, total, results.length, hasMore);
}

async function openEntityPersons(entityType, entityId, labelHint = "", offset = 0, opts = {}) {
  const entityPanel = document.getElementById("entityPersonsPanel");
  const panelWasOpen = entityPanel && !entityPanel.classList.contains("hidden");
  const sameEntity = entityContext
    && entityContext.entityType === entityType
    && entityContext.entityId === entityId;
  if (opts.push !== false && !navRestoring && (!panelWasOpen || !sameEntity)) {
    pushNavFrame();
  }
  entityContext = { entityType, entityId, labelHint };
  entityOffset = offset;
  if (getActiveView() !== "search") switchView("search");
  if (entityPanel) entityPanel.classList.remove("hidden");
  document.getElementById("entityPersonsTitle").textContent =
    `相關人物 · ${entityType} #${entityId}`;
  try {
    const data = await api(
      `/api/entity/${entityType}/${entityId}/persons?limit=${pageSize}&offset=${offset}`,
      {
        timeout: 30000,
        loading: { message: "載入相關人物…", mode: "bar" },
      },
    );
    entityTotal = data.total;
    const tb = document.getElementById("entityPersonsBody");
    tb.innerHTML = "";
    if (!data.results.length) {
      tb.innerHTML = `<tr><td colspan="5" class="empty">無相關人物</td></tr>`;
    } else {
      data.results.forEach((r, i) => {
        const years = [r.c_birthyear, r.c_deathyear].filter(Boolean).join("–") || "—";
        const rel = r.relation || r.c_office_chn || r.detail || r.c_event_name_chn || r.c_title_chn || "—";
        const tr = document.createElement("tr");
        tr.className = "clickable";
        tr.innerHTML = `
          <td>${offset + i + 1}</td>
          <td><button type="button" class="link han-text"${personSearchNameTitle(r) ? ` title="${escapeHtml(personSearchNameTitle(r))}"` : ""}>${escapeHtml(formatPersonSearchName(r))}</button></td>
          <td>${escapeHtml(r.c_dynasty_chn || "—")}</td>
          <td>${escapeHtml(years)}</td>
          <td>${escapeHtml(String(rel))}</td>`;
        const btn = tr.querySelector(".link");
        btn.onclick = (e) => { e.stopPropagation(); openPersonFromLink(r.c_personid, e); };
        tr.onclick = (e) => openPersonFromLink(r.c_personid, e);
        tb.appendChild(tr);
      });
    }
    updatePager("entityPager", offset, entityTotal, data.results.length);
    renderNavChrome();
  } catch (e) {
    if (isBenignAbortError(e)) return;
    toast(e.message || "載入相關人物失敗", true);
  }
}

function closeEntityPersons() {
  entityContext = null;
  document.getElementById("entityPersonsPanel")?.classList.add("hidden");
  renderNavChrome();
}

async function openPersonFromSearch(personId, e) {
  if (e?.ctrlKey || e?.metaKey || e?.button === 1) return;
  const pid = Number(personId);
  if (!Number.isFinite(pid) || pid <= 0) {
    toast("無效的人物編號", true);
    return;
  }
  if (getActiveView() === "search") {
    pushNavFrame();
  }
  try {
    await openPerson(pid, { push: false, moduleId: "basic", moduleOffset: 0 });
  } catch (err) {
    if (isUserLoadingCancel(err)) return;
    if (err?.message) toast(err.message, true);
  }
}

function cancelPendingSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = null;
  searchSession += 1;
  searchAbort?.abort(new DOMException("已離開檢索", "AbortError"));
}

function debouncedRunSearch(offset = 0, opts = {}) {
  if (offset !== 0 || opts.restoring || opts.fromNav || opts.immediate) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
    return runSearch(offset, opts);
  }
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    runSearch(offset, opts);
  }, SEARCH_DEBOUNCE_MS);
}

async function runSearch(offset = 0, opts = {}) {
  const session = ++searchSession;
  const input = document.getElementById("searchInput");
  if (opts.query != null && input) input.value = String(opts.query);
  const q = (input?.value || "").trim();
  if (!q) {
    if (!opts.fromNav && !opts.restoring) toast("請輸入檢索關鍵詞", true);
    return;
  }
  currentSearchType = document.getElementById("searchTypeFilter").value;
  const fp = searchFingerprint();
  if (
    offset === 0
    && fp !== lastSearchFingerprint
    && !opts.restoring
    && getActiveView() !== "person"
  ) {
    navStack = [];
  }

  searchOffset = offset;
  if (!opts.restoring) closeEntityPersons();
  searchAbort?.abort(new DOMException("新的檢索請求", "AbortError"));
  const ctrl = new AbortController();
  searchAbort = ctrl;
  try {
    const data = await api(buildSearchUrl(q, offset), {
      timeout: 30000,
      loading: { message: "檢索中…", mode: "bar" },
      signal: ctrl.signal,
    });
    if (session !== searchSession || ctrl.signal.aborted) return;
    if (offset === 0 && !opts.restoring) {
      lastSearchFingerprint = fp;
      lastSearchQuery = q;
    }
    searchTotal = data.total;
    searchHasMore = !!data.has_more;
    currentSearchType = data.type || document.getElementById("searchTypeFilter").value;
    if (data.mode === "posting" || data.mode === "event") currentSearchType = "person";
    document.getElementById("searchMeta").textContent = formatSearchMeta(data);
    lastSearchData = {
      results: data.results,
      total: data.total,
      has_more: searchHasMore,
      offset,
      type: currentSearchType,
      mode: data.mode,
    };
    renderSearch(data.results, offset, data.total, currentSearchType, searchHasMore);
    if (!opts.restoring && session === searchSession) switchView("search");
    renderSearchContextBar();
    renderNavChrome();
  } catch (e) {
    if (isUserLoadingCancel(e)) {
      if (opts.restoring) throw e;
      return;
    }
    if (isBenignAbortError(e)) return;
    toast(e.message || "檢索失敗", true);
  }
}

function renderModuleNav() {
  const nav = document.getElementById("moduleNav");
  nav.innerHTML = "";

  const appendModuleButton = (parent, id, label, key) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "module-item" + (id === moduleId ? " active" : "");
    const count = key === "relations"
      ? relationsModuleCount()
      : (key ? moduleCounts[key] : null);
    btn.innerHTML = `<span>${label}</span>${count != null ? `<span class="badge">${count}</span>` : ""}`;
    btn.onclick = () => loadModule(id);
    parent.appendChild(btn);
    return btn;
  };

  for (const [id, label, key] of PRIMARY_NAV_MODULES) {
    appendModuleButton(nav, id, label, key);
  }
}

function renderBasic(person, altnames = []) {
  ensureModuleTableVisible();
  document.getElementById("moduleTitle").textContent = "基本資料";
  renderRelationsTabs();
  document.getElementById("moduleCount").textContent = "";
  document.getElementById("modulePager").classList.add("hidden");
  document.getElementById("moduleTable").classList.add("kv-mode");
  document.getElementById("moduleHead").innerHTML = "<tr><th>#</th><th>欄位</th><th>內容</th></tr>";
  const rows = [
    { label: fieldLabel("basic", "c_personid"), value: person.c_personid },
    { label: "姓名", value: formatBasicPersonName(person) },
  ];
  for (const alt of altnames) {
    rows.push({
      label: alt.c_name_type_desc_chn || fieldLabel("altname", "c_name_type_desc_chn"),
      value: formatAltnameDisplay(alt),
    });
  }
  rows.push(
    { label: fieldLabel("basic", "c_dynasty_chn"), value: person.c_dynasty_chn },
    { label: fieldLabel("basic", "c_index_addr_chn"), value: person.c_index_addr_chn },
    { label: fieldLabel("basic", "c_choronym_desc_chn"), value: person.c_choronym_desc_chn },
    { label: fieldLabel("basic", "c_birthyear"), value: formatBasicYearDisplay(person, "birth") },
    { label: fieldLabel("basic", "c_deathyear"), value: formatBasicYearDisplay(person, "death") },
  );
  const indexSource = formatSourceDisplay(person, "basic");
  if (indexSource !== "—") {
    rows.push({ label: "參考文獻", value: indexSource });
  }
  document.getElementById("moduleBody").innerHTML = rows.map((row, i) =>
    `<tr><td>${i + 1}</td><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value ?? "—")}</td></tr>`
  ).join("");
}

function renderModuleRows(rows, offset, total, columns, moduleKey) {
  ensureModuleTableVisible();
  document.getElementById("moduleTable").classList.remove("kv-mode");
  document.getElementById("moduleCount").textContent = total ? `共 ${total} 條` : "";
  const displayCols = columns.slice(1).filter((c) => !HIDDEN_MODULE_COLS.has(c));
  const head = document.getElementById("moduleHead");
  head.innerHTML = `<tr><th>#</th>${displayCols.map((c) =>
    `<th>${fieldLabel(moduleKey, c)}</th>`
  ).join("")}</tr>`;
  const body = document.getElementById("moduleBody");
  body.innerHTML = "";
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${displayCols.length + 1}" class="empty">本模塊暫無記錄</td></tr>`;
    updatePager("modulePager", offset, total, 0);
    return;
  }
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    const cells = displayCols.map((col) => {
      if (col === "_source") return renderModuleCell(moduleKey, row, col, null);
      const v = row[col];
      return renderModuleCell(moduleKey, row, col, v);
    });
    tr.innerHTML = `<td>${offset + i + 1}</td>` + cells.map((c) => `<td>${c}</td>`).join("");
    tr.querySelectorAll("[data-person-id]").forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); openPersonFromLink(Number(btn.dataset.personId), e); };
    });
    tr.querySelectorAll("[data-entity-type]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openEntityPersons(btn.dataset.entityType, Number(btn.dataset.entityId), "", 0, { push: true });
      };
    });
    body.appendChild(tr);
  });
  updatePager("modulePager", offset, total, rows.length);
}

const MODULE_COLUMNS = {
  kinship: ["#", "c_kinrel_chn", "c_kin_chn", "c_addr_chn", "_source", "c_kin_id"],
  posting: ["#", "c_office_chn", "c_firstyear", "c_lastyear", "c_posting_places", "_source", "c_office_id"],
  entry: ["#", "c_entry_desc_chn", "c_year", "c_exam_rank", "_source"],
  association: ["#", "c_link_chn", "c_node_chn", "c_assoc_first_year", "c_occasion_desc_chn", "_source", "c_node_id"],
  biog_address: ["#", "c_addr_desc_chn", "c_addr_chn", "c_firstyear", "c_lastyear", "_source", "c_addr_id"],
  people_addr: ["#", "c_index_addr_chn", "c_index_addr_type_chn", "c_index_year", "_source", "c_index_addr_id"],
  text_role: ["#", "c_title_chn", "c_role_desc_chn", "c_year", "_source", "c_textid"],
  biog_source: ["#", "c_title_chn", "c_title", "c_main_source", "_source", "c_hyperlink"],
  status: ["#", "c_status_desc_chn", "c_firstyear", "c_lastyear", "_source"],
  institution: ["#", "c_inst_name_hz", "c_bi_role_chn", "c_inst_addr_chn", "c_inst_addr_type_chn", "c_bi_begin_year", "c_bi_end_year", "_source", "c_inst_name_code"],
  event: ["#", "c_event_name_chn", "c_role", "c_event_addr_chn", "c_year", "c_nianhao_chn", "_source", "c_event_code", "c_addr_id"],
  possessions: ["#", "c_possession_act_desc_chn", "c_possession_desc_chn", "c_possession_addr_chn", "c_quantity", "c_possession_yr", "_source", "c_addr_id"],
};

const MODULE_LABELS = {
  relations: "人物關係",
  kinship: "親屬", posting: "任官",
  entry: "入仕", association: "社會關係", biog_address: "傳記地址",
  text_role: "著述", biog_source: "資料出處",
  status: "社會身份", institution: "社會機構",
  event: "生平事件",
  possessions: "財產",
};

async function loadModule(id, offset = 0, opts = {}) {
  let labelId = id;
  if (labelId === "kinship" || labelId === "association" || labelId === "graph") {
    labelId = "relations";
  }
  labelId = normalizeModuleId(labelId);
  const loadingLabel = MODULE_LABELS[labelId] || (labelId === "relations" ? "人物關係" : labelId);
  const graphTabLoad = labelId === "relations" && (id === "graph" || relationsTab === "graph");

  const run = async () => {
    if (id === "kinship" || id === "association" || id === "graph") {
      relationsTab = id === "graph" ? "graph" : id;
      id = "relations";
    }
    id = normalizeModuleId(id);
    moduleId = id;
    moduleOffset = offset;
    if (id === "relations" && relationsTab !== "graph") relationsOffsets[relationsTab] = offset;
    renderModuleNav();
    renderRelationsTabs();
    if (!selectedPersonId) return;
    if (id !== "relations" || relationsTab !== "graph") {
      showModuleLoadingPlaceholder();
    }
    try {
      if (id === "basic") {
        setRelationsViewMode(false);
        const data = await api(`/api/person/${selectedPersonId}/module/basic?format=display`);
        renderDisplayBasic(data);
        renderNavChrome();
        return;
      }
      if (id === "relations" && relationsTab === "graph") {
        document.getElementById("moduleTitle").textContent = "人物關係";
        setRelationsViewMode(true);
        await loadRelationsGraph();
        renderNavChrome();
        return;
      }
      setRelationsViewMode(false);
      const dataModule = id === "relations" ? relationsTab : id;
      document.getElementById("moduleTitle").textContent = id === "relations"
        ? "人物關係"
        : (MODULE_LABELS[id] || id);
      const data = await api(
        `/api/person/${selectedPersonId}/module/${dataModule}?format=display&limit=${pageSize}&offset=${offset}`
      );
      moduleTotal = data.total;
      renderDisplayTable(data);
      renderNavChrome();
      if (id === "relations" && relationsTab !== "graph") {
        warmRelationsGraph(selectedPersonId);
      }
    } catch (err) {
      if (isBenignAbortError(err)) return;
      ensureModuleTableVisible();
      const body = document.getElementById("moduleBody");
      const cols = document.getElementById("moduleTable")?.classList.contains("kv-mode") ? 3 : 4;
      if (body) {
        body.innerHTML = `<tr><td colspan="${cols}" class="empty">${escapeHtml(err?.message || "模塊載入失敗")}</td></tr>`;
      }
      toast(err?.message || "模塊載入失敗", true);
      throw err;
    }
  };

  if (opts.skipGlobalLoading || graphTabLoad || !globalThis.CbdbLoading) {
    return run();
  }
  return CbdbLoading.withLoading(run, { message: `載入${loadingLabel}…`, mode: "bar" });
}

function renderPersonHeader(p) {
  const header = document.getElementById("personHeader");
  header.classList.remove("placeholder");
  const name = escapeHtml(formatPersonSearchName(p));
  const nameTitle = personSearchNameTitle(p);
  header.innerHTML = `
    <div class="person-header-top">
      <h2${nameTitle ? ` title="${escapeHtml(nameTitle)}"` : ""}>${name}</h2>
      <button type="button" id="exportPersonBtn" class="btn sm">導出信息</button>
    </div>`;
  document.getElementById("exportPersonBtn").onclick = () => exportCurrentPerson();
}

async function exportCurrentPerson() {
  if (!selectedPersonId) return;
  const btn = document.getElementById("exportPersonBtn");
  const run = async () => {
    const res = await fetch(`/api/person/${selectedPersonId}/export`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error("導出接口不可用，請關閉並重新啟動 CBDB Atlas 後再試");
      }
      const text = await res.text();
      throw new Error(text || "導出失敗");
    }
    const blob = await res.blob();
    let filename = buildExportFilenameFallback();
    const cd = res.headers.get("Content-Disposition");
    if (cd) {
      const match = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (match) filename = decodeURIComponent(match[1]);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("導出完成");
  };

  if (btn) btn.disabled = true;
  try {
    if (globalThis.CbdbLoading) {
      await CbdbLoading.withLoading(run, { message: "導出中…", mode: "bar" });
    } else {
      toast("正在導出…");
      await run();
    }
  } catch (e) {
    toast(e.message || "導出失敗", true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function buildExportFilenameFallback() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日${now.getHours()}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `CBDB_人物_${currentPersonExportName || currentPersonName || "未知"}_${ts}.xlsx`;
}

async function openPerson(id, opts = {}) {
  cancelPendingSearch();
  const seq = ++openPersonSeq;
  const stale = () => seq !== openPersonSeq;

  const previousPersonId = selectedPersonId;
  if (previousPersonId != null && previousPersonId !== id) {
    resetRelationsGraphFilters();
    pruneRelationsGraphCache(id);
    relationsGraphPrefetchCtrl?.abort(new DOMException("已切換人物", "AbortError"));
  }

  if (opts.push !== false && !navRestoring) {
    pushNavFrame();
  }

  selectedPersonId = id;
  moduleId = opts.moduleId ?? "basic";
  if (moduleId === "kinship" || moduleId === "association" || moduleId === "graph") {
    relationsTab = moduleId === "graph" ? "graph" : moduleId;
    moduleId = "relations";
  } else if (opts.relationsTab) {
    relationsTab = opts.relationsTab;
  }
  moduleId = normalizeModuleId(moduleId);
  moduleOffset = opts.moduleOffset ?? 0;
  if (moduleId === "relations") {
    relationsOffsets[relationsTab] = moduleOffset;
  }

  switchView("person");
  if (moduleId === "relations" && relationsTab === "graph") {
    setRelationsViewMode(true);
    ensureRelationsGraphDefaults();
  } else {
    showModuleLoadingPlaceholder();
  }
  const header = document.getElementById("personHeader");
  if (header) {
    header.classList.add("placeholder");
    header.innerHTML = "<p>載入人物…</p>";
  }

  const personCtrl = new AbortController();

  try {
    let data = getCachedPerson(id);
    if (!data) {
      const fetchPerson = async () => {
        data = await api(`/api/person/${id}`, {
          signal: personCtrl.signal,
          timeout: 45000,
        });
        setCachedPerson(id, data);
      };
      try {
        if (globalThis.CbdbLoading) {
          await CbdbLoading.withLoading(fetchPerson, { message: "載入人物…", mode: "bar" });
        } else {
          await fetchPerson();
        }
      } catch (err) {
        if (stale()) return;
        if (isUserLoadingCancel(err)) {
          if (navRestoring) throw err;
          return;
        }
        if (isBenignAbortError(err)) return;
        selectedPersonId = null;
        if (navStack.length && !navRestoring) navStack.pop();
        switchView("search");
        renderNavChrome();
        throw new Error(err?.message || "無法載入人物");
      }
    }

    if (stale()) return;

    moduleCounts = data.module_counts || {};
    const p = data.person;
    if (!p) {
      if (stale()) return;
      selectedPersonId = null;
      if (navStack.length && !navRestoring) navStack.pop();
      switchView("search");
      renderNavChrome();
      throw new Error("人物不存在");
    }
    if (data.merged_from) {
      toast(`人物編號 ${data.merged_from} 已合併至 ${p.c_personid}`);
      selectedPersonId = p.c_personid;
    }
    currentPersonName = hanzi().composeChineseName(p) || p.c_name || String(p.c_personid);
    currentPersonExportName = formatBasicPersonName(p);

    renderPersonHeader(p);
    renderModuleNav();
    if (!data.module_counts) {
      loadPersonModuleCounts(p.c_personid, { signal: personCtrl.signal, stale });
    } else if (relationsModuleCount() > 0) {
      warmRelationsGraph(p.c_personid);
    }

    try {
      await loadModule(moduleId, moduleOffset, { skipGlobalLoading: false });
    } catch {
      if (stale()) return;
      renderNavChrome();
      renderSearchContextBar();
      return;
    }

    if (stale()) return;

    document.querySelectorAll("#searchBody tr").forEach((tr) => {
      tr.classList.toggle("sel", tr.dataset.personId === String(p.c_personid));
    });
    renderNavChrome();
    renderSearchContextBar();
  } catch (err) {
    if (stale()) return;
    if (isUserLoadingCancel(err) && navRestoring) throw err;
    if (err?.message) throw err;
  }
}

function fmtGregorianYear(y) {
  const n = Number(y);
  if (!Number.isFinite(n) || n === 0 || n === -1 || n === -9999) return "";
  if (n < 0) return `前${Math.abs(n)}`;
  return String(n);
}

function fmtYear(y) {
  return fmtGregorianYear(y);
}

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function toChineseYearNumber(n) {
  const num = Math.floor(Number(n));
  if (!num || num <= 0) return "";
  if (num < 10) return CN_DIGITS[num];
  if (num === 10) return "十";
  if (num < 20) return `十${CN_DIGITS[num - 10]}`;
  if (num < 100) {
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    let s = tens === 1 ? "十" : `${CN_DIGITS[tens]}十`;
    if (ones) s += CN_DIGITS[ones];
    return s;
  }
  if (num < 1000) {
    const hundreds = Math.floor(num / 100);
    const rest = num % 100;
    let s = `${CN_DIGITS[hundreds]}百`;
    if (rest === 0) return s;
    if (rest < 10) return `${s}零${CN_DIGITS[rest]}`;
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    s += tens === 1 ? "十" : `${CN_DIGITS[tens]}十`;
    if (ones) s += CN_DIGITS[ones];
    return s;
  }
  return String(num);
}

function fmtReignYear(n) {
  const num = Number(n);
  if (!num || num <= 0) return "";
  return num === 1 ? "元年" : `${toChineseYearNumber(num)}年`;
}

function formatBasicPersonName(person) {
  const chn = hanzi().composeChineseName(person);
  const name = String(person.c_name || "").trim();
  if (chn && name && chn !== name) return `${chn}（${name}）`;
  return chn || name || "—";
}

function validNianhaoLabel(s) {
  const t = String(s || "").trim();
  return t && t !== "未詳" && t !== "不详";
}

function validDynastyLabel(s) {
  const t = String(s || "").trim();
  return t && t !== "未詳" && t !== "不详";
}

function formatTextYearDisplay(row) {
  const nh = validNianhaoLabel(row.c_nianhao_chn) ? String(row.c_nianhao_chn).trim() : "";
  const nhYear = fmtReignYear(row.c_text_nh_year);
  const range = String(row.c_range_chn || "").trim();
  const greg = fmtGregorianYear(row.c_text_year);
  let nianhao = nh;
  if (nh && nhYear) nianhao = nh + nhYear;
  else if (nhYear && !nh) nianhao = nhYear;
  if (nianhao && range) nianhao += range;
  let text = nianhao;
  if (greg) text = text ? `${text}（${greg}）` : greg;
  return text || "—";
}

function formatYearDisplay(row, opts) {
  const {
    gregKey,
    dynastyKey = "c_dynasty_chn",
    nhKey,
    nhYearKey,
    rangeKey,
  } = opts;
  const dynasty = validDynastyLabel(row[dynastyKey]) ? String(row[dynastyKey]).trim() : "";
  const nhRaw = String(row[nhKey] || "").trim();
  const nh = validNianhaoLabel(nhRaw) ? nhRaw : "";
  const nhYear = fmtReignYear(row[nhYearKey]);
  const range = String(row[rangeKey] || "").trim();
  const greg = fmtGregorianYear(row[gregKey]);

  let nianhao = nh;
  if (nh && nhYear) nianhao = nh + nhYear;
  else if (nhYear && !nh) nianhao = nhYear;
  if (nianhao && range) nianhao += range;

  const prefix = dynasty;
  let text = "";
  if (prefix && nianhao) text = prefix + nianhao;
  else if (prefix) text = prefix;
  else if (nianhao) text = nianhao;

  if (greg) text += `（${greg}）`;
  if (text) return text;
  const raw = Number(row[gregKey]);
  if (Number.isFinite(raw) && raw > 0) return String(raw);
  return "—";
}

function formatBasicYearDisplay(person, kind) {
  const isBirth = kind === "birth";
  const prefix = isBirth ? "by" : "dy";
  return formatYearDisplay(person, {
    gregKey: isBirth ? "c_birthyear" : "c_deathyear",
    dynastyKey: isBirth ? "c_by_dynasty_chn" : "c_dy_nh_dynasty_chn",
    nhKey: `c_${prefix}_nh_chn`,
    nhYearKey: `c_${prefix}_nh_year`,
    rangeKey: `c_${prefix}_range_chn`,
  });
}

function formatEntryYearDisplay(row) {
  return formatYearDisplay(row, {
    gregKey: "c_year",
    nhKey: "c_nianhao_chn",
    nhYearKey: "c_entry_nh_year",
    rangeKey: "c_range_chn",
  });
}

function formatAssociationFirstYearDisplay(row) {
  return formatYearDisplay(row, {
    gregKey: "c_assoc_first_year",
    nhKey: "c_assoc_fy_nh_chn",
    nhYearKey: "c_assoc_fy_nh_year",
    rangeKey: "c_range_chn",
  });
}

function formatPostingFirstYearDisplay(row) {
  return formatYearDisplay(row, {
    gregKey: "c_firstyear",
    nhKey: "c_fy_nh_chn",
    nhYearKey: "c_fy_nh_year",
    rangeKey: "c_fy_range_chn",
  });
}

function formatPostingLastYearDisplay(row) {
  return formatYearDisplay(row, {
    gregKey: "c_lastyear",
    nhKey: "c_ly_nh_chn",
    nhYearKey: "c_ly_nh_year",
    rangeKey: "c_ly_range_chn",
  });
}

function dynastyLabel(d) {
  const y0 = fmtYear(d.start_year);
  const y1 = fmtYear(d.end_year);
  const range = y0 && y1 ? ` ${y0}–${y1}` : "";
  return `${d.label_chn}${range}（${fmt(d.person_count)}）`;
}

function renderDynasties(list) {
  for (const selId of ["dynastyFilter", "advDynastyFilter", "placeDynastyFilter", "textDynastyFilter"]) {
    const sel = document.getElementById(selId);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = '<option value="">不限</option>';
    for (const d of list) {
      const opt = document.createElement("option");
      opt.value = String(d.code);
      opt.textContent = dynastyLabel(d);
      sel.appendChild(opt);
    }
    if (cur) sel.value = cur;
  }
}

function showUpdateModal(status) {
  const modal = document.getElementById("updateModal");
  const text = document.getElementById("updateModalText");
  const remote = status.remote;
  const local = status.local || {};
  if (status.needs_download) {
    text.textContent = `尚未安裝 CBDB 源庫。官方最新版本：${remote?.generated_at_utc || "未知"}。是否下載？`;
  } else {
    text.textContent = `檢測到新版本（${remote?.generated_at_utc}），當前本地：${local.manifest?.generated_at_utc || "未知"}。`;
  }
  modal.classList.remove("hidden");
}

async function boot() {
  let health = { ready: false };
  try {
    health = await api("/api/health");
    if (!health.ready) {
      document.getElementById("apiBanner").textContent = health.error || "CBDB 源庫未就緒，請更新數據或放入 data/source/cbdb.sqlite3";
      document.getElementById("apiBanner").classList.remove("hidden");
    }
  } catch {
    const banner = document.getElementById("apiBanner");
    banner.innerHTML =
      "本地服務未運行。請雙擊項目中的 <strong>start_cbdb_atlas.bat</strong>（會自動啟動並打開本頁），不要直接打開書籤。";
    banner.classList.remove("hidden");
    return;
  }

  try {
    const status = await api("/api/source/status");
    if (status.update_available && !status.update_in_progress) showUpdateModal(status);
  } catch { /* 更新檢查失敗不影響檢索 */ }

  if (health.ready) {
    try {
      const stats = await api("/api/stats");
      document.getElementById("headerStats").innerHTML =
        `<div>${fmt(stats.person_count)} 人物</div><div style="opacity:.8;font-size:.72rem">${stats.view_count} 個視圖</div>`;
    } catch { /* 統計加載失敗不影響檢索 */ }
    try {
      const dyn = await api("/api/schema/dynasties");
      renderDynasties(dyn.dynasties || []);
    } catch {
      toast("朝代列表加載失敗", true);
    }
  }
}

function bindSearchResultClicks() {
  const tb = document.getElementById("searchBody");
  if (!tb || tb.dataset.clickBound === "1") return;
  tb.dataset.clickBound = "1";
  tb.addEventListener("click", (e) => {
    if (e.target.closest(".visual-row-link")) return;
    const link = e.target.closest(".link[data-person-id]");
    if (link) {
      e.preventDefault();
      openPersonFromSearch(link.dataset.personId, e);
      return;
    }
    const row = e.target.closest("tr[data-person-id]");
    if (row && !e.target.closest("button, a")) {
      openPersonFromSearch(row.dataset.personId, e);
    }
  });
}

function bindKeywordEnterSubmit(input, onSubmit) {
  if (!input) return;
  let composing = false;
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.defaultPrevented) return;
    if (composing || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    onSubmit();
  });
}

function bindSearchFormEnter() {
  const form = document.getElementById("searchForm");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    debouncedRunSearch(0);
  });
  bindKeywordEnterSubmit(document.getElementById("searchInput"), () => debouncedRunSearch(0));
  bindKeywordEnterSubmit(document.getElementById("homeQuickInput"), () => {
    document.getElementById("homeQuickSearch")?.requestSubmit();
  });
}
document.getElementById("searchTypeFilter").onchange = onSearchTypeChange;
document.getElementById("advancedMode")?.addEventListener("change", () => updateSearchFormForType());
document.getElementById("advancedToggleBtn").onclick = () => {
  setAdvancedSearchOpen(!searchAdvancedOpen, { userToggle: true });
};
document.getElementById("entityPersonsClose").onclick = closeEntityPersons;
document.getElementById("navBackBtn")?.addEventListener("click", () => navBack());

document.addEventListener("cbdb:loading-cancelled", () => {
  searchSession += 1;
  searchAbort?.abort(new DOMException("已取消載入", "AbortError"));
});

document.getElementById("updateNowBtn").onclick = async () => {
  document.getElementById("updateProgress").classList.remove("hidden");
  document.getElementById("updateActions").classList.add("hidden");
  await fetch("/api/source/update", { method: "POST" });
  const poll = setInterval(async () => {
    const s = await api("/api/source/status", 30000);
    document.getElementById("updateProgressText").textContent = s.update_message || "更新中…";
    if (!s.update_in_progress) {
      clearInterval(poll);
      if (s.update_error) toast(s.update_error, true);
      else { document.getElementById("updateModal").classList.add("hidden"); location.reload(); }
    }
  }, 2000);
};
document.getElementById("updateDismissBtn").onclick = async () => {
  const s = await api("/api/source/status");
  await fetch("/api/source/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remote_sha256: s.remote?.sha256 }),
  });
  document.getElementById("updateModal").classList.add("hidden");
};

function bindSearchContextBar() {
  document.getElementById("searchContextSummaryBtn")?.addEventListener("click", () => returnToSearchForEdit());
  document.getElementById("searchContextEditBtn")?.addEventListener("click", () => returnToSearchForEdit());
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (getActiveView() === "person" && navStack.length > 0) {
    e.preventDefault();
    navBack();
  }
});

boot().then(() => handleInitialRoute());
bindPagerControls();
bindSearchFormEnter();
bindSearchResultClicks();
bindSearchResultsScrollCollapse();
bindAdvancedFilterListeners();
bindRelationsGraphToolbar();
bindSearchContextBar();
bindHomeView();
updateSearchFormForType();
updateAdvancedToggleChrome();
syncHeaderSearchChrome(getActiveView());
