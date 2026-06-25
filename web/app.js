const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];
const PAGE_SIZE_STORAGE_KEY = "cbdbPageSize";

function loadPageSize() {
  const stored = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
  return PAGE_SIZE_OPTIONS.includes(stored) ? stored : PAGE_SIZE_OPTIONS[0];
}

let pageSize = loadPageSize();

let selectedPersonId = null;
let searchOffset = 0;
let searchTotal = 0;
let moduleId = "basic";
let moduleOffset = 0;
let moduleTotal = 0;
let moduleCounts = {};
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

function isAdvancedSearchActive() {
  return searchAdvancedOpen;
}

function setAdvancedSearchOpen(open) {
  if (open === searchAdvancedOpen) return;
  searchAdvancedOpen = open;
  const panel = document.getElementById("advancedSearchPanel");
  const btn = document.getElementById("advancedToggleBtn");
  if (panel) {
    panel.classList.toggle("is-open", open);
    panel.classList.toggle("is-collapsed", !open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
  }
  if (btn) {
    btn.textContent = open ? "收起" : "高級檢索";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.classList.toggle("active", open);
  }
  updateSearchFormForType();
}

/** 僅收起高級檢索面板，不清除已填寫的篩選條件 */
function collapseAdvancedSearchPreserveValues() {
  if (!searchAdvancedOpen) return;
  setAdvancedSearchOpen(false);
}

function bindSearchResultsScrollCollapse() {
  let lastY = window.scrollY;
  let collapseScheduled = false;
  const onScroll = () => {
    if (getActiveView() !== "search" || !searchAdvancedOpen) {
      lastY = window.scrollY;
      return;
    }
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 8 || collapseScheduled) return;
    lastY = y;
    collapseScheduled = true;
    requestAnimationFrame(() => {
      collapseScheduled = false;
      collapseAdvancedSearchPreserveValues();
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  document.getElementById("searchView")?.addEventListener("scroll", onScroll, { passive: true });
  document.querySelectorAll("#searchView .table-wrap").forEach((el) => {
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
    parts.birthMax = document.getElementById("birthMax").value;
    parts.deathMin = document.getElementById("deathMin").value;
    parts.deathMax = document.getElementById("deathMax").value;
    parts.indexMin = document.getElementById("indexMin").value;
    parts.indexMax = document.getElementById("indexMax").value;
    parts.female = document.getElementById("femaleFilter").value;
    parts.indexAddr = document.getElementById("indexAddrFilter").value.trim();
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
    inputLabel: "中文姓名",
    placeholder: "姓名、拼音、別名或人物編號",
    columns: ["c_name_chn", "c_name", "_years", "c_dynasty_chn", "c_index_addr_chn", "c_personid"],
    personLink: "c_name_chn",
  },
  place: {
    inputLabel: "地名",
    placeholder: "地名、拼音或地址編號",
    columns: ["c_name_chn", "c_name", "_year_range", "c_admin_type", "c_addr_id", "_entity_action"],
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
    columns: ["c_title_chn", "c_title", "c_title_trans", "c_text_year", "c_textid", "_entity_action"],
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
  institution: [{ col: "c_inst_name_hz", entityType: "institution", idCol: "c_inst_name_code" }],
  event: [{ col: "c_event_name_chn", entityType: "event", idCol: "c_event_code" }],
  biog_address: [{ col: "c_addr_chn", entityType: "place", idCol: "c_addr_id" }],
  posting_addr: [{ col: "c_office_addr_chn", entityType: "place", idCol: "c_addr_id" }],
  people_addr: [{ col: "c_index_addr_chn", entityType: "place", idCol: "c_index_addr_id" }],
  event_addr: [{ col: "c_event_addr_chn", entityType: "place", idCol: "c_addr_id" }],
  possessions_addr: [{ col: "c_possession_addr_chn", entityType: "place", idCol: "c_addr_id" }],
};

async function api(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
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
  if (key === "_source") return "出處";
  const L = window.CBDB_FIELD_LABELS;
  return L?.modules?.[moduleId]?.[key] || L?.by_column?.[key] || key;
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
      next: () => searchOffset + pageSize < searchTotal && runSearch(searchOffset + pageSize),
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

function renderModuleCell(moduleKey, row, col, rawVal) {
  if (moduleKey === "entry" && col === "c_year") {
    return escapeHtml(formatEntryYearDisplay(row));
  }
  if (moduleKey === "association" && col === "c_assoc_first_year") {
    return escapeHtml(formatAssociationFirstYearDisplay(row));
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
  if (isAdvancedSearchActive() && type === "person" && advMode === "posting") {
    inputLabel = "官職關鍵詞";
  } else if (isAdvancedSearchActive() && type === "person" && advMode === "event") {
    inputLabel = "事件關鍵詞";
  }
  document.getElementById("searchInputLabel").textContent = inputLabel;
  document.getElementById("searchInput").placeholder = cfg.placeholder;

  const personBlock = document.getElementById("personAdvancedFilters");
  const typeHint = document.getElementById("advancedTypeHint");
  const showPersonAdvanced = type === "person";
  personBlock?.classList.toggle("hidden", !showPersonAdvanced);
  typeHint?.classList.toggle("hidden", showPersonAdvanced);

  const postingFields = ["advYearMin", "advYearMax", "advDynastyFilter"];
  for (const id of postingFields) {
    const el = document.getElementById(id)?.closest(".field");
    if (el) el.classList.toggle("hidden", advMode !== "posting" && advMode !== "event");
  }
  document.getElementById("advDynastyFilter")?.closest(".field")
    ?.classList.toggle("hidden", advMode !== "posting");

  const standardPersonFilterIds = [
    "dynastyFilter", "birthMin", "birthMax", "deathMin", "deathMax",
    "indexMin", "indexMax", "femaleFilter", "indexAddrFilter",
  ];
  for (const id of standardPersonFilterIds) {
    const el = document.getElementById(id)?.closest(".field");
    if (el) el.classList.toggle("hidden", advMode === "posting" || advMode === "event");
  }

  initSearchHeaders();
}

function initSearchHeaders() {
  const row = document.getElementById("searchHeadRow");
  if (!row) return;
  const type = currentSearchType;
  const cfg = SEARCH_CONFIG[type] || SEARCH_CONFIG.person;
  const L = (k) => fieldLabel("search", k);
  const headers = cfg.columns.map((c) => {
    if (c === "_years") return `${L("c_birthyear")}–${L("c_deathyear")}`;
    if (c === "_year_range") return `${L("c_firstyear")}–${L("c_lastyear")}`;
    if (c === "_event_years") return `${L("c_fy_yr")}–${L("c_ly_yr")}`;
    if (c === "_entity_action") return "操作";
    if (CODE_SEARCH_TYPES.has(type) && c === "c_code") return "代碼";
    return L(c);
  });
  row.innerHTML = `<th>#</th>${headers.map((h) => `<th>${h}</th>`).join("")}`;
}

function switchView(view) {
  const panel = document.getElementById(`${view}View`);
  if (!panel) {
    if (view !== "search") switchView("search");
    return;
  }
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  panel.classList.add("active");
}

function getActiveView() {
  const panel = document.querySelector(".panel.active");
  return panel?.id?.replace("View", "") || "search";
}

function captureCurrentFrame() {
  const frame = {
    view: getActiveView(),
    searchOffset,
    currentSearchType,
    entityPanelOpen: !document.getElementById("entityPersonsPanel").classList.contains("hidden"),
    entityContext: entityContext
      ? { entityType: entityContext.entityType, entityId: entityContext.entityId, entityOffset }
      : null,
  };
  if (selectedPersonId) {
    frame.personId = selectedPersonId;
    frame.personName = currentPersonName;
    frame.moduleId = moduleId;
    frame.moduleOffset = moduleOffset;
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
  if (f.view === "search") {
    if (f.entityPanelOpen) return "檢索 · 相關人物";
    return lastSearchQuery ? `檢索 · ${lastSearchQuery}` : "檢索結果";
  }
  if (f.personId) {
    let label = f.personName || `人物 ${f.personId}`;
    if (f.moduleId && f.moduleId !== "basic") {
      label += ` · ${MODULE_LABELS[f.moduleId] || f.moduleId}`;
    }
    if (f.entityPanelOpen) label += " · 相關人物";
    return label;
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
      if (lastSearchQuery && (frame.searchOffset ?? 0) !== (lastSearchData?.offset ?? 0)) {
        await runSearch(frame.searchOffset ?? 0, { restoring: true });
        switchView("search");
      } else {
        switchView("search");
        searchOffset = frame.searchOffset ?? 0;
        if (lastSearchData) {
          currentSearchType = frame.currentSearchType || lastSearchData.type;
          document.getElementById("searchMeta").textContent =
            lastSearchData.total ? `共 ${fmt(lastSearchData.total)} 條` : "未找到匹配項";
          renderSearch(
            lastSearchData.results,
            lastSearchData.offset,
            lastSearchData.total,
            currentSearchType
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
  const frame = navStack.pop();
  await restoreFrame(frame);
}

async function navGoToIndex(index) {
  const trail = [...navStack, captureCurrentFrame()];
  if (index < 0 || index >= trail.length - 1) return;
  const frame = trail[index];
  navStack = trail.slice(0, index);
  await restoreFrame(frame);
}

function openPersonFromLink(personId, e) {
  if (e?.ctrlKey || e?.metaKey || e?.button === 1) return;
  if (Number(personId) === selectedPersonId && getActiveView() === "person") return;
  pushNavFrame();
  openPerson(Number(personId), { push: false, moduleId: "basic", moduleOffset: 0 });
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
    document.getElementById("searchMeta").textContent =
      lastSearchData.total ? `共 ${fmt(lastSearchData.total)} 條` : "未找到匹配項";
    renderSearch(
      lastSearchData.results,
      lastSearchData.offset,
      lastSearchData.total,
      lastSearchData.type
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
    const bmax = document.getElementById("birthMax").value;
    const dmin = document.getElementById("deathMin").value;
    const dmax = document.getElementById("deathMax").value;
    const imin = document.getElementById("indexMin").value;
    const imax = document.getElementById("indexMax").value;
    const female = document.getElementById("femaleFilter").value;
    const idxAddr = document.getElementById("indexAddrFilter").value.trim();
    if (dy) p.set("dynasty_code", dy);
    if (bmin) p.set("birth_min", bmin);
    if (bmax) p.set("birth_max", bmax);
    if (dmin) p.set("death_min", dmin);
    if (dmax) p.set("death_max", dmax);
    if (imin) p.set("index_min", imin);
    if (imax) p.set("index_max", imax);
    if (female !== "") p.set("female", female);
    if (idxAddr) p.set("index_addr", idxAddr);
  }
  return `/api/search?${p}`;
}

function renderSearch(results, offset, total, searchType = currentSearchType) {
  initSearchHeaders();
  const cfg = SEARCH_CONFIG[searchType] || SEARCH_CONFIG.person;
  const cols = cfg.columns;
  const colCount = cols.length + 1;
  const tb = document.getElementById("searchBody");
  tb.innerHTML = "";
  if (!results.length) {
    tb.innerHTML = `<tr><td colspan="${colCount}" class="empty">未找到匹配項</td></tr>`;
    updatePager("searchPager", offset, total, 0);
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
      const val = searchCellValue(r, col);
      if (isPerson && col === cfg.personLink) {
        return `<td><button type="button" class="link">${escapeHtml(val)}</button></td>`;
      }
      return `<td>${escapeHtml(val)}</td>`;
    });
    tr.innerHTML = `<td>${offset + i + 1}</td>` + cells.join("");
    if (isPerson) {
      const btn = tr.querySelector(".link");
      if (btn) btn.onclick = (e) => { e.stopPropagation(); openPersonFromSearch(r.c_personid, e); };
      tr.onclick = (e) => openPersonFromSearch(r.c_personid, e);
    }
    tr.querySelectorAll("[data-entity-type]").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openEntityPersons(btn.dataset.entityType, Number(btn.dataset.entityId), btn.closest("tr"));
      };
    });
    tb.appendChild(tr);
  });
  updatePager("searchPager", offset, total, results.length);
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
      30000
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
          <td><button type="button" class="link">${escapeHtml(r.c_name_chn || r.c_name || "—")}</button></td>
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
    toast(e.message || "載入相關人物失敗", true);
  }
}

function closeEntityPersons() {
  entityContext = null;
  document.getElementById("entityPersonsPanel").classList.add("hidden");
  renderNavChrome();
}

function openPersonFromSearch(personId, e) {
  if (e?.ctrlKey || e?.metaKey || e?.button === 1) return;
  pushNavFrame();
  openPerson(Number(personId), { push: false, moduleId: "basic", moduleOffset: 0 });
}

async function runSearch(offset = 0, opts = {}) {
  const q = document.getElementById("searchInput").value.trim();
  if (!q) {
    if (!opts.fromNav && !opts.restoring) toast("請輸入檢索關鍵詞", true);
    return;
  }
  currentSearchType = document.getElementById("searchTypeFilter").value;
  const fp = searchFingerprint();
  if (offset === 0 && fp !== lastSearchFingerprint && !opts.restoring) {
    navStack = [];
    lastSearchFingerprint = fp;
    lastSearchQuery = q;
  }

  searchOffset = offset;
  if (!opts.restoring) closeEntityPersons();
  try {
    const data = await api(buildSearchUrl(q, offset), 30000);
    searchTotal = data.total;
    currentSearchType = data.type || document.getElementById("searchTypeFilter").value;
    if (data.mode === "posting" || data.mode === "event") currentSearchType = "person";
    const modeLabel = data.mode === "posting" ? "（任官）" : data.mode === "event" ? "（事件）" : "";
    document.getElementById("searchMeta").textContent =
      data.total ? `共 ${fmt(data.total)} 條${modeLabel}` : "未找到匹配項";
    lastSearchData = {
      results: data.results,
      total: data.total,
      offset,
      type: currentSearchType,
      mode: data.mode,
    };
    renderSearch(data.results, offset, data.total, currentSearchType);
    if (!opts.restoring) switchView("search");
    renderNavChrome();
  } catch (e) {
    toast(e.message || "檢索失敗", true);
  }
}

function renderModuleNav() {
  const nav = document.getElementById("moduleNav");
  nav.innerHTML = "";
  const modules = [
    ["basic", "基本資料", null],
    ["altname", "別名", "altname"],
    ["entry", "入仕", "entry"],
    ["status", "社會身份", "status"],
    ["posting", "任官", "posting"],
    ["posting_addr", "任官地點", "posting_addr"],
    ["biog_address", "傳記地址", "biog_address"],
    ["people_addr", "索引地址", "people_addr"],
    ["kinship", "親屬", "kinship"],
    ["association", "社會關係", "association"],
    ["text_role", "著述", "text_role"],
    ["biog_source", "資料出處", "biog_source"],
    ["institution", "社會機構", "institution"],
    ["institution_addr", "機構地址", "institution_addr"],
    ["event", "生平事件", "event"],
    ["event_addr", "事件地點", "event_addr"],
    ["possessions", "財產", "possessions"],
    ["possessions_addr", "財產地點", "possessions_addr"],
  ];
  for (const [id, label, key] of modules) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "module-item" + (id === moduleId ? " active" : "");
    const count = key ? moduleCounts[key] : null;
    btn.innerHTML = `<span>${label}</span>${count != null ? `<span class="badge">${count}</span>` : ""}`;
    btn.onclick = () => loadModule(id);
    nav.appendChild(btn);
  }
}

function renderBasic(person) {
  document.getElementById("moduleTitle").textContent = "基本資料";
  document.getElementById("moduleCount").textContent = "";
  document.getElementById("modulePager").classList.add("hidden");
  document.getElementById("moduleTable").classList.add("kv-mode");
  document.getElementById("moduleHead").innerHTML = "<tr><th>#</th><th>欄位</th><th>內容</th></tr>";
  const rows = [
    { label: fieldLabel("basic", "c_personid"), value: person.c_personid },
    { label: "姓名", value: formatBasicPersonName(person) },
    { label: fieldLabel("basic", "c_birthyear"), value: formatBasicYearDisplay(person, "birth") },
    { label: fieldLabel("basic", "c_deathyear"), value: formatBasicYearDisplay(person, "death") },
    { label: fieldLabel("basic", "c_dynasty_chn"), value: person.c_dynasty_chn },
    { label: fieldLabel("basic", "c_index_year"), value: person.c_index_year },
    { label: fieldLabel("basic", "c_index_addr_chn"), value: person.c_index_addr_chn },
    { label: fieldLabel("basic", "c_choronym_desc_chn"), value: person.c_choronym_desc_chn },
    { label: fieldLabel("basic", "c_ethnicity_desc_chn"), value: person.c_ethnicity_desc_chn },
  ];
  const indexSource = formatSourceDisplay(person, "basic");
  if (indexSource !== "—") {
    rows.push({ label: "出處", value: indexSource });
  }
  document.getElementById("moduleBody").innerHTML = rows.map((row, i) =>
    `<tr><td>${i + 1}</td><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value ?? "—")}</td></tr>`
  ).join("");
}

function renderModuleRows(rows, offset, total, columns, moduleKey) {
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
  altname: ["#", "c_name_type_desc_chn", "c_alt_name_chn", "c_sequence", "_source"],
  kinship: ["#", "c_kinrel_chn", "c_kin_chn", "c_addr_chn", "_source", "c_kin_id"],
  posting: ["#", "c_office_chn", "c_firstyear", "c_lastyear", "c_dynasty_chn", "_source", "c_office_id"],
  posting_addr: ["#", "c_office_addr_chn", "c_office_addr_name", "_source", "c_addr_id"],
  entry: ["#", "c_entry_desc_chn", "c_year", "c_exam_rank", "c_addr_chn", "_source"],
  association: ["#", "c_link_chn", "c_node_chn", "c_assoc_first_year", "c_occasion_desc_chn", "_source", "c_node_id"],
  biog_address: ["#", "c_addr_desc_chn", "c_addr_chn", "c_firstyear", "c_lastyear", "_source", "c_addr_id"],
  people_addr: ["#", "c_index_addr_chn", "c_index_addr_type_chn", "c_index_year", "_source", "c_index_addr_id"],
  text_role: ["#", "c_title_chn", "c_role_desc_chn", "c_year", "_source", "c_textid"],
  biog_source: ["#", "c_title_chn", "c_title", "c_main_source", "_source", "c_hyperlink"],
  status: ["#", "c_status_desc_chn", "c_firstyear", "c_lastyear", "_source"],
  institution: ["#", "c_inst_name_hz", "c_bi_role_chn", "c_bi_begin_year", "c_bi_end_year", "_source", "c_inst_name_code"],
  institution_addr: ["#", "c_inst_name_hz", "c_inst_addr_chn", "c_inst_addr_type_chn", "c_bi_begin_year", "_source"],
  event: ["#", "c_event_name_chn", "c_role", "c_year", "c_nianhao_chn", "_source", "c_event_code"],
  event_addr: ["#", "c_event_name_chn", "c_event_addr_chn", "c_year", "_source", "c_addr_id"],
  possessions: ["#", "c_possession_act_desc_chn", "c_possession_desc_chn", "c_quantity", "c_possession_yr", "_source"],
  possessions_addr: ["#", "c_possession_desc_chn", "c_possession_addr_chn", "c_possession_yr", "_source", "c_addr_id"],
};

const MODULE_LABELS = {
  altname: "別名", kinship: "親屬", posting: "任官", posting_addr: "任官地點",
  entry: "入仕", association: "社會關係", biog_address: "傳記地址",
  people_addr: "索引地址", text_role: "著述", biog_source: "資料出處",
  status: "社會身份", institution: "社會機構", institution_addr: "機構地址",
  event: "生平事件", event_addr: "事件地點",
  possessions: "財產", possessions_addr: "財產地點",
};

async function loadModule(id, offset = 0) {
  moduleId = id;
  moduleOffset = offset;
  renderModuleNav();
  if (!selectedPersonId) return;
  if (id === "basic") {
    const data = await api(`/api/person/${selectedPersonId}/module/basic`);
    renderBasic(data.person);
    renderNavChrome();
    return;
  }
  document.getElementById("moduleTitle").textContent = MODULE_LABELS[id] || id;
  const data = await api(`/api/person/${selectedPersonId}/module/${id}?limit=${pageSize}&offset=${offset}`);
  moduleTotal = data.total;
  renderModuleRows(data.rows, offset, data.total, MODULE_COLUMNS[id] || ["#", "data"], id);
  renderNavChrome();
}

function renderPersonHeader(p) {
  const header = document.getElementById("personHeader");
  header.classList.remove("placeholder");
  const name = escapeHtml(p.c_name_chn || p.c_name || "—");
  header.innerHTML = `
    <div class="person-header-top">
      <h2>${name}</h2>
      <button type="button" id="exportPersonBtn" class="btn sm">導出信息</button>
    </div>`;
  document.getElementById("exportPersonBtn").onclick = () => exportCurrentPerson();
}

async function exportCurrentPerson() {
  if (!selectedPersonId) return;
  const btn = document.getElementById("exportPersonBtn");
  if (btn) btn.disabled = true;
  toast("正在導出…");
  try {
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
  return `CDBD数据库_人物_${currentPersonExportName || currentPersonName || "未知"}_${ts}.xlsx`;
}

async function openPerson(id, opts = {}) {
  if (opts.push !== false && !navRestoring) {
    pushNavFrame();
  }

  selectedPersonId = id;
  const data = await api(`/api/person/${id}`);
  moduleCounts = data.module_counts || {};
  const p = data.person;
  if (data.merged_from) {
    toast(`人物編號 ${data.merged_from} 已合併至 ${p.c_personid}`);
    selectedPersonId = p.c_personid;
  }
  currentPersonName = p.c_name_chn || p.c_name || String(p.c_personid);
  currentPersonExportName = formatBasicPersonName(p);
  renderPersonHeader(p);

  moduleId = opts.moduleId ?? "basic";
  moduleOffset = opts.moduleOffset ?? 0;
  await loadModule(moduleId, moduleOffset);
  switchView("person");
  document.querySelectorAll("#searchBody tr").forEach((tr) => {
    tr.classList.toggle("sel", tr.textContent.includes(String(p.c_personid)));
  });
  renderNavChrome();
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
  const chn = String(person.c_name_chn || "").trim();
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

function dynastyLabel(d) {
  const y0 = fmtYear(d.start_year);
  const y1 = fmtYear(d.end_year);
  const range = y0 && y1 ? ` ${y0}–${y1}` : "";
  return `${d.label_chn}${range}（${fmt(d.person_count)}）`;
}

function renderDynasties(list) {
  for (const selId of ["dynastyFilter", "advDynastyFilter"]) {
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
      "本地服務未運行。請雙擊項目中的 <strong>啟動CBDB_atlas.bat</strong>（會自動啟動並打開本頁），不要直接打開書籤。";
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

document.getElementById("searchForm").onsubmit = (e) => {
  e.preventDefault();
  runSearch(0);
};
document.getElementById("searchTypeFilter").onchange = () => {
  setAdvancedSearchOpen(false);
  lastSearchFingerprint = "";
};
document.getElementById("advancedMode")?.addEventListener("change", () => updateSearchFormForType());
document.getElementById("advancedToggleBtn").onclick = () => {
  setAdvancedSearchOpen(!searchAdvancedOpen);
};
document.getElementById("entityPersonsClose").onclick = closeEntityPersons;
document.getElementById("navBackBtn")?.addEventListener("click", () => navBack());

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

boot();
bindPagerControls();
bindSearchResultsScrollCollapse();
updateSearchFormForType();
