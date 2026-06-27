/**
 * CBDB Atlas — shared graph detail panel helpers
 */
(function (global) {
  const schema = () => global.GraphEdgeSchema;

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatGraphNodeRole(role) {
    if (role === "center") return "中心人物";
    if (role === "path-endpoint") return "查詢人物";
    if (role === "path-via") return "路徑中間人";
    if (role === "geo-choronym") return "郡望節點";
    if (role === "geo-place") return "籍貫節點";
    const hop = Number.parseInt(String(role || "").replace("hop", ""), 10);
    if (Number.isFinite(hop)) return `第 ${hop} 步節點`;
    if (role === "assoc") return "社會關係對象";
    if (role === "kin") return "親屬";
    return "親屬";
  }

  function formatAssociationFirstYearDisplay(detail) {
    const y = detail?.c_assoc_first_year;
    if (y == null || y === "") return "—";
    return String(y);
  }

  function formatSourceDisplay(detail, moduleKey) {
    const title = detail?.c_source_chn || detail?.c_title_chn || detail?.c_source_title;
    const pages = detail?.c_pages;
    if (title && pages) return `${title} · ${pages}`;
    return title || pages || "—";
  }

  function formatEdgeCategoryLabel(edgeType, category) {
    if (schema()?.categoryLabel) {
      return schema().categoryLabel(edgeType, category);
    }
    const labels = globalThis.CbdbGraph?.categoryLabels || {};
    if (edgeType === "association") {
      return labels.assoc?.[category] || category || "—";
    }
    if (edgeType?.startsWith("kinship")) {
      return labels.kin?.[category] || category || "—";
    }
    return category || "—";
  }

  function formatStructuralTypeLabel(edgeType) {
    if (schema()?.structuralTypeLabel) {
      return schema().structuralTypeLabel(edgeType);
    }
    if (edgeType === "association") return "社會關係";
    if (edgeType?.startsWith("kinship")) return "親屬關係";
    return edgeType || "—";
  }

  function renderLegend(selection, graphData, context = {}) {
    const {
      showEdgeLabels = false,
      graphOptions = {},
    } = context;
    if (schema()?.renderContextualLegendHtml) {
      return schema().renderContextualLegendHtml(selection, graphData, {
        showEdgeLabels,
        ...graphOptions,
      });
    }
    const labelBtnText = showEdgeLabels ? "隱藏關係說明" : "顯示關係說明";
    return `
    <div class="relations-graph-legend">
      <span><i class="lg-center" aria-hidden="true"></i>中心人物</span>
      <button type="button" class="btn sm relations-graph-edge-labels" aria-pressed="${showEdgeLabels}">${labelBtnText}</button>
    </div>`;
  }

  function legendBlock(selection, graphData, context) {
    return renderLegend(selection, graphData, context);
  }

  function renderGraphDetail(selection, graphData, context = {}) {
    const {
      centerLabel = "—",
      centerPersonId = null,
      showEdgeLabels = false,
      standalone = false,
      lockedCenter = false,
      emptyHint = "請嘗試調整深度或關係類型。",
      idleHint = "點擊節點或連線查看詳情；點擊空白處還原摘要。",
    } = context;
    const showPick = standalone && !lockedCenter;
    const pickLabel = showPick ? "設為中心" : "打開人物";
    const pickTargetLabel = showPick ? "設為中心" : "打開對象";

    if (!selection || selection.kind === "none") {
      const center = graphData || {};
      return `
      <h4>${escapeHtml(center.center_label || centerLabel)}</h4>
      <p class="meta">人物編號 ${escapeHtml(String(centerPersonId || center.center_id || "—"))}</p>
      <p class="meta">${escapeHtml(idleHint)}</p>
      ${legendBlock(selection, graphData, context)}`;
    }

    if (selection.kind === "empty") {
      return `
      <h4>${escapeHtml(selection.center?.center_label || centerLabel)}</h4>
      <p class="meta">當前篩選下暫無可繪製的關係。</p>
      <p class="meta">${escapeHtml(emptyHint)}</p>
      ${legendBlock(selection, graphData, context)}`;
    }

    if (selection.kind === "node") {
      const nodeType = selection.nodeType || "person";
      if (nodeType === "choronym" || nodeType === "place") {
        return `
        <h4>${escapeHtml(selection.label || "—")}</h4>
        <dl>
          <dt>類型</dt><dd>${nodeType === "choronym" ? "郡望" : "籍貫"}</dd>
          <dt>標籤</dt><dd>${escapeHtml(selection.splitKey || selection.label || "—")}</dd>
        </dl>
        ${legendBlock(selection, graphData, context)}`;
      }
      const isCenter = Number(selection.personId) === Number(centerPersonId);
      const openBtn = !isCenter && selection.personId && !lockedCenter
        ? `<button type="button" class="btn sm open-person" data-person-id="${selection.personId}">${pickLabel}</button>`
        : "";
      const meta = selection.meta || {};
      const metaRows = [];
      if (meta.years) metaRows.push(`<dt>生卒</dt><dd>${escapeHtml(meta.years)}</dd>`);
      if (meta.dynastyChn) metaRows.push(`<dt>朝代</dt><dd>${escapeHtml(meta.dynastyChn)}</dd>`);
      if (meta.choronymChn) metaRows.push(`<dt>郡望</dt><dd>${escapeHtml(meta.choronymChn)}</dd>`);
      if (meta.indexAddrChn) metaRows.push(`<dt>索引地址</dt><dd>${escapeHtml(meta.indexAddrChn)}</dd>`);
      if (meta.splitKey) metaRows.push(`<dt>分支</dt><dd>${escapeHtml(meta.splitKey)}</dd>`);
      return `
      <h4>${escapeHtml(selection.label || "—")}</h4>
      <dl>
        <dt>節點角色</dt><dd>${isCenter ? "中心人物" : formatGraphNodeRole(selection.role)}</dd>
        <dt>編號</dt><dd>${escapeHtml(String(selection.personId || "—"))}</dd>
        ${metaRows.join("")}
      </dl>
      ${openBtn}
      ${legendBlock(selection, graphData, context)}`;
    }

    if (selection.kind === "edge") {
      const detail = selection.detail || {};
      const edgeType = selection.edgeType || "association";
      if (edgeType === "geo-link") {
        return `
        <h4>${escapeHtml(selection.label || "—")}</h4>
        <dl>
          <dt>結構類型</dt><dd>${escapeHtml(formatStructuralTypeLabel(edgeType))}</dd>
          <dt>分支</dt><dd>${escapeHtml(detail.split_key || "—")}</dd>
          <dt>郡望</dt><dd>${escapeHtml(detail.choronym_chn || "—")}</dd>
          <dt>索引地址</dt><dd>${escapeHtml(detail.index_addr_chn || "—")}</dd>
        </dl>
        ${legendBlock(selection, graphData, context)}`;
      }
      const moduleKey = edgeType === "association" ? "association" : "kinship";
      const name = moduleKey === "association"
        ? (detail.c_node_chn || detail.c_node_name || "—")
        : (detail.c_kin_chn || detail.c_kin_name || "—");
      const year = moduleKey === "association"
        ? formatAssociationFirstYearDisplay(detail)
        : "—";
      const source = formatSourceDisplay(detail, moduleKey);
      const targetId = moduleKey === "association" ? detail.c_node_id : detail.c_kin_id;
      const openBtn = targetId && !lockedCenter
        ? `<button type="button" class="btn sm open-person" data-person-id="${targetId}">${pickTargetLabel}</button>`
        : "";
      return `
      <h4>${escapeHtml(selection.label || "—")}</h4>
      <dl>
        <dt>關係名稱</dt><dd>${escapeHtml(selection.label || "—")}</dd>
        <dt>結構類型</dt><dd>${escapeHtml(formatStructuralTypeLabel(edgeType))}</dd>
        <dt>語義分類</dt><dd>${escapeHtml(formatEdgeCategoryLabel(edgeType, selection.category))}</dd>
        <dt>對象</dt><dd>${escapeHtml(name)}</dd>
        <dt>年份</dt><dd>${escapeHtml(year)}</dd>
        <dt>出處</dt><dd>${source === "—" ? "—" : escapeHtml(source)}</dd>
      </dl>
      ${openBtn}
      ${legendBlock(selection, graphData, context)}`;
    }

    if (selection.kind === "path") {
      const steps = (selection.steps || [])
        .map((s) => `${s.label || "關係"}`)
        .join(" → ");
      return `
      <h4>路徑 ${selection.index + 1}</h4>
      <p class="meta">${escapeHtml(String(selection.from))} → ${escapeHtml(String(selection.to))}</p>
      <p>${escapeHtml(steps || "（無步驟）")}</p>
      <button type="button" class="btn sm highlight-path" data-path-index="${selection.index}">在圖中高亮</button>
      ${legendBlock(selection, graphData, context)}`;
    }

    return "";
  }

  function bindDetailActions(host, { onOpenPerson, onToggleEdgeLabels, onHighlightPath } = {}) {
    host.querySelector(".open-person")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const pid = Number(e.currentTarget.dataset.personId);
      if (pid) onOpenPerson?.(pid);
    });
    host.querySelector(".relations-graph-edge-labels")?.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggleEdgeLabels?.();
    });
    host.querySelector(".highlight-path")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(e.currentTarget.dataset.pathIndex);
      onHighlightPath?.(idx);
    });
  }

  function renderAddrStats(addrStats) {
    if (!addrStats?.length) {
      return '<p class="meta">暫無籍貫統計。</p>';
    }
    const max = Math.max(...addrStats.map((a) => a.count));
    return `
    <div class="addr-stats-panel">
      <h4>交游對象籍貫分布</h4>
      <ul class="addr-stats-list">
        ${addrStats.map((a, i) => `
          <li>
            <button type="button" class="addr-stat-row" data-addr-index="${i}">
              <span class="addr-stat-label">${escapeHtml(a.addr_chn)}</span>
              <span class="addr-stat-bar-wrap"><span class="addr-stat-bar" style="width:${Math.round((a.count / max) * 100)}%"></span></span>
              <span class="addr-stat-count">${a.count}</span>
            </button>
          </li>`).join("")}
      </ul>
    </div>`;
  }

  function renderBranchStats(branchStats) {
    if (!branchStats?.length) {
      return '<p class="meta">暫無分支統計。</p>';
    }
    const max = Math.max(...branchStats.map((a) => a.count));
    return `
    <div class="addr-stats-panel">
      <h4>親屬分支分布（郡望／籍貫）</h4>
      <ul class="addr-stats-list">
        ${branchStats.map((a, i) => `
          <li>
            <button type="button" class="addr-stat-row" data-addr-index="${i}">
              <span class="addr-stat-label">${escapeHtml(a.addr_chn || a.split_key)}</span>
              <span class="addr-stat-bar-wrap"><span class="addr-stat-bar" style="width:${Math.round((a.count / max) * 100)}%"></span></span>
              <span class="addr-stat-count">${a.count}</span>
            </button>
          </li>`).join("")}
      </ul>
    </div>`;
  }

  global.GraphShell = {
    escapeHtml,
    formatGraphNodeRole,
    formatStructuralTypeLabel,
    formatEdgeCategoryLabel,
    renderLegend,
    renderGraphDetail,
    bindDetailActions,
    renderAddrStats,
    renderBranchStats,
  };
})(window);
