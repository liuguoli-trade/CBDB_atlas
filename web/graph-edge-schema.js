/**
 * CBDB Atlas — unified graph edge taxonomy (结构类型 / 语义分类 / 画布线型)
 * Single source for person-search graph + visual-search graph.
 */
(function (global) {
  const PALETTE = {
    center: "#1a5f7a",
    kin: "#9a7b2f",
    assoc: "#4a7c94",
  };

  const KIN_HOP_COLORS = {
    1: "#9a7b2f",
    2: "#a8873a",
    3: "#b69242",
    4: "#c49e4e",
    5: "#d2aa5a",
  };

  const ASSOC_HOP_COLORS = {
    1: "#4a7c94",
    2: "#5a8a9f",
    3: "#6a98aa",
    4: "#7aa6b5",
    5: "#8ab4c0",
  };

  const ROLE_COLORS = {
    "path-endpoint": "#c45c2a",
    "path-via": "#8b7355",
  };

  const GEO_NODE_COLORS = {
    choronym: "#8b7355",
    place: "#5a7a52",
  };

  /** Layer A: structural edge types → line style & color on canvas */
  const STRUCTURAL_TYPES = {
    kinship: {
      id: "kinship",
      label: "血親",
      lineStyle: "solid",
      color: PALETTE.kin,
      arrowShape: "triangle",
      categoryGroup: "kin",
    },
    "kinship-marriage": {
      id: "kinship-marriage",
      label: "姻親·配偶",
      lineStyle: "dashed",
      color: "#b56576",
      arrowShape: "none",
      categoryGroup: "kin",
    },
    association: {
      id: "association",
      label: "社會關係",
      lineStyle: "dotted",
      color: PALETTE.assoc,
      arrowShape: "triangle",
      categoryGroup: "assoc",
    },
    path: {
      id: "path",
      label: "探索路徑",
      lineStyle: "solid",
      color: "#c45c2a",
      arrowShape: "triangle",
      categoryGroup: null,
    },
    "geo-link": {
      id: "geo-link",
      label: "郡望／籍貫",
      lineStyle: "dotted",
      color: "#a89070",
      arrowShape: "none",
      categoryGroup: null,
    },
  };

  /** Layer B: semantic categories → visibility filters only */
  const CATEGORY_LABELS = {
    kin: { core: "直系×家庭", extended: "姻親×旁系" },
    assoc: {
      political: "官場政治",
      scholarly: "師友學術",
      literary: "文學書寫",
      other: "其他社會",
    },
  };

  const DEFAULT_CATEGORY_FILTERS = {
    kin: { core: true, extended: false },
    assoc: {
      political: true,
      scholarly: true,
      literary: false,
      other: false,
    },
  };

  /** Person graph「全部」：亲属 + 社会所有语义分类均可见 */
  const ALL_CATEGORY_FILTERS = {
    kin: { core: true, extended: true },
    assoc: {
      political: true,
      scholarly: true,
      literary: true,
      other: true,
    },
  };

  function fullCategoryFilters() {
    return cloneCategoryFilters(ALL_CATEGORY_FILTERS);
  }

  function categoryFiltersForGraphKind(kind = "all") {
    const filters = fullCategoryFilters();
    if (kind === "kinship") {
      filters.assoc = {
        political: false,
        scholarly: false,
        literary: false,
        other: false,
      };
    } else if (kind === "association") {
      filters.kin = { core: false, extended: false };
    }
    return filters;
  }

  const LEGEND_STRUCTURAL_ORDER = [
    "kinship",
    "kinship-marriage",
    "association",
    "path",
    "geo-link",
  ];

  function cloneCategoryFilters(source = DEFAULT_CATEGORY_FILTERS) {
    return {
      kin: { ...source.kin },
      assoc: { ...source.assoc },
    };
  }

  const MEANINGLESS_GRAPH_LABELS = new Set([
    "",
    "—",
    "-",
    "－",
    "未详",
    "未詳",
    "不详",
    "不詳",
    "未知",
    "无",
    "無",
    "无记载",
    "無記載",
    "不明",
    "缺载",
    "缺載",
    "n/a",
    "na",
    "null",
    "none",
  ]);

  const LABEL_BRACKET_PAIRS = [
    ["【", "】"],
    ["[", "]"],
    ["(", ")"],
    ["（", "）"],
    ["「", "」"],
    ["『", "』"],
    ["《", "》"],
    ["〈", "〉"],
    ["［", "］"],
    ["｛", "｝"],
    ["{", "}"],
  ];

  function normalizeGraphLabel(value) {
    let t = String(value ?? "").trim();
    if (!t) return "";
    let prev = null;
    while (t && t !== prev) {
      prev = t;
      for (const [openC, closeC] of LABEL_BRACKET_PAIRS) {
        const minLen = openC.length + closeC.length;
        if (t.length > minLen && t.startsWith(openC) && t.endsWith(closeC)) {
          t = t.slice(openC.length, -closeC.length).trim();
          break;
        }
      }
    }
    return t;
  }

  function isMeaninglessGraphLabel(value) {
    const t = normalizeGraphLabel(value);
    if (!t) return true;
    if (MEANINGLESS_GRAPH_LABELS.has(t)) return true;
    return MEANINGLESS_GRAPH_LABELS.has(t.toLowerCase());
  }

  function shouldDropGraphNode(node) {
    if (!node || node.role === "center") return false;
    const personId = node.person_id;
    if (personId != null && Number.isFinite(Number(personId))) return false;
    const label = String(node.full_label || node.label || node.split_key || "").trim();
    return isMeaninglessGraphLabel(label);
  }

  function sanitizeGraphPayload(data) {
    if (!data || !Array.isArray(data.nodes) || !data.nodes.length) return data;
    const drop = new Set(
      data.nodes.filter(shouldDropGraphNode).map((n) => String(n.id)),
    );
    if (!drop.size) return data;
    const nodes = data.nodes.filter((n) => !drop.has(String(n.id)));
    const edges = (data.edges || []).filter(
      (e) => !drop.has(String(e.source)) && !drop.has(String(e.target)),
    );
    const stats = data.stats ? { ...data.stats } : {};
    stats.node_count = nodes.length;
    stats.edge_count = edges.length;
    return { ...data, nodes, edges, stats };
  }

  function hopIndex(role) {
    if (role === "center") return 0;
    if (role === "assoc" || role === "kin") return 1;
    const hop = Number.parseInt(String(role || "").replace("hop", ""), 10);
    return Number.isFinite(hop) ? Math.min(Math.max(hop, 1), 5) : 1;
  }

  function nodeRelationKind(nodeId, edges) {
    let kin = 0;
    let assoc = 0;
    for (const edge of edges || []) {
      if (edge.source !== nodeId && edge.target !== nodeId) continue;
      if (edge.type === "kinship" || edge.type === "kinship-marriage") kin += 1;
      else if (edge.type === "association") assoc += 1;
    }
    if (kin > 0 && assoc === 0) return "kinship";
    if (assoc > 0 && kin === 0) return "association";
    if (kin > 0) return "kinship";
    return "association";
  }

  function nodeColorForRole(role, opts = {}) {
    const { nodeId, edges, graphKind = "all", nodeType = "person" } = opts;
    if (nodeType === "choronym") return GEO_NODE_COLORS.choronym;
    if (nodeType === "place") return GEO_NODE_COLORS.place;
    if (role === "center") return PALETTE.center;
    if (ROLE_COLORS[role]) return ROLE_COLORS[role];
    const hop = hopIndex(role);
    let kind = graphKind;
    if (kind === "all" && nodeId && edges) kind = nodeRelationKind(nodeId, edges);
    if (kind === "association") return ASSOC_HOP_COLORS[hop] || PALETTE.assoc;
    return KIN_HOP_COLORS[hop] || PALETTE.kin;
  }

  function nodeRoleLegendLabel(role, nodeType = "person") {
    if (nodeType === "choronym") return "郡望節點";
    if (nodeType === "place") return "籍貫節點";
    if (role === "center") return "中心人物";
    if (role === "path-endpoint") return "查詢人物";
    if (role === "path-via") return "路徑中間人";
    if (role === "assoc") return "社會關係（1 步）";
    if (role === "kin") return "親屬（1 步）";
    const hop = hopIndex(role);
    if (hop > 1) return `第 ${hop} 步節點`;
    return "關聯節點";
  }

  function edgeVisual(edgeType) {
    return STRUCTURAL_TYPES[edgeType] || STRUCTURAL_TYPES.association;
  }

  function structuralTypeLabel(edgeType) {
    return edgeVisual(edgeType).label;
  }

  function categoryLabel(edgeType, category) {
    const visual = edgeVisual(edgeType);
    const group = visual.categoryGroup;
    if (!group || !category) return category || "—";
    return CATEGORY_LABELS[group]?.[category] || category || "—";
  }

  function lineStyleForType(edgeType) {
    return edgeVisual(edgeType).lineStyle;
  }

  function colorForType(edgeType) {
    return edgeVisual(edgeType).color;
  }

  function arrowShapeForType(edgeType) {
    return edgeVisual(edgeType).arrowShape;
  }

  function lineStyleWord(lineStyle) {
    if (lineStyle === "solid") return "實線";
    if (lineStyle === "dashed") return "虛線";
    return "點線";
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function edgePassesCategoryFilter(edge, filters) {
    const et = edge.type || "association";
    const cat = edge.category || "";
    const f = filters || DEFAULT_CATEGORY_FILTERS;
    if (et.startsWith("kinship")) {
      if (!cat) return true;
      return f.kin?.[cat] !== false;
    }
    if (et === "association") {
      if (!cat) return true;
      return f.assoc?.[cat] !== false;
    }
    return true;
  }

  function resolveGraphNodeId(selection, graphData) {
    const pid = selection?.personId;
    if (pid == null) return null;
    const key = String(pid);
    const nodes = graphData?.nodes || [];
    const match = nodes.find(
      (n) => String(n.person_id) === key || String(n.id) === key,
    );
    return match ? String(match.id) : key;
  }

  function collectLegendContext(graphData, options = {}) {
    const filters = options.categoryFilters || DEFAULT_CATEGORY_FILTERS;
    const graphKind = options.graphKind || "all";
    const edges = (graphData?.edges || []).filter(
      (e) => edgePassesCategoryFilter(e, filters),
    );
    const edgeTypesMap = new Map();
    for (const e of edges) {
      const t = e.type || "association";
      edgeTypesMap.set(t, (edgeTypesMap.get(t) || 0) + 1);
    }
    const nodeIds = new Set();
    for (const e of edges) {
      nodeIds.add(String(e.source));
      nodeIds.add(String(e.target));
    }
    const nodeRoles = new Map();
    for (const n of graphData?.nodes || []) {
      if (n.role !== "center" && !nodeIds.has(String(n.id))) continue;
      const role = n.role || "hop1";
      const nodeType = n.node_type || "person";
      const mapKey = nodeType !== "person" ? `geo:${nodeType}` : role;
      const color = nodeColorForRole(role, {
        nodeId: n.id,
        edges: graphData?.edges,
        graphKind,
        nodeType,
      });
      const label = nodeRoleLegendLabel(role, nodeType);
      const existing = nodeRoles.get(mapKey);
      if (existing) existing.count += 1;
      else nodeRoles.set(mapKey, { role, nodeType, count: 1, label, color });
    }
    return { edgeTypesMap, nodeRoles, graphKind, filters };
  }

  function renderEdgeSwatch(typeId, caption, opts = {}) {
    const spec = STRUCTURAL_TYPES[typeId] || STRUCTURAL_TYPES.association;
    const lineClass = `lg-line lg-line-${spec.lineStyle}`;
    const lineWord = lineStyleWord(spec.lineStyle);
    const countSuffix = opts.count > 1 ? ` ×${opts.count}` : "";
    const highlight = opts.highlight ? " legend-highlight" : "";
    const text = caption
      ? `${caption}（${spec.label} · ${lineWord}）`
      : `${spec.label}（${lineWord}）${countSuffix}`;
    return `<span class="${highlight.trim()}"><i class="${lineClass}" style="--lg-color:${spec.color}" aria-hidden="true"></i>${escapeHtml(text)}</span>`;
  }

  function renderNodeSwatch(color, label, opts = {}) {
    const countSuffix = opts.count > 1 ? ` ×${opts.count}` : "";
    const highlight = opts.highlight ? " legend-highlight" : "";
    return `<span class="${highlight.trim()}"><i class="lg-node" style="--lg-color:${color}" aria-hidden="true"></i>${escapeHtml(label)}${countSuffix}</span>`;
  }

  function renderContextualLegendHtml(selection, graphData, options = {}) {
    const { showEdgeLabels = false } = options;
    const ctx = collectLegendContext(graphData, options);
    const labelBtnText = showEdgeLabels ? "隱藏關係說明" : "顯示關係說明";
    const parts = ['<div class="relations-graph-legend">'];

    if (selection?.kind === "edge") {
      const et = selection.edgeType || "association";
      const spec = edgeVisual(et);
      parts.push('<p class="relations-graph-legend-note meta">選中關係 · 與畫布對應</p>');
      parts.push(renderEdgeSwatch(et, selection.label || spec.label, { highlight: true }));
      parts.push(
        `<p class="legend-detail"><span class="legend-k">結構類型</span> ${escapeHtml(spec.label)}（${lineStyleWord(spec.lineStyle)}）</p>`,
      );
      parts.push(
        `<p class="legend-detail"><span class="legend-k">語義分類</span> ${escapeHtml(categoryLabel(et, selection.category))}</p>`,
      );
      const detail = selection.detail || {};
      const srcId = detail.c_kin_id != null ? detail.c_kin_id : detail.c_node_id;
      if (srcId != null) {
        parts.push(
          `<p class="legend-detail"><span class="legend-k">對象編號</span> ${escapeHtml(String(srcId))}</p>`,
        );
      }
    } else if (selection?.kind === "node") {
      const role = selection.role || "hop1";
      const nodeType = selection.nodeType || "person";
      const color = nodeColorForRole(role, {
        nodeId: resolveGraphNodeId(selection, graphData),
        edges: graphData?.edges,
        graphKind: options.graphKind,
        nodeType,
      });
      parts.push('<p class="relations-graph-legend-note meta">選中節點 · 與畫布對應</p>');
      parts.push(renderNodeSwatch(color, selection.label || nodeRoleLegendLabel(role, nodeType), { highlight: true }));
      parts.push(
        `<p class="legend-detail"><span class="legend-k">節點角色</span> ${escapeHtml(nodeRoleLegendLabel(role, nodeType))}</p>`,
      );
      const nid = resolveGraphNodeId(selection, graphData);
      const connected = new Map();
      for (const e of graphData?.edges || []) {
        if (!edgePassesCategoryFilter(e, options.categoryFilters)) continue;
        if (String(e.source) !== nid && String(e.target) !== nid) continue;
        const t = e.type || "association";
        connected.set(t, (connected.get(t) || 0) + 1);
      }
      if (connected.size) {
        parts.push('<p class="legend-subtitle">與此節點相連的線型</p>');
        for (const typeId of LEGEND_STRUCTURAL_ORDER) {
          if (!connected.has(typeId)) continue;
          parts.push(renderEdgeSwatch(typeId, null, { count: connected.get(typeId) }));
        }
      }
    } else if (selection?.kind === "path") {
      parts.push('<p class="relations-graph-legend-note meta">選中路徑 · 與畫布對應</p>');
      parts.push(renderEdgeSwatch("path", "探索路徑", { highlight: true }));
    } else {
      parts.push('<p class="relations-graph-legend-note meta">當前畫布可見圖例（隨篩選與點選更新）</p>');
      if (ctx.nodeRoles.size) {
        parts.push('<p class="legend-subtitle">節點顏色</p>');
        for (const item of ctx.nodeRoles.values()) {
          parts.push(renderNodeSwatch(item.color, item.label, { count: item.count }));
        }
      }
      if (ctx.edgeTypesMap.size) {
        parts.push('<p class="legend-subtitle">關係線型（結構類型）</p>');
        for (const typeId of LEGEND_STRUCTURAL_ORDER) {
          if (!ctx.edgeTypesMap.has(typeId)) continue;
          parts.push(renderEdgeSwatch(typeId, null, { count: ctx.edgeTypesMap.get(typeId) }));
        }
      }
      if (!ctx.nodeRoles.size && !ctx.edgeTypesMap.size) {
        parts.push('<p class="meta">暫無可顯示的節點或關係，請調整篩選。</p>');
      }
    }

    parts.push(
      `<button type="button" class="btn sm relations-graph-edge-labels" aria-pressed="${showEdgeLabels}">${labelBtnText}</button>`,
    );
    parts.push("</div>");
    return parts.join("");
  }

  /** @deprecated use renderContextualLegendHtml */
  function renderLegendHtml(showEdgeLabels = false) {
    return renderContextualLegendHtml({ kind: "none" }, null, { showEdgeLabels });
  }

  global.GraphEdgeSchema = {
    palette: PALETTE,
    kinHopColors: KIN_HOP_COLORS,
    assocHopColors: ASSOC_HOP_COLORS,
    roleColors: ROLE_COLORS,
    geoNodeColors: GEO_NODE_COLORS,
    structuralTypes: STRUCTURAL_TYPES,
    categoryLabels: CATEGORY_LABELS,
    defaultCategoryFilters: DEFAULT_CATEGORY_FILTERS,
    allCategoryFilters: ALL_CATEGORY_FILTERS,
    fullCategoryFilters,
    categoryFiltersForGraphKind,
    cloneCategoryFilters,
    isMeaninglessGraphLabel,
    normalizeGraphLabel,
    sanitizeGraphPayload,
    hopIndex,
    nodeRelationKind,
    nodeColorForRole,
    nodeRoleLegendLabel,
    edgeVisual,
    structuralTypeLabel,
    categoryLabel,
    lineStyleForType,
    colorForType,
    arrowShapeForType,
    lineStyleWord,
    edgePassesCategoryFilter,
    collectLegendContext,
    renderContextualLegendHtml,
    renderLegendHtml,
  };
})(window);
