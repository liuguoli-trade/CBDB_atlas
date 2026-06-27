(function () {
  function fullCategoryFilters() {
    return {
      kin: { core: true, extended: true },
      assoc: { political: true, scholarly: true, literary: true, other: true },
    };
  }

  function defaultCategoryFilters() {
    return globalThis.GraphEdgeSchema
      ? globalThis.GraphEdgeSchema.cloneCategoryFilters()
      : {
        kin: { core: true, extended: false },
        assoc: { political: true, scholarly: true, literary: false, other: false },
      };
  }

  function cloneCategoryFilters(source = defaultCategoryFilters()) {
    if (globalThis.GraphEdgeSchema) {
      return globalThis.GraphEdgeSchema.cloneCategoryFilters(source);
    }
    return {
      kin: { ...source.kin },
      assoc: { ...source.assoc },
    };
  }

  function defaultFamilyCategoryFilters() {
    return {
      kin: { core: true, extended: true },
      assoc: { political: true, scholarly: true, literary: true, other: true },
    };
  }

  function categoryFiltersForFamily() {
    return {
      kin: {
        core: state.categoryFilters.kin?.core !== false,
        extended: state.categoryFilters.kin?.extended !== false,
      },
      assoc: { political: false, scholarly: false, literary: false, other: false },
    };
  }

  function categoryFiltersForCircle() {
    return {
      kin: { core: false, extended: false },
      assoc: {
        political: state.categoryFilters.assoc?.political !== false,
        scholarly: state.categoryFilters.assoc?.scholarly !== false,
        literary: state.categoryFilters.assoc?.literary !== false,
        other: state.categoryFilters.assoc?.other !== false,
      },
    };
  }

  function categoryFiltersForSingleView(view) {
    if (view === "kinship") {
      return {
        kin: { core: true, extended: true },
        assoc: { political: false, scholarly: false, literary: false, other: false },
      };
    }
    if (view === "association") {
      return {
        kin: { core: false, extended: false },
        assoc: { political: true, scholarly: true, literary: true, other: true },
      };
    }
    return fullCategoryFilters();
  }

  function filterGraphByRelationKind(data, kind) {
    if (!data || !kind || kind === "all") return data;
    const allowed = kind === "kinship"
      ? new Set(["kinship", "kinship-marriage"])
      : new Set(["association"]);
    const edges = (data.edges || []).filter((e) => allowed.has(e.type));
    const nodeIds = new Set();
    if (data.center_id != null) nodeIds.add(String(data.center_id));
    edges.forEach((e) => {
      nodeIds.add(String(e.source));
      nodeIds.add(String(e.target));
    });
    const nodes = (data.nodes || []).filter((n) => nodeIds.has(String(n.id)));
    const kinCount = edges.filter((e) => String(e.type || "").startsWith("kinship")).length;
    const assocCount = edges.filter((e) => e.type === "association").length;
    return {
      ...data,
      nodes,
      edges,
      stats: {
        ...(data.stats || {}),
        node_count: nodes.length,
        edge_count: edges.length,
        kinship_edges: kinCount,
        association_edges: assocCount,
        relation_kind: kind,
      },
    };
  }

  const SINGLE_VIEW_LABELS = {
    all: "全量關係圖譜（1 步）",
    basic: "基本資料",
    text: "著述",
    kinship: "僅親屬（1 步）",
    association: "僅社會（1 步）",
  };

  const state = {
    mode: "single",
    personPhase: "search",
    singleView: "all",
    personId: null,
    personLabel: "",
    personLocked: false,
    kind: "all",
    steps: 1,
    circleSteps: 2,
    showEdgeLabels: false,
    categoryFilters: cloneCategoryFilters(),
    graphData: null,
    explorePaths: [],
    graphSelection: { kind: "none" },
    loading: false,
    lastSearchTotal: 0,
    searchOffset: 0,
    lastSearchQuery: "",
    personPendingLoad: false,
    pendingPersonLabel: "",
  };

  let visualAdvancedOpen = false;
  const VISUAL_PERSON_COLUMNS = [
    "c_name_chn", "c_alt_names", "c_dynasty_chn", "_years",
    "c_index_addr_chn", "c_personid",
  ];
  const VISUAL_PAGE_SIZE = 20;
  const VISUAL_ADV_FILTER_IDS = [
    "visualDynastyFilter", "visualBirthMin", "visualDeathMax",
    "visualFemaleFilter", "visualIndexAddrFilter",
    "visualAdvYearMin", "visualAdvYearMax", "visualAdvDynastyFilter", "visualAdvancedMode",
  ];

  /** @type {{ single: Record<string, object>, family: object|null, circle: object|null, explore: object|null }} */
  const modeCache = {
    single: {},
    family: null,
    circle: null,
    explore: null,
  };

  function clearModeCache() {
    modeCache.single = {};
    modeCache.family = null;
    modeCache.circle = null;
    modeCache.explore = null;
  }

  function getModeCacheEntry(mode = state.mode, singleView = state.singleView) {
    if (mode === "single") return modeCache.single[singleView] || null;
    return modeCache[mode] || null;
  }

  function saveCurrentModeCache() {
    const entry = {
      graphData: state.graphData,
      graphSelection: state.graphSelection,
      showEdgeLabels: state.showEdgeLabels,
      categoryFilters: cloneCategoryFilters(state.categoryFilters),
      explorePaths: [...(state.explorePaths || [])],
      viewport: globalThis.CbdbGraph?.getViewport?.() || null,
      singleView: state.singleView,
      circleSteps: state.circleSteps,
    };
    if (state.mode === "single") {
      modeCache.single[state.singleView] = entry;
    } else if (state.mode) {
      modeCache[state.mode] = entry;
    }
  }

  function showEmptyCanvasPlaceholder() {
    const canvas = $("#visualGraphCanvas");
    if (!canvas) return;
    CbdbGraph.destroy?.();
    state.graphData = null;
    state.graphSelection = { kind: "none" };
    $("#addrStatsHost")?.classList.add("hidden");
    $("#pathListHost")?.classList.add("hidden");
    const statsEl = $("#visualStats");
    if (statsEl) statsEl.textContent = "";
    const hints = {
      single: state.personPhase === "search" || !hasSelectedPerson()
        ? "檢索並選擇人物，或調整類型後點擊「生成圖譜」"
        : "選擇類型或點擊「生成圖譜」",
      family: hasSelectedPerson()
        ? "調整參數後點擊「生成圖譜」"
        : "請先檢索並選擇中心人物",
      circle: hasSelectedPerson()
        ? "選擇深度後點擊「生成圖譜」"
        : "請先檢索並選擇中心人物",
      explore: "輸入人物後點擊「生成圖譜」",
    };
    canvas.innerHTML = `<p class="empty">${hints[state.mode] || "調整參數後點擊「生成圖譜」"}</p>`;
    setDetail({ kind: "none" });
  }

  async function paintGraphData(data, opts = {}) {
    const canvas = $("#visualGraphCanvas");
    if (!canvas || !data) return;
    if (opts.stale?.()) return;

    data = globalThis.GraphEdgeSchema?.sanitizeGraphPayload?.(data) ?? data;
    state.graphData = data;
    updateStats(data);

    if (state.mode === "circle") renderAddrStats(data.addr_stats);
    else if (state.mode === "family") renderBranchStats(data.branch_stats);
    else {
      $("#addrStatsHost")?.classList.add("hidden");
    }

    if (state.mode === "explore") {
      renderPathList(state.explorePaths);
    } else {
      $("#pathListHost")?.classList.add("hidden");
    }

    if (!data.nodes?.length) {
      if (opts.stale?.()) return;
      canvas.innerHTML = '<p class="empty">無可繪製的節點</p>';
      setDetail({ kind: "empty", center: data });
      return;
    }

    if (opts.stale?.()) return;
    canvas.innerHTML = "";
    CbdbGraph.destroy?.();
    CbdbGraph.mount(canvas);
    const renderOpts = { ...renderOptionsForMode(), ...opts };
    await CbdbGraph.render(
      data,
      { onSelect: (sel) => setDetail(sel), onReady: () => {} },
      renderOpts,
    );
    if (opts.stale?.()) {
      CbdbGraph.destroy?.();
      return;
    }
    applyVisualCategoryFilters();
    CbdbGraph.setEdgeLabelsVisible(state.showEdgeLabels);
    const sel = state.graphSelection?.kind && state.graphSelection.kind !== "none"
      ? state.graphSelection
      : { kind: "none" };
    setDetail(sel);
    if (sel.kind === "node" || sel.kind === "edge") {
      CbdbGraph.applySelection?.(sel);
    }
  }

  async function restoreGraphFromCache(entry, load) {
    if (load?.stale?.()) return;
    if (!entry) {
      showEmptyCanvasPlaceholder();
      return;
    }
    if (entry.singleView) state.singleView = entry.singleView;
    if (entry.circleSteps != null) {
      state.circleSteps = entry.circleSteps;
      document.querySelectorAll(".visual-circle-steps").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.steps) === state.circleSteps);
      });
    }
    if (entry.categoryFilters) {
      state.categoryFilters = cloneCategoryFilters(entry.categoryFilters);
      syncVisualCategoryButtons();
    }
    state.showEdgeLabels = !!entry.showEdgeLabels;
    state.explorePaths = entry.explorePaths || [];
    state.graphSelection = entry.graphSelection || { kind: "none" };

    if (state.mode === "single") syncSingleViewUI();

    if (!entry.graphData) {
      showEmptyCanvasPlaceholder();
      return;
    }

    await paintGraphData(entry.graphData, {
      initialViewport: entry.viewport || undefined,
      stale: load?.stale,
    });
  }

  async function activateModeCanvas(opts = {}) {
    const load = opts.load;
    if (load?.stale?.()) return;

    const cached = getModeCacheEntry(state.mode);
    if (cached) {
      await restoreGraphFromCache(cached, load);
      return;
    }

    if (hasSelectedPerson() && (state.mode === "family" || state.mode === "circle")) {
      await loadGraph({ load: load ?? bumpVisualLoad("正在載入圖譜") });
      return;
    }

    if (opts.run && state.mode === "single" && hasSelectedPerson()) {
      await loadGraph({ load: load ?? bumpVisualLoad("正在載入圖譜") });
      return;
    }

    if (state.mode === "single" && hasSelectedPerson() && opts.run !== false) {
      resetSingleViewToAll(false);
      await loadGraph({ load: load ?? bumpVisualLoad("正在載入圖譜") });
      return;
    }

    if (load?.stale?.()) return;
    showEmptyCanvasPlaceholder();
  }

  const LOCKED_MODES = new Set(["single", "family", "circle"]);
  const MODES = new Set(["single", "family", "circle", "explore"]);

  function isLockedMode() {
    return LOCKED_MODES.has(state.mode) && hasSelectedPerson();
  }

  function hasSelectedPerson() {
    return state.personLocked && state.personId != null;
  }

  function isUserCancel(err) {
    return globalThis.CbdbLoading?.isUserCancelError?.(err)
      || (err?.name === "AbortError" && /已取消載入|cancel|取消/i.test(String(err.message || "")));
  }

  let visualLoadSeq = 0;
  let visualLoadAbort = null;

  function bumpVisualLoad(reason = "已切換視圖") {
    visualLoadSeq += 1;
    const seq = visualLoadSeq;
    visualLoadAbort?.abort(new DOMException(reason, "AbortError"));
    visualLoadAbort = new AbortController();
    return {
      seq,
      signal: visualLoadAbort.signal,
      stale: () => seq !== visualLoadSeq,
    };
  }

  function isBenignVisualAbort(err) {
    if (isUserCancel(err)) return true;
    if (err?.name !== "AbortError") return false;
    const msg = String(err.message || "");
    return /已切換視圖|正在載入|正在激活|已重新載入|已取消載入/i.test(msg);
  }

  function hanzi() {
    return globalThis.CbdbHanzi || { composeChineseName: (p) => p?.c_name_chn || p?.c_name || "" };
  }

  function formatPersonName(row) {
    const composed = hanzi().composeChineseName(row);
    return composed || row?.c_name_chn || row?.c_name || String(row?.c_personid || "—");
  }

  function isSinglePersonPicker() {
    return state.mode === "single"
      && state.personPhase === "search"
      && !state.personPendingLoad;
  }

  function showProfileLoadingCanvas(message = "正在載入人物與圖譜…") {
    const canvas = $("#visualGraphCanvas");
    if (canvas) canvas.innerHTML = `<p class="empty">${escapeHtml(message)}</p>`;
  }

  function enterPendingProfilePhase({ label = "載入中…" } = {}) {
    state.personPhase = "profile";
    state.personPendingLoad = true;
    state.pendingPersonLabel = label;
    const card = $("#visualPersonCard");
    const nameEl = $("#visualPersonName");
    const metaEl = $("#visualPersonMeta");
    card?.classList.remove("hidden");
    card?.classList.add("is-loading");
    if (nameEl) nameEl.textContent = label;
    if (metaEl) metaEl.textContent = "正在載入人物資料…";
    showProfileLoadingCanvas();
    updateChromeForMode();
  }

  function clearPendingProfilePhase() {
    state.personPendingLoad = false;
    state.pendingPersonLabel = "";
    $("#visualPersonCard")?.classList.remove("is-loading");
  }

  function personSearchNameTitle(row) {
    return hanzi().personNameTitle?.(row) || "";
  }

  function visualSearchCellValue(row, col) {
    if (col === "_years") {
      const y = [row.c_birthyear, row.c_deathyear].filter(Boolean).join("–");
      return y || "—";
    }
    if (col === "c_name_chn") return formatPersonName(row);
    const v = row[col];
    return v == null || v === "" ? "—" : String(v);
  }

  function updateVisualSearchPager(offset, total, rowCount) {
    const pager = $("#visualSearchPager");
    if (!pager) return;
    const prev = pager.querySelector("[data-pager-prev]");
    const next = pager.querySelector("[data-pager-next]");
    const info = pager.querySelector("[data-pager-info]");
    const show = total > 0;
    pager.classList.toggle("hidden", !show);
    if (prev) prev.disabled = offset <= 0;
    if (next) next.disabled = offset + rowCount >= total;
    if (info) {
      info.textContent = total > 0
        ? `${offset + 1}–${offset + rowCount} / ${total}`
        : "—";
    }
  }

  function updateVisualLayout() {
    const picker = isSinglePersonPicker();
    document.body.classList.toggle("visual-picker-active", picker);
    $("#visualPickerPanel")?.classList.toggle("hidden", !picker);
    document.querySelector(".visual-graph-panel")?.classList.toggle("hidden", picker);
    $("#runVisualBtn")?.classList.toggle("hidden", picker);
  }

  function countVisualAdvancedFilters() {
    let count = 0;
    for (const id of VISUAL_ADV_FILTER_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      const v = el.tagName === "SELECT" ? el.value : String(el.value || "").trim();
      if (v !== "") count += 1;
    }
    return count;
  }

  function hasVisualAdvancedFilters() {
    return countVisualAdvancedFilters() > 0;
  }

  function syncVisualExpandPanel(panel, open) {
    if (!panel) return;
    panel.classList.toggle("is-open", open);
    panel.classList.toggle("is-collapsed", !open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function updateVisualAdvancedToggle() {
    const btn = $("#visualAdvancedToggleBtn");
    if (!btn) return;
    const label = btn.querySelector(".expand-toggle-label");
    const badge = btn.querySelector(".expand-toggle-badge");
    const chevron = btn.querySelector(".expand-toggle-chevron");
    const badgeCount = countVisualAdvancedFilters();
    if (label) label.textContent = visualAdvancedOpen ? "收起" : "高級檢索";
    btn.setAttribute("aria-expanded", visualAdvancedOpen ? "true" : "false");
    btn.classList.toggle("active", visualAdvancedOpen || badgeCount > 0);
    if (badge) {
      const showBadge = !visualAdvancedOpen && badgeCount > 0;
      badge.classList.toggle("hidden", !showBadge);
      badge.textContent = showBadge ? String(badgeCount) : "";
    }
    if (chevron) chevron.classList.toggle("is-open", visualAdvancedOpen);
  }

  function setVisualAdvancedOpen(open) {
    if (open === visualAdvancedOpen) {
      updateVisualAdvancedToggle();
      return;
    }
    visualAdvancedOpen = open;
    syncVisualExpandPanel($("#visualAdvancedSearchPanel"), open);
    updateVisualAdvancedToggle();
    updateVisualAdvancedForm();
  }

  function updateVisualAdvancedForm() {
    const advMode = $("#visualAdvancedMode")?.value || "";
    const standardIds = [
      "visualDynastyFilter", "visualBirthMin", "visualDeathMax",
      "visualFemaleFilter", "visualIndexAddrFilter",
    ];
    for (const id of standardIds) {
      const el = document.getElementById(id)?.closest(".field");
      if (el) el.classList.toggle("hidden", advMode === "posting" || advMode === "event");
    }
    document.querySelectorAll(".visual-adv-posting-field").forEach((el) => {
      el.classList.toggle("hidden", advMode !== "posting" && advMode !== "event");
    });
    document.querySelectorAll(".visual-adv-posting-only").forEach((el) => {
      el.classList.toggle("hidden", advMode !== "posting");
    });
    const inputLabel = $("#visualSearchInput")?.previousElementSibling;
    if (inputLabel && hasVisualAdvancedFilters()) {
      if (advMode === "posting") inputLabel.textContent = "官職關鍵詞";
      else if (advMode === "event") inputLabel.textContent = "事件關鍵詞";
      else inputLabel.textContent = "姓名";
    } else if (inputLabel) {
      inputLabel.textContent = "姓名";
    }
  }

  function buildVisualSearchUrl(q, offset = 0) {
    const useAdvanced = hasVisualAdvancedFilters();
    const advMode = useAdvanced ? ($("#visualAdvancedMode")?.value || "") : "";
    if (advMode === "posting") {
      const p = new URLSearchParams({ q, limit: String(VISUAL_PAGE_SIZE), offset: String(offset) });
      const ymin = $("#visualAdvYearMin")?.value;
      const ymax = $("#visualAdvYearMax")?.value;
      const dy = $("#visualAdvDynastyFilter")?.value;
      if (ymin) p.set("year_min", ymin);
      if (ymax) p.set("year_max", ymax);
      if (dy) p.set("dynasty_code", dy);
      return `/api/search/persons-by-posting?${p}`;
    }
    if (advMode === "event") {
      const p = new URLSearchParams({ q, limit: String(VISUAL_PAGE_SIZE), offset: String(offset) });
      const ymin = $("#visualAdvYearMin")?.value;
      const ymax = $("#visualAdvYearMax")?.value;
      if (ymin) p.set("year_min", ymin);
      if (ymax) p.set("year_max", ymax);
      return `/api/search/persons-by-event?${p}`;
    }
    const p = new URLSearchParams({ q, limit: String(VISUAL_PAGE_SIZE), offset: String(offset) });
    if (useAdvanced) {
      const dy = $("#visualDynastyFilter")?.value;
      const bmin = $("#visualBirthMin")?.value;
      const dmax = $("#visualDeathMax")?.value;
      const female = $("#visualFemaleFilter")?.value;
      const idxAddr = $("#visualIndexAddrFilter")?.value?.trim();
      if (dy) p.set("dynasty_code", dy);
      if (bmin) p.set("birth_min", bmin);
      if (dmax) p.set("death_max", dmax);
      if (female !== "") p.set("female", female);
      if (idxAddr) p.set("index_addr", idxAddr);
    }
    return `/api/search?${p}`;
  }

  function renderVisualSearchResults(results, total, offset = 0) {
    const meta = $("#visualSearchMeta");
    const tb = $("#visualSearchBody");
    if (!tb) return;
    if (meta) {
      meta.textContent = total != null && total > 0
        ? `共 ${total} 條 · 顯示 ${results.length} 條 · 點選姓名進入人物資料`
        : results.length
          ? `顯示 ${results.length} 條 · 點選姓名進入人物資料`
          : "未找到匹配項，請調整檢索條件";
    }
    tb.innerHTML = "";
    if (!results.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty">未找到匹配項</td></tr>';
      updateVisualSearchPager(0, 0, 0);
      return;
    }
    const hanCols = new Set(["c_alt_names", "c_index_addr_chn"]);
    results.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.className = "clickable";
      if (Number(r.c_personid) === Number(state.personId)) tr.classList.add("sel");
      tr.dataset.personId = String(r.c_personid);
      const cells = VISUAL_PERSON_COLUMNS.map((col) => {
        const val = visualSearchCellValue(r, col);
        if (col === "c_name_chn") {
          const title = personSearchNameTitle(r);
          const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
          return `<td><button type="button" class="link han-text" data-person-id="${r.c_personid}"${titleAttr}>${escapeHtml(val)}</button></td>`;
        }
        const hanClass = col.endsWith("_chn") || hanCols.has(col) ? " han-text" : "";
        return `<td${hanClass ? ` class="${hanClass.trim()}"` : ""}>${escapeHtml(val)}</td>`;
      });
      tr.innerHTML = `<td>${offset + i + 1}</td>${cells.join("")}`;
      tr.querySelectorAll(".link[data-person-id]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          selectPerson(Number(btn.dataset.personId), { pendingLabel: formatPersonName(r) });
        });
      });
      tr.addEventListener("click", (ev) => {
        if (ev.target.closest(".link[data-person-id]")) return;
        selectPerson(Number(r.c_personid), { pendingLabel: formatPersonName(r) });
      });
      tb.appendChild(tr);
    });
    updateVisualSearchPager(offset, total ?? results.length, results.length);
  }

  async function runVisualPersonSearch(offset = 0) {
    const q = $("#visualSearchInput")?.value?.trim() || "";
    if (!q) {
      toast("請輸入檢索關鍵詞", true);
      return;
    }
    if (offset === 0 && /^\d+$/.test(q)) {
      await selectPerson(Number(q));
      return;
    }
    try {
      state.lastSearchQuery = q;
      state.searchOffset = offset;
      const data = await api(buildVisualSearchUrl(q, offset), {
        loading: { message: "檢索中…", mode: "bar" },
      });
      const results = searchResults(data);
      state.lastSearchTotal = data.total ?? results.length;
      renderVisualSearchResults(results, data.total, offset);
      if (offset === 0 && results.length === 1 && results[0]?.c_personid) {
        await selectPerson(Number(results[0].c_personid));
      }
    } catch (err) {
      if (isUserCancel(err)) return;
      toast(err.message || "檢索失敗", true);
    }
  }

  function enterSearchPhase() {
    state.personPhase = "search";
    clearPendingProfilePhase();
    updateChromeForMode();
    showEmptyCanvasPlaceholder();
  }

  function enterProfilePhase() {
    state.personPhase = "profile";
    clearPendingProfilePhase();
    updateChromeForMode();
  }

  async function selectPerson(personId, { runGraph = true, pendingLabel = null } = {}) {
    if (!Number.isFinite(personId) || personId <= 0) {
      toast("無效的人物編號", true);
      return;
    }
    const load = bumpVisualLoad("正在載入人物");
    if (state.mode === "single") {
      enterPendingProfilePhase({
        label: pendingLabel
          || $("#visualSearchInput")?.value?.trim()
          || `人物 #${personId}`,
      });
    }
    try {
      await loadLockedPerson(personId, { signal: load.signal });
      if (load.stale()) return;
      if (state.mode === "single") {
        resetSingleViewToAll(false);
      }
      if (state.mode === "family") {
        state.categoryFilters = defaultFamilyCategoryFilters();
        syncVisualCategoryButtons();
      }
      if (state.mode === "circle") {
        syncVisualCategoryButtons();
      }
      enterProfilePhase();
      syncShareUrl();
      if (runGraph) {
        await loadGraph({ load });
      } else if (!load.stale()) {
        showEmptyCanvasPlaceholder();
      }
    } catch (err) {
      if (load.stale() || isBenignVisualAbort(err)) return;
      if (isUserCancel(err)) {
        enterSearchPhase();
        return;
      }
      clearPendingProfilePhase();
      toast(err.message || "無法載入人物", true);
    }
  }

  function beginChangePerson() {
    saveCurrentModeCache();
    globalThis.CbdbGraph?.destroy?.();
    state.personLocked = false;
    state.personId = null;
    state.personLabel = "";
    state.personPhase = "search";
    syncShareUrl();
    enterSearchPhase();
    $("#visualSearchInput")?.focus();
  }

  function updatePersonPanels() {
    const mode = state.mode;
    const explore = mode === "explore";
    const hasPerson = hasSelectedPerson();
    let showPicker = false;
    let showCard = false;
    let showSingleControls = false;

    if (!explore) {
      if (mode === "single") {
        const inProfile = state.personPhase === "profile"
          && (hasPerson || state.personPendingLoad);
        showPicker = state.personPhase === "search" && !state.personPendingLoad;
        showCard = inProfile;
        showSingleControls = inProfile;
      } else {
        showPicker = !hasPerson;
        showCard = hasPerson;
      }
    }

    $("#visualPersonSearch")?.classList.toggle("hidden", !showPicker);
    $("#visualPersonCard")?.classList.toggle("hidden", !showCard);
    $("#visualChangePersonBtn")?.classList.toggle(
      "hidden",
      mode !== "single" || !showCard || state.personPhase !== "profile" || state.personPendingLoad,
    );
    if (mode === "single") {
      $("#singleControls")?.classList.toggle("hidden", !showSingleControls);
      document.querySelectorAll(".visual-single-view").forEach((btn) => {
        btn.disabled = state.personPendingLoad || state.loading;
      });
    }
  }

  function reloadFamilyGraphIfReady() {
    if (state.mode !== "family" || !hasSelectedPerson()) return;
    loadGraph();
  }

  function reloadCircleGraphIfReady() {
    if (state.mode !== "circle" || !hasSelectedPerson()) return;
    loadGraph();
  }

  async function loadVisualDynasties() {
    try {
      const dyn = await api("/api/schema/dynasties");
      const list = dyn.dynasties || [];
      for (const selId of ["visualDynastyFilter", "visualAdvDynastyFilter"]) {
        const sel = document.getElementById(selId);
        if (!sel) continue;
        const cur = sel.value;
        sel.innerHTML = '<option value="">不限</option>';
        for (const d of list) {
          const opt = document.createElement("option");
          opt.value = String(d.code);
          const label = d.label_chn || d.c_dynasty_chn || d.code;
          const y0 = d.start_year != null ? d.start_year : "";
          const y1 = d.end_year != null ? d.end_year : "";
          const range = y0 !== "" && y1 !== "" ? ` ${y0}–${y1}` : "";
          opt.textContent = `${label}${range}`;
          sel.appendChild(opt);
        }
        if (cur) sel.value = cur;
      }
    } catch {
      /* optional */
    }
  }

  async function api(path, options = {}) {
    const loading = options.loading ?? null;
    const fetchOpts = { ...options };
    delete fetchOpts.loading;

    const run = async () => {
      const ctrl = new AbortController();
      const merged = globalThis.CbdbLoading?.mergeSignal?.(fetchOpts.signal) ?? fetchOpts.signal;
      const onAbort = () => {
        ctrl.abort(merged?.reason ?? new DOMException("已取消載入", "AbortError"));
      };
      if (merged) {
        if (merged.aborted) onAbort();
        else merged.addEventListener("abort", onAbort, { once: true });
      }
    const res = await fetch(path, {
        headers: fetchOpts.body ? { "Content-Type": "application/json" } : undefined,
        ...fetchOpts,
        signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || res.statusText);
    return data;
    };

    if (loading && globalThis.CbdbLoading) {
      return CbdbLoading.withLoading(run, loading);
    }
    return run();
  }

  function $(sel) { return document.querySelector(sel); }

  function searchResults(res) {
    return res?.results || res?.rows || [];
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isBirthDeathRow(row) {
    const label = String(row?.label || "").trim();
    return /出生|卒年|死亡/.test(label);
  }

  function buildSatelliteGraph(centerId, centerLabel, items) {
    const cid = String(centerId);
    const nodes = [{
      id: cid,
      person_id: centerId,
      label: centerLabel,
      role: "center",
    }];
    const edges = [];
    let attrIdx = 0;
    const isBlank = (value) => (
      globalThis.GraphEdgeSchema?.isMeaninglessGraphLabel?.(value)
      ?? !String(value ?? "").trim()
    );
    items.forEach((item) => {
      const value = String(item.value || "").trim();
      if (isBlank(value)) return;
      const nid = `attr-${attrIdx++}`;
      nodes.push({ id: nid, label: value, role: "hop1" });
      edges.push({
        id: `e-attr-${nid}`,
        source: cid,
        target: nid,
        type: "association",
        label: String(item.label || "").trim(),
      });
    });
    const payload = {
      center_id: centerId,
      nodes,
      edges,
      stats: { node_count: nodes.length, edge_count: edges.length, steps: 1 },
    };
    return globalThis.GraphEdgeSchema?.sanitizeGraphPayload?.(payload) ?? payload;
  }

  async function loadSingleGraphData(pid, signal) {
    if (state.singleView === "basic") {
      const display = await api(`/api/person/${pid}/module/basic?format=display`, { signal });
      const items = (display.rows || [])
        .filter((row) => !isBirthDeathRow(row))
        .map((row) => ({ label: row.label, value: row.value }));
      return buildSatelliteGraph(pid, state.personLabel, items);
    }
    if (state.singleView === "text") {
      const display = await api(`/api/person/${pid}/module/text_role?format=display&limit=200`, { signal });
      const titleIdx = (display.columns || []).indexOf("c_title_chn");
      const items = (display.rows || []).map((row) => {
        const cell = titleIdx >= 0 ? row.cells?.[titleIdx] : row.cells?.[0];
        return { label: "著述", value: cell?.text || "" };
      });
      const data = buildSatelliteGraph(pid, state.personLabel, items);
      if (display.total > (display.rows?.length || 0)) {
        data.stats = { ...data.stats, truncated: true };
      }
      return data;
    }
    const kind = state.singleView === "kinship"
      ? "kinship"
      : state.singleView === "association"
        ? "association"
        : "all";
    const q = new URLSearchParams({
      person_id: String(pid),
      steps: "1",
      kind,
    });
    const data = await api(`/api/visual/single?${q}`, { signal });
    if (kind === "kinship" || kind === "association") {
      return filterGraphByRelationKind(data, kind);
    }
    return data;
  }

  function resetSingleViewToAll(reload = false) {
    state.singleView = "all";
    state.kind = "all";
    state.steps = 1;
    state.categoryFilters = cloneCategoryFilters();
    syncSingleViewUI();
    if (reload && hasSelectedPerson() && state.mode === "single") {
      loadGraph();
    }
  }

  function syncSingleViewUI() {
    document.querySelectorAll(".visual-single-view").forEach((btn) => {
      const active = btn.dataset.view === state.singleView && state.singleView !== "all";
      btn.classList.toggle("active", active);
    });
    const status = $("#visualSingleViewStatus");
    if (!status) return;
    const label = SINGLE_VIEW_LABELS[state.singleView] || SINGLE_VIEW_LABELS.all;
    if (state.singleView === "all") {
      status.textContent = `當前：${label}`;
      return;
    }
    status.innerHTML = `當前：${escapeHtml(label)} · <button type="button" class="link-btn visual-reset-all">恢復全量圖譜</button>`;
    status.querySelector(".visual-reset-all")?.addEventListener("click", () => {
      resetSingleViewToAll(true);
    });
  }

  function fmtYears(p) {
    const b = p?.c_birthyear;
    const d = p?.c_deathyear;
    if (b == null && d == null) return "";
    return `${b ?? "—"}–${d ?? "—"}`;
  }

  async function loadLockedPerson(personId, { signal } = {}) {
    const data = await api(`/api/person/${personId}`, {
      signal,
      loading: { message: "載入人物…", mode: "bar" },
    });
    const p = data.person;
    if (!p) throw new Error(`未找到人物編號 ${personId}`);
    const newId = Number(p.c_personid);
    if (state.personId !== newId) clearModeCache();
    state.personId = newId;
    state.personLabel = formatPersonName(p);
    state.personLocked = true;
    updatePersonCard(p);
    return p;
  }

  function updatePersonCard(person) {
    const card = $("#visualPersonCard");
    const nameEl = $("#visualPersonName");
    const metaEl = $("#visualPersonMeta");
    if (!card || !nameEl) return;
    if (hasSelectedPerson()) {
      card.classList.remove("hidden");
      nameEl.textContent = `${state.personLabel}（${state.personId}）`;
      if (metaEl && person) {
        const parts = [
          person.c_dynasty_chn,
          fmtYears(person),
          person.c_index_addr_chn,
        ].filter(Boolean);
        metaEl.textContent = parts.join(" · ") || "—";
      }
    } else {
      card.classList.add("hidden");
    }
  }

  function updateChromeForMode() {
    updatePersonPanels();
    updateVisualLayout();
    const needsPerson = LOCKED_MODES.has(state.mode);
    const runBtn = $("#runVisualBtn");
    if (runBtn) {
      const disabled = needsPerson && !hasSelectedPerson();
      runBtn.disabled = disabled || state.loading || state.personPendingLoad;
      runBtn.title = disabled ? "請先檢索並選擇人物" : "";
    }
  }

  async function applyInitialQuery() {
    const params = new URLSearchParams(globalThis.location.search);
    const mode = params.get("mode")?.trim();
    let personIdParam = params.get("person_id");
    const run = params.get("run") === "1";
    const qParam = params.get("q")?.trim();

    if (mode && MODES.has(mode)) {
      await setMode(mode, { skipShare: true, skipAutoLoad: true });
    } else {
      await setMode("single", { skipShare: true, skipAutoLoad: true });
    }

    if (qParam && $("#visualSearchInput")) {
      $("#visualSearchInput").value = qParam;
    }

    const pendingFromUrl = state.mode === "single"
      && LOCKED_MODES.has(state.mode)
      && (personIdParam || qParam);
    if (pendingFromUrl) {
      enterPendingProfilePhase({
        label: qParam || `人物 #${personIdParam}`,
      });
    }

    if (!personIdParam && qParam && LOCKED_MODES.has(state.mode)) {
      try {
        if (/^\d+$/.test(qParam)) {
          personIdParam = qParam;
        } else {
          const res = await api(`/api/search?q=${encodeURIComponent(qParam)}&type=person&limit=1`, {
            loading: { message: "檢索人物…", mode: "bar" },
          });
          const row = searchResults(res)[0];
          if (row?.c_personid) {
            personIdParam = String(row.c_personid);
          } else {
            toast(`未找到「${qParam}」`, true);
            enterSearchPhase();
            await activateModeCanvas();
            updateChromeForMode();
            return;
          }
        }
      } catch (err) {
        if (isUserCancel(err)) {
          enterSearchPhase();
          updateChromeForMode();
          return;
        }
        toast(err.message, true);
        enterSearchPhase();
        updateChromeForMode();
        return;
      }
    }

    if (personIdParam && LOCKED_MODES.has(state.mode)) {
      const load = bumpVisualLoad("正在載入人物");
      try {
        await loadLockedPerson(Number(personIdParam), { signal: load.signal });
        if (load.stale()) return;
        if (state.mode === "single") {
          resetSingleViewToAll(false);
        }
        if (state.mode === "family") {
          state.categoryFilters = defaultFamilyCategoryFilters();
          syncVisualCategoryButtons();
        }
        if (state.mode === "circle") {
          syncVisualCategoryButtons();
        }
        enterProfilePhase();
        updateChromeForMode();
        await activateModeCanvas({ run, load });
      } catch (err) {
        if (load.stale() || isBenignVisualAbort(err)) return;
        if (isUserCancel(err)) {
          enterSearchPhase();
          updateChromeForMode();
          return;
        }
        toast(err.message, true);
        enterSearchPhase();
        updateChromeForMode();
      }
    } else if (LOCKED_MODES.has(state.mode)) {
      enterSearchPhase();
      await activateModeCanvas();
    } else if (state.mode === "explore") {
      await activateModeCanvas();
    }

    updateChromeForMode();
    if (!params.toString()) syncShareUrl();
  }

  function syncVisualCategoryButtons() {
    document.querySelectorAll(".visual-graph-cat").forEach((btn) => {
      const group = btn.dataset.catGroup;
      const cat = btn.dataset.cat;
      if (!group || !cat) return;
      const on = state.categoryFilters[group]?.[cat] !== false;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function updateVisualCategoryPanels() {
    $("#visualCircleAssocCatGroup")?.classList.toggle("hidden", state.mode !== "circle");
    $("#visualFamilyKinCatGroup")?.classList.toggle("hidden", state.mode !== "family");
  }

  function applyVisualCategoryFilters() {
    let filters = state.categoryFilters;
    if (state.mode === "single") {
      filters = categoryFiltersForSingleView(state.singleView);
    } else if (state.mode === "family") {
      filters = categoryFiltersForFamily();
    } else if (state.mode === "circle") {
      filters = categoryFiltersForCircle();
    }
    globalThis.CbdbGraph?.setCategoryFilters?.(filters);
    if (state.graphData) {
      setDetail(state.graphSelection?.kind ? state.graphSelection : { kind: "none" });
    }
  }

  function renderOptionsForMode() {
    let filters = state.categoryFilters;
    if (state.mode === "single") {
      filters = categoryFiltersForSingleView(state.singleView);
    } else if (state.mode === "family") {
      filters = categoryFiltersForFamily();
    } else if (state.mode === "circle") {
      filters = categoryFiltersForCircle();
    }
    const opts = { mode: state.mode, categoryFilters: filters, graphKind: "all" };
    if (state.mode === "single") {
      if (state.singleView === "kinship") opts.graphKind = "kinship";
      else if (state.singleView === "association") opts.graphKind = "association";
      else if (state.singleView === "all") opts.graphKind = "all";
      else opts.graphKind = "all";
    }
    return opts;
  }

  function syncShareUrl() {
    const params = new URLSearchParams();
    params.set("mode", state.mode);
    if (state.mode !== "explore" && hasSelectedPerson()) {
      params.set("person_id", String(state.personId));
    }
    globalThis.history.replaceState(null, "", `/visual?${params}`);
  }

  function setDetail(selection) {
    if (selection) state.graphSelection = selection;
    const host = $("#visualGraphDetail .relations-graph-detail-inner");
    if (!host) return;
    host.innerHTML = GraphShell.renderGraphDetail(selection, state.graphData, {
      centerLabel: state.personLabel,
      centerPersonId: state.personId,
      showEdgeLabels: state.showEdgeLabels,
      graphOptions: renderOptionsForMode(),
      standalone: true,
      lockedCenter: isLockedMode(),
    });
    GraphShell.bindDetailActions(host, {
      onOpenPerson: () => {},
      onToggleEdgeLabels: () => {
        state.showEdgeLabels = !state.showEdgeLabels;
        CbdbGraph.setEdgeLabelsVisible(state.showEdgeLabels);
        setDetail({ kind: "none" });
      },
      onHighlightPath: (idx) => highlightExplorePath(idx),
    });
  }

  function findEdgeBetween(a, b) {
    return (state.graphData?.edges || []).find(
      (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a),
    );
  }

  function highlightExplorePath(index) {
    const path = state.explorePaths[index];
    if (!path?.found || !state.graphData) return;
    const edgeIds = [];
    for (const step of path.steps || []) {
      const match = findEdgeBetween(String(step.from), String(step.to));
      if (match) edgeIds.push(match.id);
    }
    CbdbGraph.highlightPath(edgeIds);
    setDetail({
      kind: "path",
      index,
      from: path.from,
      to: path.to,
      steps: path.steps,
    });
  }

  function pathLabel(p) {
    return `${p.from_name || p.from} → ${p.to_name || p.to}`;
  }

  function renderPathList(paths) {
    const host = $("#pathListHost");
    if (!host) return;
    if (!paths?.length) {
      host.classList.add("hidden");
      return;
    }
    const sorted = [...paths].map((p, i) => ({ p, i })).sort((a, b) => {
      if (a.p.found !== b.p.found) return a.p.found ? -1 : 1;
      return (a.p.hops || 99) - (b.p.hops || 99);
    });
    host.classList.remove("hidden");
    host.innerHTML = `
      <h4>路徑列表</h4>
      <ul class="path-list">
        ${sorted.map(({ p, i }) => `
          <li>
            <button type="button" class="path-list-item" data-path-index="${i}">
              ${p.found ? "✓" : "✗"} ${GraphShell.escapeHtml(pathLabel(p))}
              ${p.found ? `（${p.hops} 跳）` : "（未找到）"}
            </button>
          </li>`).join("")}
      </ul>`;
    host.querySelectorAll(".path-list-item").forEach((btn) => {
      btn.addEventListener("click", () => highlightExplorePath(Number(btn.dataset.pathIndex)));
    });
  }

  function renderBranchStats(stats) {
    const host = $("#addrStatsHost");
    if (!host) return;
    if (!stats?.length) {
      host.classList.add("hidden");
      return;
    }
    host.classList.remove("hidden");
    host.innerHTML = GraphShell.renderBranchStats(stats);
    host.querySelectorAll(".addr-stat-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = stats[Number(btn.dataset.addrIndex)];
        if (!item || !state.graphData) return;
        const hubId = `geo:${item.split_key}`;
        const hub = (state.graphData.nodes || []).find((n) => n.id === hubId);
        let nodeIds = [];
        if (hub) {
          nodeIds = [hubId];
        } else {
          nodeIds = (item.sample_persons || [])
            .map((s) => String(s.id))
            .filter((id) => (state.graphData.nodes || []).some((n) => String(n.person_id) === id));
        }
        if (nodeIds.length) {
          CbdbGraph.highlightNodes(nodeIds);
          CbdbGraph.fitNodes(nodeIds);
        }
        toast(`分支：${item.addr_chn || item.split_key}（${item.count} 人）`);
      });
    });
  }

  function renderAddrStats(stats) {
    const host = $("#addrStatsHost");
    if (!host) return;
    if (!stats?.length) {
      host.classList.add("hidden");
      return;
    }
    host.classList.remove("hidden");
    host.innerHTML = GraphShell.renderAddrStats(stats);
    host.querySelectorAll(".addr-stat-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = stats[Number(btn.dataset.addrIndex)];
        if (!item || !state.graphData) return;
        const nodeIds = (state.graphData.nodes || [])
          .filter((n) => {
            if (Number(n.person_id) === Number(state.graphData.center_id)) return false;
            return (item.sample_persons || []).some((s) => String(s.id) === String(n.person_id));
          })
          .map((n) => n.id);
        if (!nodeIds.length && item.sample_persons?.[0]) {
          nodeIds.push(String(item.sample_persons[0].id));
        }
        if (nodeIds.length) {
          CbdbGraph.highlightNodes(nodeIds);
          CbdbGraph.fitNodes(nodeIds);
        }
        toast(`籍貫：${item.addr_chn}（${item.count} 人）`);
      });
    });
  }

  function updateStats(data) {
    const el = $("#visualStats");
    if (!el || !data?.stats) return;
    const s = data.stats;
    let text = `節點 ${s.node_count} · 關係 ${s.edge_count}`;
    if (state.mode === "single" && state.singleView === "kinship") {
      text += ` · 僅親屬 ${s.kinship_edges ?? s.edge_count}`;
    } else if (state.mode === "single" && state.singleView === "association") {
      text += ` · 僅社會 ${s.association_edges ?? s.edge_count}`;
    } else if (s.kinship_edges != null && s.association_edges != null) {
      text += ` · 親屬 ${s.kinship_edges} · 社會 ${s.association_edges}`;
    }
    if (s.steps) text += ` · ${s.steps} 步`;
    if (s.truncated) text += " · 已截斷";
    if (s.pairs_total != null) {
      text += ` · 路徑 ${s.pairs_found}/${s.pairs_total}`;
    }
    el.textContent = text;
  }

  function toast(msg, isErr = false) {
    const host = $("#toastHost");
    if (!host) {
      console.warn(msg);
      return;
    }
    const el = document.createElement("div");
    el.className = "toast" + (isErr ? " err" : "");
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function requireLockedPersonId() {
    if (!hasSelectedPerson()) {
      throw new Error("請先檢索並選擇人物");
    }
    return state.personId;
  }

  function setRunButtonLoading(on) {
    const btn = $("#runVisualBtn");
    if (!btn) return;
    btn.disabled = on || (LOCKED_MODES.has(state.mode) && !hasSelectedPerson());
    btn.classList.toggle("is-loading", on);
    btn.textContent = on ? "生成中…" : "生成圖譜";
  }

  async function loadGraph(opts = {}) {
    const load = opts.load ?? bumpVisualLoad("正在載入圖譜");
    if (load.stale()) return;

    if (LOCKED_MODES.has(state.mode) && !hasSelectedPerson()) {
      toast("請先檢索並選擇人物", true);
      enterSearchPhase();
      return;
    }

    const canvas = $("#visualGraphCanvas");
    if (!canvas) return;

    state.loading = true;
    setRunButtonLoading(true);
    if (!load.stale()) {
    canvas.innerHTML = '<p class="empty">正在計算圖譜…</p>';
    $("#addrStatsHost")?.classList.add("hidden");
    $("#pathListHost")?.classList.add("hidden");
    }

    const compute = async () => {
      let data;
      if (state.mode === "single") {
        const pid = requireLockedPersonId();
        data = await loadSingleGraphData(pid, load.signal);
        state.kind = state.singleView === "kinship" || state.singleView === "association"
          ? state.singleView
          : "all";
      } else if (state.mode === "family") {
        const pid = requireLockedPersonId();
        const q = new URLSearchParams({
          person_id: String(pid),
          max_up: String($("#maxUp")?.value || 3),
          max_down: String($("#maxDown")?.value || 3),
          max_col: String($("#maxCol")?.value || 3),
          addr_split: $("#geoLayer")?.checked !== false ? "true" : "false",
          spouse_expand: $("#spouseExpand")?.checked !== false ? "true" : "false",
          prune_by_addr: "false",
        });
        data = await api(`/api/visual/family?${q}`, { signal: load.signal });
      } else if (state.mode === "circle") {
        const pid = requireLockedPersonId();
        const q = new URLSearchParams({
          person_id: String(pid),
          steps: String(state.circleSteps),
        });
        data = await api(`/api/visual/circle?${q}`, { signal: load.signal });
      } else if (state.mode === "explore") {
        const ids = await resolveExploreIds(load.signal);
        if (ids.length < 2) throw new Error("請至少輸入 2 位人物");
        if (ids.length > 10) throw new Error("最多 10 位人物");
        if (ids.length > 3) {
          const ok = await confirmExplore(ids.length);
          if (!ok) return;
        }
        const edgeTypes = [];
        if ($("#exploreKin")?.checked) edgeTypes.push("kinship");
        if ($("#exploreAssoc")?.checked) edgeTypes.push("association");
        data = await api("/api/visual/explore", {
          method: "POST",
          signal: load.signal,
          body: JSON.stringify({
            person_ids: ids,
            strategy: "pairwise_shortest",
            edge_types: edgeTypes,
            max_depth: Number($("#exploreDepth")?.value || 6),
          }),
        });
        if (load.stale()) return;
        state.explorePaths = data.paths || [];
      }

      if (!data || load.stale()) return;

      syncShareUrl();
      if (state.mode === "explore") {
        state.explorePaths = data.paths || [];
      }
      await paintGraphData(data, { stale: load.stale });
      if (load.stale()) return;
      saveCurrentModeCache();
    };

    try {
      if (globalThis.CbdbLoading) {
        await CbdbLoading.withLoading(compute, { message: "生成圖譜中…", mode: "bar" });
      } else {
        await compute();
      }
    } catch (err) {
      if (load.stale() || isBenignVisualAbort(err)) return;
      if (isUserCancel(err)) {
        showEmptyCanvasPlaceholder();
        return;
      }
      canvas.innerHTML = `<p class="empty">${GraphShell.escapeHtml(err.message)}</p>`;
      toast(err.message, true);
    } finally {
      if (!load.stale()) {
      state.loading = false;
      setRunButtonLoading(false);
      updateChromeForMode();
      }
    }
  }

  function confirmExplore(count) {
    const pairs = (count * (count - 1)) / 2;
    return new Promise((resolve) => {
      const modal = $("#exploreConfirmModal");
      const text = $("#exploreConfirmText");
      if (!modal || !text) { resolve(true); return; }
      text.textContent = `您選擇了 ${count} 位人物，將計算 ${pairs} 條路徑。預計需時較長，是否繼續？`;
      modal.classList.remove("hidden");
      const cleanup = (v) => {
        modal.classList.add("hidden");
        $("#exploreOkBtn")?.removeEventListener("click", onOk);
        $("#exploreCancelBtn")?.removeEventListener("click", onCancel);
        resolve(v);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      $("#exploreOkBtn")?.addEventListener("click", onOk);
      $("#exploreCancelBtn")?.addEventListener("click", onCancel);
    });
  }

  async function resolveExploreIds(signal) {
    const raw = $("#exploreInput")?.value || "";
    const tokens = raw.split(/[\s,，、;；\n]+/).map((t) => t.trim()).filter(Boolean);
    const ids = [];
    const missing = [];
    for (const tok of tokens) {
      if (/^\d+$/.test(tok)) {
        ids.push(Number(tok));
        continue;
      }
      const res = await api(`/api/search?q=${encodeURIComponent(tok)}&type=person&limit=1`, {
        signal,
        loading: { message: "檢索人物…", mode: "bar" },
      });
      const row = searchResults(res)[0];
      if (row?.c_personid) ids.push(Number(row.c_personid));
      else missing.push(tok);
    }
    if (missing.length) {
      throw new Error(`未找到：${missing.join("、")}`);
    }
    return [...new Set(ids)];
  }

  async function setMode(mode, opts = {}) {
    const load = bumpVisualLoad("已切換視圖");
    if (mode !== state.mode && !opts.skipSaveCache) {
      saveCurrentModeCache();
    }
    if (mode !== "single") {
      clearPendingProfilePhase();
    }
    state.mode = mode;
    document.querySelectorAll(".visual-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.mode === mode);
    });
    document.querySelectorAll(".visual-mode-panel").forEach((p) => p.classList.add("hidden"));
    if (mode === "single") {
      syncSingleViewUI();
    }
    if (mode === "family") {
      $("#familyControls")?.classList.remove("hidden");
      const cached = getModeCacheEntry("family");
      state.categoryFilters = cached?.categoryFilters
        ? cloneCategoryFilters(cached.categoryFilters)
        : defaultFamilyCategoryFilters();
      syncVisualCategoryButtons();
    }
    if (mode === "circle") {
      $("#circleControls")?.classList.remove("hidden");
      const cached = getModeCacheEntry("circle");
      if (cached?.circleSteps != null) {
        state.circleSteps = cached.circleSteps;
        document.querySelectorAll(".visual-circle-steps").forEach((b) => {
          b.classList.toggle("active", Number(b.dataset.steps) === state.circleSteps);
        });
      }
      if (cached?.categoryFilters) {
        state.categoryFilters = cloneCategoryFilters(cached.categoryFilters);
      }
    }
    if (mode === "explore") $("#exploreControls")?.classList.remove("hidden");
    $("#addrStatsHost")?.classList.toggle("hidden", mode !== "circle" && mode !== "family");
    $("#pathListHost")?.classList.toggle("hidden", mode !== "explore");
    updatePersonPanels();
    updateChromeForMode();
    updateVisualCategoryPanels();
    syncVisualCategoryButtons();
    if (!opts.skipShare) syncShareUrl();
    checkIndexBanner();
    if (!opts.skipAutoLoad) {
      await activateModeCanvas({ run: opts.run, load });
    }
  }

  async function checkIndexBanner() {
    const banner = $("#indexBanner");
    if (!banner) return;
    try {
      const st = await api("/api/visual/index/status");
      if (state.mode === "explore" && !st.ready) {
        banner.classList.remove("hidden");
        banner.innerHTML = `
          <p>關係探索需要本地索引（首次構建約需數分鐘）。</p>
          <button type="button" class="btn sm primary" id="buildIndexBtn">構建索引</button>
          <span class="meta" id="indexBuildStatus"></span>`;
        $("#buildIndexBtn")?.addEventListener("click", async () => {
          await api("/api/visual/index/build", {
            method: "POST",
            loading: { message: "構建圖譜索引…", mode: "bar" },
          });
          pollIndex();
        });
      } else if (st.stale) {
        banner.classList.remove("hidden");
        banner.innerHTML = `<p class="meta">索引與當前 CBDB 不一致，建議 <button type="button" class="btn sm" id="buildIndexBtn">重建索引</button></p>`;
        $("#buildIndexBtn")?.addEventListener("click", () => api("/api/visual/index/build", {
          method: "POST",
          loading: { message: "重建圖譜索引…", mode: "bar" },
        }).then(pollIndex));
      } else {
        banner.classList.add("hidden");
      }
    } catch {
      banner.classList.add("hidden");
    }
  }

  async function pollIndex() {
    const statusEl = $("#indexBuildStatus");
    const tick = async () => {
      const st = await api("/api/visual/index/status");
      if (statusEl) {
        statusEl.textContent = st.building
          ? `構建中… ${Math.round((st.progress || 0) * 100)}%`
          : st.ready ? "索引已就緒" : "";
      }
      if (st.building) setTimeout(tick, 2000);
      else checkIndexBanner();
    };
    tick();
  }

  function exportPng() {
    const dataUrl = CbdbGraph.exportPng?.();
    if (!dataUrl) {
      toast("請先生成圖譜", true);
      return;
    }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `cbdb-visual-${state.mode}-${state.personId || "graph"}.png`;
    a.click();
    toast("已匯出 PNG");
  }

  function setVisualFullscreen(on) {
    const panel = document.querySelector(".visual-graph-panel");
    const btn = $("#visualFullscreenBtn");
    if (!panel) return;
    panel.classList.toggle("is-fullscreen", on);
    btn?.setAttribute("aria-pressed", on ? "true" : "false");
    if (btn) btn.textContent = on ? "退出全屏" : "全屏";
    requestAnimationFrame(() => globalThis.CbdbGraph?.resize?.({ refit: true }));
  }

  function bindUi() {
    document.querySelectorAll(".visual-tab").forEach((tab) => {
      tab.addEventListener("click", async () => {
        await setMode(tab.dataset.mode);
      });
    });
    $("#visualSearchForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      runVisualPersonSearch(0);
    });
    $("#visualSearchPager")?.querySelector("[data-pager-prev]")?.addEventListener("click", () => {
      if (state.searchOffset <= 0 || !state.lastSearchQuery) return;
      runVisualPersonSearch(Math.max(0, state.searchOffset - VISUAL_PAGE_SIZE));
    });
    $("#visualSearchPager")?.querySelector("[data-pager-next]")?.addEventListener("click", () => {
      if (!state.lastSearchQuery) return;
      if (state.searchOffset + VISUAL_PAGE_SIZE >= state.lastSearchTotal) return;
      runVisualPersonSearch(state.searchOffset + VISUAL_PAGE_SIZE);
    });
    $("#visualAdvancedToggleBtn")?.addEventListener("click", () => {
      setVisualAdvancedOpen(!visualAdvancedOpen);
    });
    $("#visualAdvancedMode")?.addEventListener("change", () => {
      updateVisualAdvancedForm();
      updateVisualAdvancedToggle();
    });
    for (const id of VISUAL_ADV_FILTER_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      const onChange = () => {
        updateVisualAdvancedForm();
        updateVisualAdvancedToggle();
      };
      el.addEventListener("input", onChange);
      el.addEventListener("change", onChange);
    }
    $("#visualChangePersonBtn")?.addEventListener("click", beginChangePerson);
    document.querySelectorAll(".visual-single-view").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const view = btn.dataset.view;
        if (!view || view === state.singleView) return;
        const load = bumpVisualLoad("已切換視圖類型");
        saveCurrentModeCache();
        state.singleView = view;
        state.kind = view === "kinship" || view === "association" ? view : "all";
        state.steps = 1;
        syncSingleViewUI();
        if (state.mode !== "single" || !hasSelectedPerson()) return;
        const cached = getModeCacheEntry("single", view);
        if (cached) {
          await restoreGraphFromCache(cached, load);
        } else {
          await loadGraph({ load });
        }
      });
    });
    document.querySelectorAll(".visual-graph-cat").forEach((btn) => {
      btn.addEventListener("click", () => {
        const group = btn.dataset.catGroup;
        const cat = btn.dataset.cat;
        if (!group || !cat || !state.categoryFilters[group]) return;
        state.categoryFilters[group][cat] = !state.categoryFilters[group][cat];
        syncVisualCategoryButtons();
        if (state.mode === "family" || state.mode === "circle") {
          applyVisualCategoryFilters();
          saveCurrentModeCache();
          return;
        }
        applyVisualCategoryFilters();
      });
    });
    document.querySelectorAll(".visual-circle-steps").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const steps = Number(btn.dataset.steps);
        if (!steps || steps === state.circleSteps) return;
        state.circleSteps = steps;
        document.querySelectorAll(".visual-circle-steps").forEach((b) => {
          b.classList.toggle("active", Number(b.dataset.steps) === steps);
        });
        await reloadCircleGraphIfReady();
      });
    });
    for (const id of ["maxUp", "maxDown", "maxCol"]) {
      document.getElementById(id)?.addEventListener("change", reloadFamilyGraphIfReady);
    }
    $("#geoLayer")?.addEventListener("change", reloadFamilyGraphIfReady);
    $("#spouseExpand")?.addEventListener("change", reloadFamilyGraphIfReady);
    $("#runVisualBtn")?.addEventListener("click", loadGraph);
    $("#visualExportBtn")?.addEventListener("click", exportPng);
    $("#visualZoomInBtn")?.addEventListener("click", () => CbdbGraph.zoomBy?.(1.15));
    $("#visualZoomOutBtn")?.addEventListener("click", () => CbdbGraph.zoomBy?.(0.87));
    $("#visualFitBtn")?.addEventListener("click", () => CbdbGraph.resize?.({ refit: true }));
    $("#visualFullscreenBtn")?.addEventListener("click", () => {
      const panel = document.querySelector(".visual-graph-panel");
      setVisualFullscreen(!panel?.classList.contains("is-fullscreen"));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const panel = document.querySelector(".visual-graph-panel");
      if (panel?.classList.contains("is-fullscreen")) {
        e.preventDefault();
        setVisualFullscreen(false);
      }
    });
    window.addEventListener("resize", () => {
      globalThis.CbdbGraph?.resize?.();
    });
  }

  bindUi();
  syncVisualCategoryButtons();
  syncSingleViewUI();
  updateVisualCategoryPanels();
  updateVisualAdvancedForm();
  updateVisualAdvancedToggle();
  loadVisualDynasties();
  applyInitialQuery();
})();
