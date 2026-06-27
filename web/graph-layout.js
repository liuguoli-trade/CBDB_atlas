/**
 * CBDB Atlas — graph layout helpers (collision, viewport, tree anchoring)
 */
(function (global) {
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function nodeCollisionRadius(node, fallback = 12) {
    const half = (node.data("nodeSize") || fallback) / 2;
    const labelPad = node.data("label") ? 8 + half * 0.35 : 6;
    return half + labelPad;
  }

  function movableNodes(graph) {
    return graph.nodes().not(".center").not(".orphan-hidden");
  }

  function resolveCollisions(graph, padding = 12, iterations = 16) {
    const nodes = movableNodes(graph);
    for (let iter = 0; iter < iterations; iter += 1) {
      let moved = false;
      nodes.forEach((a) => {
        if (a.locked()) return;
        nodes.forEach((b) => {
          if (a.id() >= b.id()) return;
          if (b.locked()) return;
          const dx = b.position("x") - a.position("x");
          const dy = b.position("y") - a.position("y");
          const dist = Math.hypot(dx, dy) || 0.01;
          const minDist = nodeCollisionRadius(a) + nodeCollisionRadius(b) + padding;
          if (dist >= minDist) return;
          const push = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          if (!a.locked()) {
            a.position({
              x: a.position("x") - ux * push,
              y: a.position("y") - uy * push,
            });
          }
          if (!b.locked()) {
            b.position({
              x: b.position("x") + ux * push,
              y: b.position("y") + uy * push,
            });
          }
          moved = true;
        });
      });
      if (!moved) break;
    }
  }

  function clampOrbitToCanvas(graph, margin = 48) {
    graph.resize();
    const w = graph.width() || 800;
    const h = graph.height() || 600;
    movableNodes(graph).forEach((node) => {
      if (node.locked()) return;
      const r = nodeCollisionRadius(node);
      node.position({
        x: clamp(node.position("x"), margin + r, w - margin - r),
        y: clamp(node.position("y"), margin + r, h - margin - r),
      });
    });
  }

  function nodesFromIdSet(graph, idSet) {
    const nodes = [];
    idSet.forEach((id) => {
      const node = graph.getElementById(id);
      if (!node.empty() && !node.locked() && !node.hasClass("orphan-hidden")) {
        nodes.push(node);
      }
    });
    return nodes;
  }

  function resolveCollisionsAmong(graph, idSet, padding = 12, iterations = 12) {
    const nodes = nodesFromIdSet(graph, idSet);
    for (let iter = 0; iter < iterations; iter += 1) {
      let moved = false;
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          const dx = b.position("x") - a.position("x");
          const dy = b.position("y") - a.position("y");
          const dist = Math.hypot(dx, dy) || 0.01;
          const minDist = nodeCollisionRadius(a) + nodeCollisionRadius(b) + padding;
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
  }

  function anchorTreeChildrenInSet(graph, idSet, branchStrength = 0.48, leafStrength = 0.15) {
    const anchors = graph.scratch("_layoutParentAnchors");
    if (!anchors || typeof anchors.forEach !== "function") return;
    idSet.forEach((nodeId) => {
      const node = graph.getElementById(nodeId);
      if (node.empty() || node.locked()) return;
      const anchor = anchors.get(nodeId);
      if (!anchor) return;
      const isLeaf = !!anchor.isLeaf;
      const t = clamp(isLeaf ? leafStrength : branchStrength, 0, 1);
      const parentNode = graph.getElementById(anchor.parentId);
      if (parentNode.empty()) return;
      const px = parentNode.position("x");
      const py = parentNode.position("y");
      const cx = node.position("x");
      const cy = node.position("y");
      const dx = cx - px;
      const dy = cy - py;
      const dist = Math.hypot(dx, dy) || 0.01;
      const ideal = anchor.idealDist;
      const slack = isLeaf ? 1.25 : 1.1;
      if (dist <= ideal * slack) return;
      const tx = px + (dx / dist) * ideal;
      const ty = py + (dy / dist) * ideal;
      node.position({
        x: cx + (tx - cx) * t,
        y: cy + (ty - cy) * t,
      });
    });
  }

  function clampNodesToCanvas(graph, idSet, margin = 36) {
    graph.resize();
    const w = graph.width() || 800;
    const h = graph.height() || 600;
    idSet.forEach((id) => {
      const node = graph.getElementById(id);
      if (node.empty() || node.locked()) return;
      const r = nodeCollisionRadius(node);
      node.position({
        x: clamp(node.position("x"), margin + r, w - margin - r),
        y: clamp(node.position("y"), margin + r, h - margin - r),
      });
    });
  }

  /** Pull nodes back toward their layout-tree parent after collision separation. */
  function anchorTreeChildren(graph, branchStrength = 0.52, leafStrength = 0.18) {
    const anchors = graph.scratch("_layoutParentAnchors");
    if (!anchors || typeof anchors.forEach !== "function") return;
    movableNodes(graph).forEach((node) => {
      if (node.locked()) return;
      const anchor = anchors.get(node.id());
      if (!anchor) return;
      const isLeaf = !!anchor.isLeaf;
      const t = clamp(isLeaf ? leafStrength : branchStrength, 0, 1);
      const parentNode = graph.getElementById(anchor.parentId);
      if (parentNode.empty()) return;
      const px = parentNode.position("x");
      const py = parentNode.position("y");
      const cx = node.position("x");
      const cy = node.position("y");
      const dx = cx - px;
      const dy = cy - py;
      const dist = Math.hypot(dx, dy) || 0.01;
      const ideal = anchor.idealDist;
      const slack = isLeaf ? 1.22 : 1.08;
      if (dist <= ideal * slack) return;
      const tx = px + (dx / dist) * ideal;
      const ty = py + (dy / dist) * ideal;
      node.position({
        x: cx + (tx - cx) * t,
        y: cy + (ty - cy) * t,
      });
    });
  }

  function waitForContainer(graph, maxFrames = 60) {
    return new Promise((resolve) => {
      let frames = 0;
      const tick = () => {
        graph.resize();
        const el = graph.container?.();
        const rect = el?.getBoundingClientRect?.();
        if ((rect && rect.width > 10 && rect.height > 10) || frames >= maxFrames) {
          resolve();
          return;
        }
        frames += 1;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function viewportFitCenter(graph, padding = 64, opts = {}) {
    const centerFirst = opts.centerFirst !== false;
    const ensureAllVisible = opts.ensureAllVisible !== false;
    const nodes = graph.nodes().not(".orphan-hidden");
    const center = graph.nodes(".center");
    if (!nodes.length && !center.length) return;

    if (centerFirst && !center.empty()) {
      graph.fit(nodes.length ? nodes : center, padding);
      const c = center.first();
      const w = graph.width() || 800;
      const h = graph.height() || 600;
      const pan = {
        x: w / 2 - c.position("x") * graph.zoom(),
        y: h / 2 - c.position("y") * graph.zoom(),
      };
      graph.pan(pan);
    } else {
      graph.fit(nodes.length ? nodes : center, padding);
    }

    if (!ensureAllVisible) return;
    graph.resize();
    const ext = nodes.boundingBox();
    if (!ext.w && !ext.h) return;
    const w = graph.width() || 800;
    const h = graph.height() || 600;
    const z = graph.zoom();
    const pad = padding;
    const left = ext.x1 * z + graph.pan().x;
    const right = ext.x2 * z + graph.pan().x;
    const top = ext.y1 * z + graph.pan().y;
    const bottom = ext.y2 * z + graph.pan().y;
    let panX = graph.pan().x;
    let panY = graph.pan().y;
    if (left < pad) panX += pad - left;
    if (right > w - pad) panX -= right - (w - pad);
    if (top < pad) panY += pad - top;
    if (bottom > h - pad) panY -= bottom - (h - pad);
    if (panX !== graph.pan().x || panY !== graph.pan().y) {
      graph.pan({ x: panX, y: panY });
    }
  }

  global.CbdbGraphLayout = {
    resolveCollisions,
    resolveCollisionsAmong,
    clampOrbitToCanvas,
    clampNodesToCanvas,
    anchorTreeChildren,
    anchorTreeChildrenInSet,
    waitForContainer,
    viewportFitCenter,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
