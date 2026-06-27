/**
 * CBDB Atlas — unified graph renderer (关系星图 + 可视化检索)
 */
(function (global) {
  const SCHEMA = global.GraphEdgeSchema;
  if (!SCHEMA) {
    throw new Error("GraphEdgeSchema must load before cbdb-graph.js");
  }

  const PALETTE = SCHEMA.palette;
  const KIN_HOP_COLORS = SCHEMA.kinHopColors;
  const ASSOC_HOP_COLORS = SCHEMA.assocHopColors;
  const ROLE_COLORS = SCHEMA.roleColors;
  const GEO_NODE_COLORS = SCHEMA.geoNodeColors;

  const EDGE_COLORS = Object.fromEntries(
    Object.entries(SCHEMA.structuralTypes).map(([id, spec]) => [id, spec.color]),
  );

  const DEFAULT_CATEGORY_FILTERS = SCHEMA.defaultCategoryFilters;
  const CATEGORY_LABELS = SCHEMA.categoryLabels;

  function cloneCategoryFilters(source = DEFAULT_CATEGORY_FILTERS) {
    return SCHEMA.cloneCategoryFilters(source);
  }

  let activeCategoryFilters = cloneCategoryFilters();

  let containerEl = null;
  let cy = null;
  let showAllEdgeLabels = false;
  let renderOptions = {};
  let dragSnapshot = null;
  let viewportUserAdjusted = false;
  let dragRafPending = false;
  let dragRelayoutId = null;

  /** Minimum angle (rad) between sibling nodes on a fan arc. */
  const FAN_MIN_GAP = Math.PI / 15;

  /** Outward drift for layout-tree leaves (px). */
  const LEAF_FLOAT_BASE = 14;
  const LEAF_FLOAT_PER_HOP = 9;
  const LEAF_OUTWARD_PARENT_MIX = 0.55;

  function waitFrames(n = 2) {
    return new Promise((resolve) => {
      let i = 0;
      const step = () => {
        if (++i >= n) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function hopIndex(role) {
    return SCHEMA.hopIndex(role);
  }

  function usesHierarchicalLayout(mode) {
    return !mode || mode === "ego" || mode === "single" || mode === "circle";
  }

  function nodeRelationKind(nodeId, edges) {
    return SCHEMA.nodeRelationKind(nodeId, edges);
  }

  const GRAPH_SCALE = {
    nodeSize: { 1: 10, 2: 12, 3: 14 },
    centerSize: 26,
    branchSize: 13,
    leafSize: 9,
    pathEndpointSize: 28,
    /** Base font size at zoom = 1 (scales with zoom, clamped to screen min/max). */
    labelBase: { node: 9, center: 10, edge: 8 },
    labelScreen: {
      node: { min: 8, max: 13 },
      center: { min: 9, max: 14 },
      edge: { min: 7, max: 12 },
    },
    marginScreen: { min: 1, max: 3, base: 2 },
  };

  const NODE_SIZE = GRAPH_SCALE.nodeSize;
  const CENTER_SIZE = GRAPH_SCALE.centerSize;
  const PATH_ENDPOINT_SIZE = GRAPH_SCALE.pathEndpointSize;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /** Screen px: grows when zooming in, floor when zooming out. */
  function hybridScreenPx(baseAtZoom1, zoom, minScreen, maxScreen) {
    return clamp(baseAtZoom1 * zoom, minScreen, maxScreen);
  }

  function modelFontSize(screenPx, zoom) {
    return `${screenPx / Math.max(zoom, 0.08)}px`;
  }

  function buildDegreeMap(data) {
    const deg = new Map();
    for (const node of data.nodes || []) deg.set(String(node.id), 0);
    for (const edge of data.edges || []) {
      const source = String(edge.source);
      const target = String(edge.target);
      deg.set(source, (deg.get(source) || 0) + 1);
      deg.set(target, (deg.get(target) || 0) + 1);
    }
    return deg;
  }

  function degreeSizeTier(degree, degrees, excludeId) {
    const values = [...degrees.entries()]
      .filter(([id, d]) => d > 0 && id !== excludeId)
      .map(([, d]) => d);
    if (!values.length) return { tier: 1, size: NODE_SIZE[1] };
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max === min) return { tier: 3, size: NODE_SIZE[3] };
    const ratio = (degree - min) / (max - min);
    if (ratio >= 0.67) return { tier: 3, size: NODE_SIZE[3] };
    if (ratio >= 0.34) return { tier: 2, size: NODE_SIZE[2] };
    return { tier: 1, size: NODE_SIZE[1] };
  }

  function countSizeScale(nodeCount) {
    if (nodeCount > 24) return 0.68;
    if (nodeCount > 16) return 0.78;
    if (nodeCount > 10) return 0.88;
    return 1;
  }

  function applyNodeDegreeSizing(graph, data) {
    const degrees = buildDegreeMap(data);
    const centerId = String(data.center_id || "");
    graph.nodes().forEach((node) => {
      const role = node.data("role");
      if (role === "center") {
        node.data("nodeSize", CENTER_SIZE);
        node.data("sizeTier", 4);
        return;
      }
      if (role === "path-endpoint") {
        node.data("nodeSize", PATH_ENDPOINT_SIZE);
        node.data("sizeTier", 3);
        return;
      }
      const degree = degrees.get(node.id()) || 0;
      const { tier, size } = degreeSizeTier(degree, degrees, centerId);
      node.data("nodeSize", size);
      node.data("sizeTier", tier);
      node.data("degree", degree);
      node.removeClass("size-1 size-2 size-3");
      node.addClass(`size-${tier}`);
    });
  }

  function applyEgoTreeSizing(graph, tree) {
    const scale = countSizeScale(graph.nodes().length);
    const sizes = {
      center: Math.max(18, Math.round(GRAPH_SCALE.centerSize * scale)),
      branch: Math.max(9, Math.round(GRAPH_SCALE.branchSize * scale)),
      leaf: Math.max(7, Math.round(GRAPH_SCALE.leafSize * scale)),
      path: Math.max(14, Math.round(PATH_ENDPOINT_SIZE * scale)),
    };
    graph.nodes().forEach((node) => {
      const id = node.id();
      if (id === tree.centerId) {
        node.data("nodeSize", sizes.center);
        node.data("sizeTier", 4);
        return;
      }
      if (node.data("role") === "path-endpoint") {
        node.data("nodeSize", sizes.path);
        node.data("sizeTier", 3);
        return;
      }
      const kids = tree.children.get(id) || [];
      const size = kids.length > 0 ? sizes.branch : sizes.leaf;
      node.data("nodeSize", size);
      node.data("sizeTier", kids.length > 0 ? 2 : 1);
      node.removeClass("size-1 size-2 size-3");
      node.addClass(kids.length > 0 ? "size-2" : "size-1");
    });
  }

  function applyGraphNodeSizing(graph, data, options = {}) {
    if (usesHierarchicalLayout(options.mode)) {
      const tree = buildEgoBFSTree(graph);
      if (tree) {
        applyEgoTreeSizing(graph, tree);
        return;
      }
    }
    applyNodeDegreeSizing(graph, data);
  }

  function nodeColor(role, nodeId, data, graphKind, nodeType = "person") {
    return SCHEMA.nodeColorForRole(role, {
      nodeId,
      edges: data?.edges,
      graphKind,
      nodeType,
    });
  }

  function maxNodeCollisionRadius(graph) {
    let max = CENTER_SIZE / 2;
    graph.nodes().forEach((node) => {
      const half = (node.data("nodeSize") || NODE_SIZE[1]) / 2;
      const labelPad = node.data("label") ? 8 + half * 0.35 : 6;
      max = Math.max(max, half + labelPad);
    });
    return max;
  }

  function lockCenterNode(graph) {
    graph.resize();
    const w = graph.width() || 800;
    const h = graph.height() || 600;
    const center = graph.nodes(".center");
    if (center.empty()) return { cx: w / 2, cy: h / 2 };
    const cx = w / 2;
    const cy = h / 2;
    center.position({ x: cx, y: cy });
    center.lock();
    center.ungrabify();
    return { cx, cy };
  }

  function ensureNodesGrabbable(graph) {
    graph.nodes().not(".center").not(".orphan-hidden").forEach((node) => {
      if (!node.locked()) node.grabify();
    });
  }

  function seedFamilyPositions(graph) {
    graph.resize();
    const w = graph.width() || 800;
    const h = graph.height() || 600;
    const { cx, cy } = lockCenterNode(graph);
    const byGen = new Map();
    graph.nodes().not(".center").forEach((node) => {
      if (node.hasClass("geo-node")) return;
      const gen = Number(node.data("generation"));
      const g = Number.isFinite(gen) ? gen : 0;
      if (!byGen.has(g)) byGen.set(g, []);
      byGen.get(g).push(node);
    });
    const rBase = maxNodeCollisionRadius(graph) * 2.8;
    const gens = [...byGen.keys()].sort((a, b) => a - b);
    gens.forEach((gen) => {
      const ring = byGen.get(gen);
      const radius = rBase * (Math.abs(gen) + 0.85);
      ring.forEach((node, index) => {
        const angle = (2 * Math.PI * index) / ring.length - Math.PI / 2;
        const yBias = gen < 0 ? -1 : gen > 0 ? 1 : 0.35;
        node.position({
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle) * yBias,
        });
        node.unlock();
      });
    });
    const geoNodes = graph.nodes(".geo-node");
    if (!geoNodes.empty()) {
      const outerR = rBase * 2.4;
      geoNodes.forEach((node, index) => {
        const angle = (2 * Math.PI * index) / geoNodes.length + Math.PI / 4;
        node.position({
          x: cx + outerR * Math.cos(angle),
          y: cy + outerR * Math.sin(angle),
        });
        node.unlock();
      });
    }
  }

  function buildEgoBFSTree(graph) {
    const center = graph.nodes(".center");
    if (center.empty()) return null;

    const connectivityOnly = renderOptions.mode === "family";
    const centerId = center.id();
    const parent = new Map([[centerId, null]]);
    const children = new Map([[centerId, []]]);
    const hop = new Map([[centerId, 0]]);
    const visited = new Set([centerId]);
    const queue = [center];

    while (queue.length) {
      const node = queue.shift();
      const nodeHop = hop.get(node.id());
      node.neighborhood("node").forEach((neighbor) => {
        if (visited.has(neighbor.id())) return;
        if (connectivityOnly) {
          visited.add(neighbor.id());
          parent.set(neighbor.id(), node.id());
          hop.set(neighbor.id(), nodeHop + 1);
          children.get(node.id()).push(neighbor.id());
          children.set(neighbor.id(), []);
          queue.push(neighbor);
          return;
        }
        const nh = hopIndex(neighbor.data("role"));
        if (nh !== nodeHop + 1) return;
        visited.add(neighbor.id());
        parent.set(neighbor.id(), node.id());
        hop.set(neighbor.id(), nh);
        children.get(node.id()).push(neighbor.id());
        children.set(neighbor.id(), []);
        queue.push(neighbor);
      });
    }

    if (!connectivityOnly) {
      graph.nodes().not(".center").forEach((node) => {
        if (visited.has(node.id())) return;
        const nid = node.id();
        const nodeHop = hopIndex(node.data("role")) || 1;
        let bestParent = centerId;
        let bestScore = Number.POSITIVE_INFINITY;
        node.neighborhood("node").forEach((neighbor) => {
          if (!visited.has(neighbor.id())) return;
          const nh = hop.get(neighbor.id()) ?? 0;
          const hopGap = Math.abs(nodeHop - nh);
          const score = hopGap * 12 + nh;
          if (score < bestScore) {
            bestScore = score;
            bestParent = neighbor.id();
          }
        });
        const parentHop = hop.get(bestParent) ?? 0;
        parent.set(nid, bestParent);
        hop.set(nid, bestParent === centerId ? nodeHop : parentHop + 1);
        children.get(bestParent).push(nid);
        children.set(nid, []);
        visited.add(nid);
      });
    }

    return { centerId, parent, children, hop };
  }

  function buildSiblingChordPairs(graph, kids) {
    const kidSet = new Set(kids);
    const pairs = [];
    const seen = new Set();
    graph.edges().forEach((edge) => {
      const s = edge.source().id();
      const t = edge.target().id();
      if (!kidSet.has(s) || !kidSet.has(t) || s === t) return;
      const key = s < t ? `${s}|${t}` : `${t}|${s}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push([s, t]);
    });
    return pairs;
  }

  function countSiblingCrossings(order, pairs) {
    const index = new Map(order.map((id, i) => [id, i]));
    let crossings = 0;
    for (let a = 0; a < pairs.length; a += 1) {
      const i1 = index.get(pairs[a][0]);
      const j1 = index.get(pairs[a][1]);
      if (i1 == null || j1 == null) continue;
      const lo1 = Math.min(i1, j1);
      const hi1 = Math.max(i1, j1);
      for (let b = a + 1; b < pairs.length; b += 1) {
        const i2 = index.get(pairs[b][0]);
        const j2 = index.get(pairs[b][1]);
        if (i2 == null || j2 == null) continue;
        const lo2 = Math.min(i2, j2);
        const hi2 = Math.max(i2, j2);
        if (lo1 < lo2 && lo2 < hi1 && hi1 < hi2) crossings += 1;
      }
    }
    return crossings;
  }

  function permuteSmall(arr, visit, max = 720) {
    if (arr.length <= 1) {
      visit(arr);
      return;
    }
    let count = 0;
    const walk = (prefix, rest) => {
      if (count >= max) return;
      if (!rest.length) {
        count += 1;
        visit(prefix);
        return;
      }
      for (let i = 0; i < rest.length; i += 1) {
        walk(
          prefix.concat(rest[i]),
          rest.slice(0, i).concat(rest.slice(i + 1)),
        );
      }
    };
    walk([], arr);
  }

  function orderChildrenForLayout(graph, tree, parentId, kids) {
    if (kids.length <= 1) return kids;
    const kidSet = new Set(kids);
    const chordPairs = buildSiblingChordPairs(graph, kids);
    let order = [...kids];

    for (let iter = 0; iter < 4; iter += 1) {
      const scored = order.map((cid, idx) => {
        const node = graph.getElementById(cid);
        let sum = idx;
        let count = 1;
        order.forEach((otherId, otherIdx) => {
          if (otherId === cid) return;
          if (!node.edgesWith(graph.getElementById(otherId)).length) return;
          sum += otherIdx;
          count += 1;
        });
        node.neighborhood("node").forEach((neighbor) => {
          if (kidSet.has(neighbor.id())) return;
          const gen = Number(neighbor.data("generation"));
          if (Number.isFinite(gen)) {
            sum += gen * 0.35;
            count += 1;
          }
        });
        return { cid, score: sum / count };
      });
      order = scored.sort((a, b) => a.score - b.score || String(a.cid).localeCompare(String(b.cid)))
        .map((x) => x.cid);
    }

    if (kids.length <= 6 && chordPairs.length) {
      let best = order;
      let bestCross = countSiblingCrossings(order, chordPairs);
      permuteSmall(kids, (perm) => {
        const c = countSiblingCrossings(perm, chordPairs);
        if (c < bestCross) {
          bestCross = c;
          best = perm;
        }
      });
      order = best;
    }

    return order;
  }

  function collectSubtreeIds(tree, rootId, out) {
    for (const childId of tree.children.get(rootId) || []) {
      out.add(childId);
      collectSubtreeIds(tree, childId, out);
    }
  }

  function computeFanSpan(childCount, parentHop, narrow = false) {
    const n = Math.max(childCount, 1);
    if (parentHop === 0) return Math.PI * 2;
    const minFromCount = n * FAN_MIN_GAP;
    const maxFan = narrow
      ? Math.min(Math.PI * 0.72, Math.PI / 5 + n * 0.1)
      : Math.min(Math.PI * 1.42, Math.PI * 0.45 + n * 0.16);
    const minFan = narrow ? Math.PI / 6 : Math.PI / 4;
    return Math.max(minFan, Math.min(maxFan, Math.max(minFromCount, Math.PI / 3)));
  }

  /** Compact orbit: stay near parent; widen angle before pushing radius outward. */
  function localOrbitRadius(graph, childCount, parentHop, sectorSpan = Math.PI * 2) {
    const r = maxNodeCollisionRadius(graph);
    const chord = r * 2 + 10;
    const n = Math.max(childCount, 1);
    const hopBase = parentHop === 0 ? r * 1.75 + 16 : r * 1.25 + 10;
    if (n === 1) return hopBase;

    const effectiveSpan = Math.max(sectorSpan, n * FAN_MIN_GAP);
    const slice = Math.min(effectiveSpan / n, Math.PI * 0.95);
    const minChordRadius = slice > 0.05
      ? chord / (2 * Math.sin(slice / 2))
      : hopBase;
    const spreadCap = hopBase * (n <= 3 ? 1.15 : n <= 6 ? 1.32 : 1.5);
    const arcRadius = Math.min((n * chord) / effectiveSpan, spreadCap);
    const w = graph.width() || 800;
    const h = graph.height() || 600;
    const maxR = Math.min(w, h) * 0.28;
    return Math.min(maxR, Math.max(hopBase, Math.min(minChordRadius, arcRadius)));
  }

  function collectSubtreeIdSet(tree, rootId) {
    const ids = new Set();
    collectSubtreeIds(tree, rootId, ids);
    return ids;
  }

  function fillRadialSubtree(
    positions,
    tree,
    graph,
    parentId,
    angleStart,
    angleEnd,
    centerCx,
    centerCy,
    parentAnchors,
    localCore = false,
  ) {
    const kids = orderChildrenForLayout(graph, tree, parentId, tree.children.get(parentId) || []);
    if (!kids.length) return;

    const parentHop = tree.hop.get(parentId) || 0;
    const parentPos = positions.get(parentId);
    if (!parentPos) return;
    const px = parentPos.x;
    const py = parentPos.y;
    const span = angleEnd - angleStart;
    const radius = localOrbitRadius(graph, kids.length, parentHop, span);
    const n = kids.length;

    kids.forEach((childId, index) => {
      const mid = n === 1
        ? (angleStart + angleEnd) / 2
        : angleStart + (index + 0.5) * (span / n);

      const x = px + radius * Math.cos(mid);
      const y = py + radius * Math.sin(mid);
      positions.set(childId, { x, y });
      const grandKids = tree.children.get(childId) || [];
      if (parentAnchors) {
        parentAnchors.set(childId, {
          parentId,
          idealDist: Math.hypot(x - px, y - py),
          isLeaf: grandKids.length === 0,
        });
      }

      if (!grandKids.length) return;

      const outAngle = localCore
        ? Math.atan2(y - py, x - px)
        : Math.atan2(y - centerCy, x - centerCx);
      const childHop = tree.hop.get(childId) || parentHop + 1;
      const leafBranch = grandKids.every(
        (gc) => !(tree.children.get(gc) || []).length,
      );
      const childFan = computeFanSpan(grandKids.length, childHop, leafBranch);
      fillRadialSubtree(
        positions,
        tree,
        graph,
        childId,
        outAngle - childFan / 2,
        outAngle + childFan / 2,
        centerCx,
        centerCy,
        parentAnchors,
        localCore,
      );
    });
  }

  function applySubtreePositions(graph, tree, rootId, positions) {
    const desc = new Set();
    collectSubtreeIds(tree, rootId, desc);
    desc.forEach((id) => {
      const p = positions.get(id);
      if (!p) return;
      const node = graph.getElementById(id);
      if (!node.empty() && !node.locked()) node.position(p);
    });
  }

  function layoutRadialSubtree(graph, tree, rootId, { localCore = false } = {}) {
    if (!tree || rootId === tree.centerId) return;
    const kids = tree.children.get(rootId) || [];
    if (!kids.length) return;

    const rootNode = graph.getElementById(rootId);
    if (rootNode.empty()) return;

    const rootPos = { x: rootNode.position("x"), y: rootNode.position("y") };
    const positions = new Map([[rootId, rootPos]]);

    let angleStart;
    let angleEnd;
    let refCx;
    let refCy;

    if (localCore) {
      angleStart = -Math.PI;
      angleEnd = Math.PI;
      refCx = rootPos.x;
      refCy = rootPos.y;
    } else {
      lockCenterNode(graph);
      const centerNode = graph.getElementById(tree.centerId);
      const cx = centerNode.position("x");
      const cy = centerNode.position("y");
      const outAngle = Math.atan2(rootPos.y - cy, rootPos.x - cx);
      const parentHop = tree.hop.get(rootId) || 1;
      const fanSpan = computeFanSpan(kids.length, parentHop);
      angleStart = outAngle - fanSpan / 2;
      angleEnd = outAngle + fanSpan / 2;
      refCx = cx;
      refCy = cy;
    }

    const parentAnchors = graph.scratch("_layoutParentAnchors") || new Map();
    graph.scratch("_layoutParentAnchors", parentAnchors);

    fillRadialSubtree(
      positions,
      tree,
      graph,
      rootId,
      angleStart,
      angleEnd,
      refCx,
      refCy,
      parentAnchors,
      localCore,
    );

    applySubtreePositions(graph, tree, rootId, positions);
  }

  function layoutFamilyGeoNodes(graph) {
    const geoNodes = graph.nodes(".geo-node");
    if (geoNodes.empty()) return;
    const center = graph.nodes(".center");
    if (center.empty()) return;
    const cx = center.position("x");
    const cy = center.position("y");
    const rBase = maxNodeCollisionRadius(graph) * 2;
    let maxPersonDist = rBase;
    graph.nodes().not(".center").not(".geo-node").not(".orphan-hidden").forEach((node) => {
      maxPersonDist = Math.max(
        maxPersonDist,
        Math.hypot(node.position("x") - cx, node.position("y") - cy),
      );
    });
    const outerR = maxPersonDist + rBase * 0.85;
    geoNodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / geoNodes.length + Math.PI / 4;
      node.position({
        x: cx + outerR * Math.cos(angle),
        y: cy + outerR * Math.sin(angle),
      });
      node.unlock();
    });
  }

  function layoutRadialTree(graph, tree) {
    lockCenterNode(graph);
    const centerNode = graph.getElementById(tree.centerId);
    const cx = centerNode.position("x");
    const cy = centerNode.position("y");
    const positions = new Map([[tree.centerId, { x: cx, y: cy }]]);
    const parentAnchors = new Map();
    graph.scratch("_layoutParentAnchors", parentAnchors);

    fillRadialSubtree(
      positions,
      tree,
      graph,
      tree.centerId,
      -Math.PI,
      Math.PI,
      cx,
      cy,
      parentAnchors,
    );

    graph.nodes().not(".center").not(".geo-node").forEach((node) => {
      const p = positions.get(node.id());
      if (!p) return;
      node.position(p);
      node.unlock();
    });
    ensureNodesGrabbable(graph);
  }

  function isLayoutTreeLeaf(tree, nodeId) {
    if (!tree?.children || nodeId === tree.centerId) return false;
    return !(tree.children.get(nodeId) || []).length;
  }

  function syncLayoutLeafClasses(graph, tree) {
    if (!tree) return;
    graph.nodes().not(".center").forEach((node) => {
      node.toggleClass("layout-leaf", isLayoutTreeLeaf(tree, node.id()));
    });
  }

  /** Push layout-tree leaves outward (optionally limited to a subtree). */
  function floatLeafNodesOutward(graph, tree, subtreeIds = null) {
    if (!tree) return;
    const center = graph.getElementById(tree.centerId);
    if (center.empty()) return;
    const ccx = center.position("x");
    const ccy = center.position("y");
    const anchors = graph.scratch("_layoutParentAnchors");

    graph.nodes().not(".center").not(".geo-node").not(".orphan-hidden").forEach((node) => {
      if (node.locked()) return;
      if (subtreeIds && !subtreeIds.has(node.id())) return;
      if (!isLayoutTreeLeaf(tree, node.id())) return;

      const x = node.position("x");
      const y = node.position("y");
      let dx = x - ccx;
      let dy = y - ccy;
      let centerDist = Math.hypot(dx, dy);
      if (centerDist < 0.01) {
        dx = 0;
        dy = -1;
        centerDist = 1;
      } else {
        dx /= centerDist;
        dy /= centerDist;
      }

      const anchor = anchors?.get(node.id());
      if (anchor?.parentId) {
        const parent = graph.getElementById(anchor.parentId);
        if (!parent.empty()) {
          const px = parent.position("x");
          const py = parent.position("y");
          let pdx = x - px;
          let pdy = y - py;
          const pd = Math.hypot(pdx, pdy);
          if (pd > 0.01) {
            pdx /= pd;
            pdy /= pd;
            const mix = LEAF_OUTWARD_PARENT_MIX;
            dx = dx * (1 - mix) + pdx * mix;
            dy = dy * (1 - mix) + pdy * mix;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len;
            dy /= len;
          }
        }
      }

      const hop = tree.hop.get(node.id()) || 1;
      const floatPx = LEAF_FLOAT_BASE + LEAF_FLOAT_PER_HOP * hop;
      const nx = x + dx * floatPx;
      const ny = y + dy * floatPx;
      node.position({ x: nx, y: ny });

      if (anchor?.parentId) {
        const parent = graph.getElementById(anchor.parentId);
        if (!parent.empty()) {
          anchor.idealDist = Math.hypot(
            nx - parent.position("x"),
            ny - parent.position("y"),
          );
          anchor.isLeaf = true;
        }
      }
    });
  }

  function resolveSiblingRepulsionInSubtree(graph, tree, rootId, padding = 20, iterations = 10) {
    if (!tree) return;
    const subtreeIds = collectSubtreeIdSet(tree, rootId);
    const parentIds = [rootId, ...subtreeIds];

    const repelNodes = (nodes) => {
      if (nodes.length < 2) return;
      for (let iter = 0; iter < iterations; iter += 1) {
        let moved = false;
        for (let i = 0; i < nodes.length; i += 1) {
          for (let j = i + 1; j < nodes.length; j += 1) {
            const a = nodes[i];
            const b = nodes[j];
            if (a.locked() || b.locked()) continue;
            const dx = b.position("x") - a.position("x");
            const dy = b.position("y") - a.position("y");
            const dist = Math.hypot(dx, dy) || 0.01;
            const halfA = (a.data("nodeSize") || 12) / 2 + 8;
            const halfB = (b.data("nodeSize") || 12) / 2 + 8;
            const minDist = halfA + halfB + padding;
            if (dist >= minDist) continue;
            const push = (minDist - dist) / 2;
            const ux = dx / dist;
            const uy = dy / dist;
            a.position({
              x: a.position("x") - ux * push,
              y: a.position("y") - uy * push,
            });
            b.position({
              x: b.position("x") + ux * push,
              y: b.position("y") + uy * push,
            });
            moved = true;
          }
        }
        if (!moved) break;
      }
    };

    parentIds.forEach((parentId) => {
      const kidIds = (tree.children.get(parentId) || []).filter((id) => subtreeIds.has(id));
      if (kidIds.length < 2) return;
      const nodes = kidIds
        .map((id) => graph.getElementById(id))
        .filter((n) => !n.empty() && !n.hasClass("orphan-hidden"));
      repelNodes(nodes);
    });
  }

  /** Post-process only the dragged node's subtree — does not move root or touch other nodes. */
  function finishDragSubtreeLayout(graph, tree, rootId) {
    if (!tree || !rootId || rootId === tree.centerId) return;
    const layoutApi = global.CbdbGraphLayout;
    const subtreeIds = collectSubtreeIdSet(tree, rootId);
    if (!subtreeIds.size) return;

    layoutApi?.resolveCollisionsAmong?.(graph, subtreeIds, 14, 10);
    resolveSiblingRepulsionInSubtree(graph, tree, rootId, 22, 8);
    floatLeafNodesOutward(graph, tree, subtreeIds);
    layoutApi?.anchorTreeChildrenInSet?.(graph, subtreeIds, 0.48, 0.15);
    layoutApi?.resolveCollisionsAmong?.(graph, subtreeIds, 10, 5);
    layoutApi?.clampNodesToCanvas?.(graph, subtreeIds, 36);
  }

  function finishRadialLayoutPost(graph) {
    const layoutApi = global.CbdbGraphLayout;
    const tree = graph.scratch("_egoTree");
    syncLayoutLeafClasses(graph, tree);
    lockCenterNode(graph);
    layoutApi?.resolveCollisions?.(graph, 14, 20);
    layoutApi?.clampOrbitToCanvas?.(graph, 48);
    layoutApi?.resolveCollisions?.(graph, 12, 10);
    floatLeafNodesOutward(graph, tree);
    layoutApi?.anchorTreeChildren?.(graph, 0.52, 0.18);
    layoutApi?.resolveCollisions?.(graph, 8, 6);
  }

  function seedInitialPositions(graph, nodeCount) {
    if (renderOptions.mode === "family") {
      seedFamilyPositions(graph);
      return;
    }
    graph.resize();
    const w = graph.width() || 800;
    const h = graph.height() || 600;
    const { cx, cy: cyPos } = lockCenterNode(graph);
    const others = graph.nodes().not(".center");
    const count = others.length;
    if (!count) return;

    const r = maxNodeCollisionRadius(graph);
    const minSpread = (count * (r * 2 + 8)) / (2 * Math.PI);
    const areaSpread = Math.sqrt((w * h) / Math.max(nodeCount + 1, 6)) * 0.78;
    const spread = Math.max(
      minSpread,
      Math.min(areaSpread, Math.min(w, h) * 0.38),
    );

    others.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / count - Math.PI / 2;
      node.position({
        x: cx + spread * Math.cos(angle),
        y: cyPos + spread * Math.sin(angle),
      });
      node.unlock();
    });
  }

  function finishLayoutPost(graph) {
    finishRadialLayoutPost(graph);
  }

  function visibleGraphNodes(graph) {
    return graph.nodes().not(".orphan-hidden");
  }

  function refitViewport(graph) {
    if (!graph) return;
    const nodes = visibleGraphNodes(graph);
    const target = nodes.length ? nodes : graph.nodes(".center");
    if (!target.length) return;
    if (global.CbdbGraphLayout) {
      global.CbdbGraphLayout.viewportFitCenter(graph, 64, {
        centerFirst: true,
        ensureAllVisible: true,
      });
    } else {
      graph.fit(target, 64);
    }
  }

  function pickLayoutOpts(graph, nodeCount) {
    graph.resize();
    const w = graph.width() || 800;
    const h = graph.height() || 600;
    const area = w * h;
    const pad = maxNodeCollisionRadius(graph) * 2.2;
    const ideal = Math.max(
      pad,
      Math.min(96, Math.sqrt(area / Math.max(nodeCount, 6)) * 0.88),
    );

    return {
      name: "cose",
      animate: nodeCount <= 60,
      animationDuration: 420,
      fit: false,
      padding: 40,
      randomize: false,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: ideal,
      nodeRepulsion: 7200 + nodeCount * 190,
      nodeOverlap: 36,
      edgeElasticity: 0.42,
      nestingFactor: 0.1,
      gravity: 0.08,
      numIter: nodeCount > 80 ? 1400 : 950,
      coolingFactor: 0.95,
      initialTemp: 220,
    };
  }

  async function runLayout(graph, nodeCount) {
    const layoutApi = global.CbdbGraphLayout;
    if (layoutApi?.waitForContainer) {
      await layoutApi.waitForContainer(graph);
    } else {
      await waitFrames(2);
      graph.resize();
    }

    graph.nodes().unlock();
    const hierarchical = usesHierarchicalLayout(renderOptions.mode);
    const tree = hierarchical ? buildEgoBFSTree(graph) : null;
    if (tree) graph.scratch("_egoTree", tree);
    else graph.scratch("_egoTree", null);

    return new Promise((resolve) => {
      if (renderOptions.mode === "family") {
        const familyTree = buildEgoBFSTree(graph);
        if (familyTree) {
          graph.scratch("_egoTree", familyTree);
          layoutRadialTree(graph, familyTree);
          layoutFamilyGeoNodes(graph);
        } else {
          seedFamilyPositions(graph);
        }
        finishLayoutPost(graph);
        resolve();
        return;
      }

      if (hierarchical && tree) {
        applyEgoTreeSizing(graph, tree);
        layoutRadialTree(graph, tree);
        finishLayoutPost(graph);
        resolve();
        return;
      }

      seedInitialPositions(graph, nodeCount);
      const layout = graph.layout(pickLayoutOpts(graph, nodeCount));
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        finishLayoutPost(graph);
        resolve();
      };
      layout.on("layoutstop", finish);
      setTimeout(finish, 12000);
      layout.run();
    });
  }

  function edgeLineStyle(edgeType) {
    return SCHEMA.lineStyleForType(edgeType);
  }

  function edgeArrowShape(edgeType) {
    return SCHEMA.arrowShapeForType(edgeType);
  }

  function buildElements(data, options = {}) {
    const elements = [];
    const pathMode = options.mode === "explore";
    const graphKind = options.graphKind || "all";
    for (const node of data.nodes || []) {
      const role = node.role || "hop1";
      const nodeType = node.node_type || "person";
      const geoColor = GEO_NODE_COLORS[nodeType];
      elements.push({
        data: {
          id: node.id,
          label: truncate(node.label || node.id, 8),
          fullLabel: node.full_label || node.label || node.id,
          personId: node.person_id,
          role,
          generation: node.generation,
          nodeType,
          years: node.years || "",
          dynastyChn: node.dynasty_chn || "",
          choronymChn: node.choronym_chn || "",
          indexAddrChn: node.index_addr_chn || "",
          splitKey: node.split_key || "",
          color: geoColor || nodeColor(role, node.id, data, graphKind, nodeType),
          nodeSize: nodeType !== "person" ? NODE_SIZE[2] * 0.9 : NODE_SIZE[3],
        },
        classes: [
          role === "center" ? "center" : "",
          role === "path-endpoint" ? "path-endpoint" : "",
          nodeType !== "person" ? "geo-node" : "",
          pathMode && !["path-endpoint", "path-via", "center"].includes(role) ? "dimmed" : "",
        ].filter(Boolean).join(" "),
      });
    }
    for (const edge of data.edges || []) {
      const et = edge.type || "association";
      elements.push({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label || "",
          fullLabel: edge.label || "",
          displayLabel: edgeDisplayLabel(edge.label || ""),
          edgeType: et,
          color: EDGE_COLORS[et] || EDGE_COLORS.association,
          category: edge.category || "",
          detail: edge.detail || {},
          lineStyle: edgeLineStyle(et),
          arrowShape: edgeArrowShape(et),
        },
        classes: [
          edge.on_path || et === "path" ? "on-path" : "",
          pathMode && !edge.on_path && et !== "path" ? "dimmed" : "",
          et === "path" || edge.on_path ? "show-label" : "",
        ].filter(Boolean).join(" "),
      });
    }
    return elements;
  }

  function truncate(text, max) {
    const s = String(text || "");
    if (s.length <= max) return s;
    return `${s.slice(0, max - 1)}…`;
  }

  /** On-canvas edge text; full text stays in fullLabel for the detail panel. */
  function edgeDisplayLabel(text) {
    const s = String(text || "").trim();
    if (s.length <= 28) return s;
    return `${s.slice(0, 27)}…`;
  }

  const EDGE_LABEL_CAP = 40;
  const PATH_HIGHLIGHT = "#1a5f7a";
  const PATH_HIGHLIGHT_ALT = "#6e96a8";
  /** Non-path elements during node selection — subdued but still readable. */
  const DIMMED_NODE_OPACITY = 0.34;
  const DIMMED_EDGE_OPACITY = 0.28;

  const EDGE_LABEL_STYLE = {
    label: "data(displayLabel)",
    "font-family": (typeof window !== "undefined" && window.CBDBHanzi?.hanFontFamily?.()) || 'CBDBHanFont, "Noto Serif TC", "Noto Serif SC", serif',
    color: "#4a5560",
    "text-rotation": "autorotate",
    "text-valign": "center",
    "text-halign": "center",
    "text-margin-y": 0,
    "text-wrap": "none",
    "text-max-width": 9999,
    "min-zoomed-font-size": 0,
    "text-outline-width": 2,
    "text-outline-color": "#f4f7f9",
  };

  function syncLabelFontSizes() {
    if (!cy) return;
    const z = Math.max(cy.zoom(), 0.08);
    const { labelBase, labelScreen, marginScreen } = GRAPH_SCALE;
    const nodePx = hybridScreenPx(
      labelBase.node, z, labelScreen.node.min, labelScreen.node.max,
    );
    const centerPx = hybridScreenPx(
      labelBase.center, z, labelScreen.center.min, labelScreen.center.max,
    );
    const edgePx = hybridScreenPx(
      labelBase.edge, z, labelScreen.edge.min, labelScreen.edge.max,
    );
    const marginPx = hybridScreenPx(
      marginScreen.base, z, marginScreen.min, marginScreen.max,
    );
    cy.style()
      .selector("node")
      .style({
        "font-size": modelFontSize(nodePx, z),
        "text-margin-y": modelFontSize(marginPx, z),
        "min-zoomed-font-size": 0,
      })
      .selector("node.center")
      .style({
        "font-size": modelFontSize(centerPx, z),
        "text-margin-y": modelFontSize(marginPx, z),
      })
      .selector("edge.show-label")
      .style({
        ...EDGE_LABEL_STYLE,
        "font-size": modelFontSize(edgePx, z),
      })
      .update();
  }

  function isEgoLikeMode(mode) {
    if (mode === "explore") return false;
    return !mode || mode === "ego" || mode === "single" || mode === "family" || mode === "circle";
  }

  function edgePassesRelationKindFilter(edge) {
    const kind = renderOptions.graphKind || "all";
    if (kind === "all") return true;
    const et = edge.data("edgeType") || "";
    if (kind === "kinship") return et.startsWith("kinship");
    if (kind === "association") return et === "association";
    return true;
  }

  function edgePassesCategoryFilter(edge) {
    if (!edgePassesRelationKindFilter(edge)) return false;
    const filters = renderOptions.categoryFilters || activeCategoryFilters;
    if (edge.hasClass("sel") || edge.hasClass("on-path") || edge.hasClass("on-path-alt")) return true;
    const cat = edge.data("category");
    const et = edge.data("edgeType") || "";
    if (et.startsWith("kinship")) {
      if (!cat) return true;
      return filters.kin[cat] !== false;
    }
    if (et === "association") {
      if (!cat) return true;
      return filters.assoc[cat] !== false;
    }
    return true;
  }

  function getEgoTree(graph) {
    const g = graph || cy;
    if (!g) return null;
    return g.scratch("_egoTree") || null;
  }

  /** Layout-tree chain from node up to center (inclusive). */
  function centerPathNodeIds(fromNodeId, tree, centerId) {
    const ids = [fromNodeId];
    if (!centerId || fromNodeId === centerId) return ids;
    if (!tree?.parent) {
      ids.push(centerId);
      return ids;
    }
    let cur = fromNodeId;
    const seen = new Set(ids);
    while (tree.parent.has(cur)) {
      const parentId = tree.parent.get(cur);
      if (parentId == null || seen.has(parentId)) break;
      ids.push(parentId);
      seen.add(parentId);
      cur = parentId;
    }
    if (!seen.has(centerId)) ids.push(centerId);
    return ids;
  }

  function pathTraversalNeighbors(node) {
    return node.connectedEdges()
      .not(".cat-hidden")
      .not(".kind-hidden")
      .connectedNodes()
      .not(node);
  }

  /** Shortest node-id path on the rendered graph (ignores hop layout tree). */
  function shortestPathNodeIds(fromNodeId, toNodeId, graph) {
    const g = graph || cy;
    if (!g || !fromNodeId || !toNodeId) return null;
    if (fromNodeId === toNodeId) return [fromNodeId];

    const parent = new Map([[fromNodeId, null]]);
    const queue = [fromNodeId];
    const visited = new Set([fromNodeId]);

    while (queue.length) {
      const cur = queue.shift();
      if (cur === toNodeId) {
        const path = [];
        let step = toNodeId;
        while (step != null) {
          path.unshift(step);
          step = parent.get(step);
        }
        return path;
      }
      const node = g.getElementById(cur);
      if (node.empty()) continue;
      pathTraversalNeighbors(node).forEach((neighbor) => {
        const nid = neighbor.id();
        if (visited.has(nid) || neighbor.hasClass("orphan-hidden")) return;
        visited.add(nid);
        parent.set(nid, cur);
        queue.push(nid);
      });
    }
    return null;
  }

  function resolveCenterPathNodeIds(fromNodeId, centerId, tree) {
    const graphPath = shortestPathNodeIds(fromNodeId, centerId);
    if (graphPath?.length >= 2) return graphPath;
    return centerPathNodeIds(fromNodeId, tree, centerId);
  }

  function findPathEdgesBetween(nodeAId, nodeBId) {
    const na = cy.getElementById(nodeAId);
    const nb = cy.getElementById(nodeBId);
    if (na.empty() || nb.empty()) return cy.collection();
    return na.edgesWith(nb).filter((edge) => isEdgeGraphVisible(edge));
  }

  function bfsDistances(startId, graph) {
    const g = graph || cy;
    const dist = new Map([[startId, 0]]);
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift();
      const d = dist.get(cur);
      const node = g.getElementById(cur);
      if (node.empty()) continue;
      pathTraversalNeighbors(node).forEach((neighbor) => {
        const nid = neighbor.id();
        if (dist.has(nid) || neighbor.hasClass("orphan-hidden")) return;
        dist.set(nid, d + 1);
        queue.push(nid);
      });
    }
    return dist;
  }

  function edgePathPriority(edge) {
    const et = edge.data("edgeType") || "";
    if (et.startsWith("kinship")) return 0;
    if (et === "association") return 1;
    return 2;
  }

  function pickPrimaryEdge(edges) {
    const list = edges.toArray().sort((a, b) => {
      const pa = edgePathPriority(a);
      const pb = edgePathPriority(b);
      if (pa !== pb) return pa - pb;
      return String(a.id()).localeCompare(String(b.id()));
    });
    return list[0] || null;
  }

  function unhidePathEndpoint(node) {
    if (!node || node.empty()) return;
    node.removeClass("dimmed");
  }

  /**
   * Primary = one shortest node chain + one edge per hop.
   * Alt = parallel edges on same hop, other shortest-path edges, and longer传导 paths.
   */
  function computeCenterPathHighlight(fromNodeId, centerId, tree) {
    const pathIds = resolveCenterPathNodeIds(fromNodeId, centerId, tree);
    const primaryNodeIds = new Set(pathIds);
    const altNodeIds = new Set();
    const primaryEdgeIds = new Set();
    const altEdgeIds = new Set();

    const distFrom = bfsDistances(fromNodeId, cy);
    const distTo = bfsDistances(centerId, cy);
    const shortestDist = distFrom.get(centerId);

    for (let i = 0; i < pathIds.length - 1; i += 1) {
      const hopEdges = findPathEdgesBetween(pathIds[i], pathIds[i + 1]);
      if (!hopEdges.length) continue;
      const primary = pickPrimaryEdge(hopEdges);
      if (primary) primaryEdgeIds.add(primary.id());
      hopEdges.forEach((edge) => {
        if (edge.id() !== primary?.id()) altEdgeIds.add(edge.id());
      });
    }

    if (shortestDist == null) {
      primaryEdgeIds.forEach((id) => altEdgeIds.delete(id));
      return { pathIds, primaryNodeIds, altNodeIds, primaryEdgeIds, altEdgeIds };
    }

    const maxAltHop = shortestDist + 2;
    cy.edges().forEach((edge) => {
      if (!isEdgeGraphVisible(edge)) return;
      const u = edge.source().id();
      const v = edge.target().id();
      const du = distFrom.get(u);
      const dv = distFrom.get(v);
      const tu = distTo.get(u);
      const tv = distTo.get(v);
      if (du == null || dv == null || tu == null || tv == null) return;

      const lenUv = du + 1 + tv;
      const lenVu = dv + 1 + tu;
      const onShortest = lenUv === shortestDist || lenVu === shortestDist;

      if (onShortest) {
        if (!primaryEdgeIds.has(edge.id())) altEdgeIds.add(edge.id());
        return;
      }

      const minLen = Math.min(lenUv, lenVu);
      if (minLen <= shortestDist || minLen > maxAltHop) return;

      altEdgeIds.add(edge.id());
      [u, v].forEach((nid) => {
        if (nid === fromNodeId || nid === centerId) return;
        if (!primaryNodeIds.has(nid)) altNodeIds.add(nid);
      });
    });

    primaryEdgeIds.forEach((id) => altEdgeIds.delete(id));
    return { pathIds, primaryNodeIds, altNodeIds, primaryEdgeIds, altEdgeIds };
  }

  function applyPathHighlightClasses(highlight, fromNodeId) {
    const { pathIds, altNodeIds, primaryEdgeIds, altEdgeIds } = highlight;

    pathIds.forEach((id) => {
      if (id === fromNodeId) return;
      const n = cy.getElementById(id);
      if (!n.empty()) n.removeClass("dimmed path-node-alt").addClass("path-node");
    });

    altNodeIds.forEach((id) => {
      const n = cy.getElementById(id);
      if (!n.empty()) n.removeClass("dimmed").addClass("path-node-alt");
    });

    primaryEdgeIds.forEach((eid) => {
      const edge = cy.getElementById(eid);
      if (edge.empty()) return;
      edge.removeClass("dimmed on-path-alt").addClass("on-path sel");
      unhidePathEndpoint(edge.source());
      unhidePathEndpoint(edge.target());
    });

    altEdgeIds.forEach((eid) => {
      const edge = cy.getElementById(eid);
      if (edge.empty()) return;
      edge.removeClass("dimmed on-path sel").addClass("on-path-alt");
      unhidePathEndpoint(edge.source());
      unhidePathEndpoint(edge.target());
    });
  }

  /** Dim graph; highlight shortest path to center, alt paths at lower chroma. */
  function highlightEgoCenterPath(node) {
    if (!cy || !node) return;
    const center = cy.nodes(".center");
    const centerId = center.empty() ? null : center.id();
    let tree = getEgoTree(cy);
    if (!tree && centerId) {
      tree = buildEgoBFSTree(cy);
      if (tree) cy.scratch("_egoTree", tree);
    }

    cy.elements().removeClass("sel on-path on-path-alt path-node path-node-alt dimmed");
    cy.elements().addClass("dimmed");

    node.removeClass("dimmed path-node path-node-alt").addClass("sel");

    if (node.hasClass("center") || !centerId || node.id() === centerId) {
      center.removeClass("dimmed");
      applyEgoEdgeVisibility();
      applyEdgeLabels();
      return;
    }

    const highlight = computeCenterPathHighlight(node.id(), centerId, tree);
    if (centerId) {
      cy.getElementById(centerId).removeClass("dimmed");
    }
    applyPathHighlightClasses(highlight, node.id());

    applyEgoEdgeVisibility();
    applyEdgeLabels();
  }

  function isEdgeGraphVisible(edge) {
    return !edge.hasClass("ego-hidden")
      && !edge.hasClass("cat-hidden")
      && !edge.hasClass("kind-hidden");
  }

  function applyCategoryEdgeVisibility() {
    if (!cy || renderOptions.mode === "explore") return;
    cy.edges().forEach((edge) => {
      if (edge.hasClass("ego-hidden")) {
        edge.removeClass("cat-hidden kind-hidden");
        return;
      }
      const visible = edgePassesCategoryFilter(edge);
      edge.toggleClass("kind-hidden", !edgePassesRelationKindFilter(edge));
      edge.toggleClass("cat-hidden", !visible);
    });
  }

  function orphanVisibilityRoots(graph) {
    if (renderOptions.mode === "explore") {
      return graph.nodes(".path-endpoint");
    }
    const centers = graph.nodes(".center");
    if (!centers.empty()) return centers;
    const tree = getEgoTree(graph);
    if (tree?.centerId) {
      const centerNode = graph.getElementById(tree.centerId);
      if (!centerNode.empty()) return centerNode;
    }
    return graph.collection();
  }

  function isOrphanVisibilityRoot(node) {
    if (node.hasClass("center")) return true;
    return renderOptions.mode === "explore" && node.hasClass("path-endpoint");
  }

  /** Keep only nodes reachable from center (or explore endpoints) via visible edges. */
  function reachableNodeIdsFromRoots(graph) {
    const roots = orphanVisibilityRoots(graph);
    const reachable = new Set();
    const queue = [];
    roots.forEach((node) => {
      reachable.add(node.id());
      queue.push(node.id());
    });
    while (queue.length) {
      const nodeId = queue.shift();
      const node = graph.getElementById(nodeId);
      if (node.empty()) continue;
      node.connectedEdges().forEach((edge) => {
        if (!isEdgeGraphVisible(edge)) return;
        const other = edge.source().id() === nodeId ? edge.target() : edge.source();
        const otherId = other.id();
        if (reachable.has(otherId)) return;
        reachable.add(otherId);
        queue.push(otherId);
      });
    }
    return reachable;
  }

  function applyOrphanNodeVisibility() {
    if (!cy) return false;
    const roots = orphanVisibilityRoots(cy);
    if (roots.empty()) return false;
    const reachable = reachableNodeIdsFromRoots(cy);
    let changed = false;
    cy.nodes().forEach((node) => {
      const hide = !isOrphanVisibilityRoot(node) && !reachable.has(node.id());
      if (node.hasClass("orphan-hidden") !== hide) changed = true;
      node.toggleClass("orphan-hidden", hide);
    });
    return changed;
  }

  function applyEgoEdgeVisibility() {
    if (!cy) return;
    if (isEgoLikeMode(renderOptions.mode)) {
      const center = cy.nodes(".center");
      const centerId = center.empty() ? null : center.id();
      cy.edges().forEach((edge) => {
        const onPath = edge.hasClass("on-path");
        const onPathAlt = edge.hasClass("on-path-alt");
        const selected = edge.source().hasClass("sel")
          || edge.target().hasClass("sel")
          || edge.hasClass("sel")
          || onPath
          || onPathAlt;
        const centerLinked = centerId
          && (edge.source().id() === centerId || edge.target().id() === centerId);
        const hopA = hopIndex(edge.source().data("role"));
        const hopB = hopIndex(edge.target().data("role"));
        const hopLinked = Math.abs(hopA - hopB) <= 1;
        const pathLinked = (edge.source().hasClass("path-node")
          && edge.target().hasClass("path-node"))
          || (edge.source().hasClass("path-node-alt")
            && edge.target().hasClass("path-node-alt"));
        const pathAltLinked = edge.source().hasClass("path-node-alt")
          || edge.target().hasClass("path-node-alt");
        const egoVisible = selected || centerLinked || hopLinked || onPath || onPathAlt
          || pathLinked || pathAltLinked;
        edge.toggleClass("ego-hidden", !egoVisible);
        edge.toggleClass("center-adjacent", !!centerLinked);
        edge.toggleClass("hop-link", !centerLinked && hopLinked);
      });
    }
    applyCategoryEdgeVisibility();
    applyOrphanNodeVisibility();
  }

  function applyEdgeLabels() {
    if (!cy) return;
    cy.edges().removeClass("show-label");
    if (showAllEdgeLabels) {
      const visible = cy.edges().not(".ego-hidden").not(".cat-hidden").not(".kind-hidden");
      const pool = visible.filter(".center-adjacent, .hop-link, .sel");
      if (visible.length <= EDGE_LABEL_CAP) {
        visible.addClass("show-label");
      } else {
        pool.addClass("show-label");
      }
    } else {
      cy.edges(".sel, .on-path, .on-path-alt").addClass("show-label");
    }
    syncLabelFontSizes();
  }

  function bindViewportTracking(graph) {
    if (graph.scratch("_viewportBound")) return;
    graph.scratch("_viewportBound", true);
    graph.on("zoom pan", (ev) => {
      if (ev.originalEvent) viewportUserAdjusted = true;
      syncLabelFontSizes();
    });
  }

  function applyPathHighlight(pathEdgeIds) {
    if (!cy || !pathEdgeIds?.length) return;
    cy.elements().addClass("dimmed");
    pathEdgeIds.forEach((eid) => {
      const edge = cy.getElementById(eid);
      if (!edge.empty()) {
        edge.removeClass("dimmed").addClass("on-path sel");
        edge.source().removeClass("dimmed");
        edge.target().removeClass("dimmed");
      }
    });
    applyEgoEdgeVisibility();
    applyEdgeLabels();
  }

  function buildDragSnapshot(root) {
    const snapshot = {
      rootId: root.id(),
      rootStart: { ...root.position() },
      nodes: new Map(),
    };

    const queue = [{ node: root, depth: 0 }];
    const seen = new Set([root.id()]);
    while (queue.length) {
      const { node, depth } = queue.shift();
      if (depth >= 2) continue;
      node.neighborhood("node").forEach((neighbor) => {
        if (neighbor.locked() || seen.has(neighbor.id())) return;
        seen.add(neighbor.id());
        snapshot.nodes.set(neighbor.id(), {
          start: { ...neighbor.position() },
        });
        queue.push({ node: neighbor, depth: depth + 1 });
      });
    }
    return snapshot;
  }

  function applyDragFollow(root) {
    if (!dragSnapshot || dragSnapshot.rootId !== root.id()) return;
    const dx = root.position("x") - dragSnapshot.rootStart.x;
    const dy = root.position("y") - dragSnapshot.rootStart.y;
    dragSnapshot.nodes.forEach((entry, id) => {
      const node = cy.getElementById(id);
      if (node.empty() || node.locked()) return;
      node.position({
        x: entry.start.x + dx,
        y: entry.start.y + dy,
      });
    });
  }

  function bindDragFollow(graph) {
    if (graph.scratch("_dragFollowBound")) return;
    graph.scratch("_dragFollowBound", true);

    graph.on("grab", "node", (ev) => {
      const node = ev.target;
      if (node.locked() || node.hasClass("center")) return;
      containerEl?.classList.add("is-dragging");
      graph.edges().removeClass("show-label");
      node.addClass("grabbed");
      if (renderOptions.mode === "explore") {
        dragSnapshot = buildDragSnapshot(node);
        return;
      }
      dragSnapshot = null;
    });

    graph.on("drag", "node", (ev) => {
      const node = ev.target;
      if (renderOptions.mode === "explore") {
        if (dragSnapshot) applyDragFollow(node);
      }
    });

    graph.on("free", "node", (ev) => {
      const node = ev.target;
      node.removeClass("grabbed");
      containerEl?.classList.remove("is-dragging");
      dragRafPending = false;
      dragRelayoutId = null;
      dragSnapshot = null;

      const tree = graph.scratch("_egoTree");
      if (
        tree
        && usesHierarchicalLayout(renderOptions.mode)
        && !node.hasClass("center")
        && (tree.children.get(node.id()) || []).length
      ) {
        layoutRadialSubtree(graph, tree, node.id(), { localCore: true });
        finishDragSubtreeLayout(graph, tree, node.id());
      }

      applyEdgeLabels();
    });
  }

  function ensureCy(compactEdges = false) {
    if (typeof cytoscape === "undefined") {
      throw new Error("圖譜庫未加載，請刷新頁面");
    }
    if (!containerEl) throw new Error("圖譜容器不存在");
    if (cy) {
      try { cy.destroy(); } catch { /* ignore */ }
      cy = null;
    }

    if (containerEl.getBoundingClientRect().height < 10) {
      containerEl.style.minHeight = "420px";
    }
    containerEl.innerHTML = "";

    const edgeWidth = compactEdges ? 0.55 : 0.7;
    const edgeSelWidth = compactEdges ? 0.95 : 1.2;

    cy = cytoscape({
      container: containerEl,
      wheelSensitivity: 0.22,
      minZoom: 0.2,
      maxZoom: 3,
      autoungrabify: false,
      boxSelectionEnabled: false,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "bottom",
            "text-halign": "center",
            "font-size": "9px",
            "font-family": (typeof window !== "undefined" && window.CBDBHanzi?.hanFontFamily?.()) || 'CBDBHanFont, "Noto Serif TC", "Noto Serif SC", serif',
            color: "#1a1a1a",
            "text-margin-y": 1,
            "min-zoomed-font-size": 0,
            "text-outline-width": 2,
            "text-outline-color": "#f4f7f9",
            width: "data(nodeSize)",
            height: "data(nodeSize)",
            "background-color": "data(color)",
            "border-width": 2,
            "border-color": "#d8e2e8",
            "transition-property": "border-width, border-color",
            "transition-duration": "0.12s",
          },
        },
        {
          selector: "node.center",
          style: {
            width: CENTER_SIZE,
            height: CENTER_SIZE,
            "border-color": PALETTE.center,
            "border-width": 4,
            "font-weight": 600,
            "font-size": "10px",
            "text-margin-y": 1,
          },
        },
        {
          selector: "node.path-endpoint",
          style: {
            width: PATH_ENDPOINT_SIZE,
            height: PATH_ENDPOINT_SIZE,
            "border-color": "#c45c2a",
            "border-width": 4,
          },
        },
        {
          selector: "node.geo-node",
          style: {
            shape: "diamond",
            "font-size": "8px",
            "border-color": "#8b7355",
          },
        },
        {
          selector: "node.grabbed",
          style: { "border-color": "#c45c2a", "border-width": 3 },
        },
        {
          selector: "node.orphan-hidden",
          style: { display: "none" },
        },
        {
          selector: "node.sel",
          style: {
            "border-color": PATH_HIGHLIGHT,
            "border-width": 4,
            "overlay-color": PATH_HIGHLIGHT,
            "overlay-opacity": 0.14,
            "overlay-padding": 8,
          },
        },
        {
          selector: "node.path-node",
          style: {
            "border-color": PATH_HIGHLIGHT,
            "border-width": 2.5,
            opacity: 1,
          },
        },
        {
          selector: "node.path-node-alt",
          style: {
            "border-color": PATH_HIGHLIGHT_ALT,
            "border-width": 2,
            opacity: 0.9,
          },
        },
        {
          selector: "node.dimmed",
          style: { opacity: DIMMED_NODE_OPACITY },
        },
        {
          selector: "edge",
          style: {
            width: edgeWidth,
            "line-color": "data(color)",
            "target-arrow-color": "data(color)",
            "target-arrow-shape": "data(arrowShape)",
            "arrow-scale": 0.22,
            "curve-style": "bezier",
            "control-point-step-size": 40,
            "edge-distances": "intersection",
            "source-endpoint": "outside-to-node",
            "target-endpoint": "outside-to-node",
            "line-cap": "round",
            opacity: 0.82,
            "line-style": "data(lineStyle)",
            "z-index": 0,
          },
        },
        {
          selector: "edge.ego-hidden",
          style: { opacity: 0.04, width: 0.2, "z-index": 0 },
        },
        {
          selector: "edge.cat-hidden",
          style: { display: "none" },
        },
        {
          selector: "edge.kind-hidden",
          style: { display: "none" },
        },
        {
          selector: "edge.hop-link",
          style: {
            opacity: 0.78,
            width: edgeWidth,
            "control-point-step-size": 44,
            "z-index": 1,
          },
        },
        {
          selector: "edge.center-adjacent",
          style: {
            opacity: 0.92,
            width: edgeWidth * 1.08,
            "control-point-step-size": 48,
            "z-index": 2,
          },
        },
        {
          selector: "edge.dimmed",
          style: { opacity: DIMMED_EDGE_OPACITY },
        },
        {
          selector: "edge.on-path",
          style: {
            width: edgeSelWidth * 1.05,
            opacity: 1,
            "line-color": PATH_HIGHLIGHT,
            "target-arrow-color": PATH_HIGHLIGHT,
            "z-index": 15,
          },
        },
        {
          selector: "edge.on-path-alt",
          style: {
            width: edgeSelWidth * 0.9,
            opacity: 0.78,
            "line-color": PATH_HIGHLIGHT_ALT,
            "target-arrow-color": PATH_HIGHLIGHT_ALT,
            "line-style": "dashed",
            "z-index": 12,
          },
        },
        {
          selector: "edge.sel",
          style: { width: edgeSelWidth, opacity: 1, "z-index": 10 },
        },
        {
          selector: "edge.show-label",
          style: {
            ...EDGE_LABEL_STYLE,
            "font-size": `${GRAPH_SCALE.labelBase.edge}px`,
          },
        },
      ],
    });
    bindDragFollow(cy);
    bindViewportTracking(cy);
    return cy;
  }

  function clearSelection() {
    if (!cy) return;
    cy.elements().removeClass("sel on-path on-path-alt path-node path-node-alt");
    if (renderOptions.mode !== "explore") {
      cy.elements().removeClass("dimmed");
    }
    applyEgoEdgeVisibility();
    applyEdgeLabels();
  }

  function selectNode(node) {
    if (!cy || !node) return;
    if (renderOptions.mode === "explore") {
      cy.elements().removeClass("sel");
      node.addClass("sel");
      node.connectedEdges().addClass("sel");
      applyEgoEdgeVisibility();
      applyEdgeLabels();
      return;
    }
    if (isEgoLikeMode(renderOptions.mode)) {
      highlightEgoCenterPath(node);
      return;
    }
    cy.elements().removeClass("sel");
    node.addClass("sel");
    node.connectedEdges().addClass("sel");
    applyEgoEdgeVisibility();
    applyEdgeLabels();
  }

  function selectEdge(edge) {
    if (!cy || !edge) return;
    if (renderOptions.mode === "explore") {
      cy.elements().removeClass("sel");
      edge.addClass("sel");
      edge.source().addClass("sel");
      edge.target().addClass("sel");
      applyEgoEdgeVisibility();
      applyEdgeLabels();
      return;
    }
    if (isEgoLikeMode(renderOptions.mode)) {
      const focus = edge.source().hasClass("center") ? edge.target() : edge.source();
      highlightEgoCenterPath(focus);
      edge.addClass("sel on-path");
      edge.removeClass("on-path-alt dimmed");
      return;
    }
    cy.elements().removeClass("sel");
    edge.addClass("sel");
    edge.source().addClass("sel");
    edge.target().addClass("sel");
    applyEgoEdgeVisibility();
    applyEdgeLabels();
  }

  const CbdbGraph = {
    mount(container) {
      containerEl = container;
    },

    destroy() {
      if (cy) {
        try { cy.destroy(); } catch { /* ignore */ }
        cy = null;
      }
      dragSnapshot = null;
      viewportUserAdjusted = false;
      dragRafPending = false;
      dragRelayoutId = null;
    },

    resize(options = {}) {
      if (!cy) return;
      const refit = options.refit === true;
      const zoom = cy.zoom();
      const pan = cy.pan();
      cy.resize();
      if (refit || !viewportUserAdjusted) {
        syncLabelFontSizes();
        refitViewport(cy);
        return;
      }
      cy.zoom(zoom);
      cy.pan(pan);
    },

    getViewport() {
      if (!cy) return null;
      return { zoom: cy.zoom(), pan: { x: cy.pan().x, y: cy.pan().y } };
    },

    setViewport(viewport) {
      if (!cy || !viewport) return;
      cy.zoom(viewport.zoom);
      cy.pan(viewport.pan);
      viewportUserAdjusted = true;
      syncLabelFontSizes();
    },

    setEdgeLabelsVisible(visible) {
      showAllEdgeLabels = !!visible;
      applyEdgeLabels();
    },

    setCategoryFilters(filters) {
      activeCategoryFilters = cloneCategoryFilters(filters || DEFAULT_CATEGORY_FILTERS);
      renderOptions.categoryFilters = activeCategoryFilters;
      applyEgoEdgeVisibility();
      applyEdgeLabels();
      if (!viewportUserAdjusted) refitViewport(cy);
    },

    getCategoryFilters() {
      return cloneCategoryFilters(activeCategoryFilters);
    },

    defaultCategoryFilters: cloneCategoryFilters(),
    categoryLabels: CATEGORY_LABELS,

    highlightPath(edgeIds) {
      applyPathHighlight(edgeIds || []);
    },

    applySelection(selection) {
      if (!cy || !selection) return;
      if (selection.kind === "none" || selection.kind === "empty") {
        clearSelection();
        return;
      }
      if (selection.kind === "node") {
        let node = cy.collection();
        if (selection.personId != null) {
          node = cy.nodes().filter(
            (n) => String(n.data("personId")) === String(selection.personId),
          );
        }
        if (node.empty() && selection.label) {
          const label = String(selection.label);
          node = cy.nodes().filter(
            (n) => n.data("fullLabel") === label || n.data("label") === label,
          );
        }
        if (!node.empty()) selectNode(node.first());
        return;
      }
      if (selection.kind === "edge") {
        const edges = cy.edges().filter((edge) => {
          if (selection.label && edge.data("fullLabel") === selection.label) return true;
          const src = String(edge.source().data("personId") ?? edge.source().id());
          const tgt = String(edge.target().data("personId") ?? edge.target().id());
          return selection.sourceId != null
            && selection.targetId != null
            && ((src === String(selection.sourceId) && tgt === String(selection.targetId))
              || (src === String(selection.targetId) && tgt === String(selection.sourceId)));
        });
        if (!edges.empty()) selectEdge(edges.first());
      }
    },

    highlightNodes(nodeIds) {
      if (!cy) return;
      cy.elements().removeClass("sel dimmed");
      const ids = new Set((nodeIds || []).map(String));
      cy.nodes().forEach((node) => {
        const pid = String(node.data("personId"));
        if (ids.has(node.id()) || ids.has(pid)) {
          node.addClass("sel");
          node.connectedEdges().addClass("sel");
        } else {
          node.addClass("dimmed");
        }
      });
    },

    fitNodes(nodeIds) {
      if (!cy) return;
      const ids = new Set((nodeIds || []).map(String));
      const nodes = cy.nodes().filter(
        (n) => ids.has(n.id()) || ids.has(String(n.data("personId"))),
      );
      if (nodes.length) {
        viewportUserAdjusted = true;
        cy.fit(nodes, 64);
      }
    },

    zoomBy(factor) {
      if (!cy) return;
      viewportUserAdjusted = true;
      const z = cy.zoom() * factor;
      cy.zoom(Math.max(cy.minZoom(), Math.min(cy.maxZoom(), z)));
    },

    exportPng() {
      if (!cy) return null;
      return cy.png({ bg: "#ffffff", full: true, scale: 2 });
    },

    async render(data, handlers = {}, options = {}) {
      if (!containerEl) throw new Error("圖譜容器不存在");
      const graphData = SCHEMA.sanitizeGraphPayload?.(data) ?? data;
      renderOptions = options;
      activeCategoryFilters = cloneCategoryFilters(
        options.categoryFilters || DEFAULT_CATEGORY_FILTERS,
      );
      renderOptions.categoryFilters = activeCategoryFilters;
      viewportUserAdjusted = false;
      CbdbGraph.destroy();
      await waitFrames(2);
      const compactEdges = options.mode === "ego" || !options.mode;
      const graph = ensureCy(compactEdges);
      const elements = buildElements(graphData, options);
      graph.add(elements);
      graph.nodes().forEach((n) => {
        const role = n.data("role");
        if (role === "center") n.addClass("center");
        if (role === "path-endpoint") n.addClass("path-endpoint");
      });
      applyGraphNodeSizing(graph, graphData, options);
      applyEgoEdgeVisibility();
      applyEdgeLabels();

      graph.off("tap");
      graph.on("tap", "node", (ev) => {
        const node = ev.target;
        selectNode(node);
        handlers.onSelect?.({
          kind: "node",
          personId: node.data("personId"),
          label: node.data("fullLabel"),
          role: node.data("role"),
          nodeType: node.data("nodeType") || "person",
          splitKey: node.data("splitKey"),
          meta: {
            years: node.data("years"),
            dynastyChn: node.data("dynastyChn"),
            choronymChn: node.data("choronymChn"),
            indexAddrChn: node.data("indexAddrChn"),
            splitKey: node.data("splitKey"),
          },
        });
      });
      graph.on("tap", "edge", (ev) => {
        const edge = ev.target;
        selectEdge(edge);
        handlers.onSelect?.({
          kind: "edge",
          edgeType: edge.data("edgeType"),
          label: edge.data("fullLabel"),
          category: edge.data("category"),
          detail: edge.data("detail") || {},
          sourceId: edge.source().data("personId"),
          targetId: edge.target().data("personId"),
        });
      });
      graph.on("tap", (ev) => {
        if (ev.target === graph) {
          clearSelection();
          handlers.onSelect?.({ kind: "none", center: graphData });
        }
      });

      await runLayout(
        graph,
        elements.filter((e) => !e.data.source).length,
      );
      syncLabelFontSizes();
      if (options.initialViewport) {
        graph.zoom(options.initialViewport.zoom);
        graph.pan(options.initialViewport.pan);
        viewportUserAdjusted = true;
      } else {
        refitViewport(graph);
      }
      handlers.onReady?.(graphData);
      return graph;
    },

    fit() {
      if (!cy || !cy.nodes().length) return;
      viewportUserAdjusted = false;
      syncLabelFontSizes();
      refitViewport(cy);
    },

    palette: PALETTE,
    structuralTypeLabel: SCHEMA.structuralTypeLabel,
    categoryLabel: SCHEMA.categoryLabel,
    edgeSchema: SCHEMA,
  };

  global.CbdbGraph = CbdbGraph;
  global.RelationsGraph = CbdbGraph;
})(window);
