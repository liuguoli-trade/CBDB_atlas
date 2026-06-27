(function (global) {
  const SHOW_DELAY_MS = 100;
  const CANCEL_REASON = () => new DOMException("已取消載入", "AbortError");

  let nextId = 1;
  /** @type {Map<number, { message: string, controller: AbortController }>} */
  const active = new Map();
  /** @type {AbortController[]} */
  const controllerStack = [];
  let showTimer = null;
  let hideTimer = null;
  let visible = false;
  let cancelBound = false;
  let progressRaf = null;
  let progressStart = 0;
  let displayedProgress = 0;
  let userCancelPending = false;

  function els() {
    return {
      bar: document.getElementById("globalLoadingBar"),
      barText: document.getElementById("globalLoadingBarText"),
      barFill: document.getElementById("globalLoadingBarFill"),
      barProgress: document.getElementById("globalLoadingBarProgress"),
    };
  }

  function currentMessage() {
    const entries = [...active.values()];
    return entries.length ? entries[entries.length - 1].message : "載入中…";
  }

  function stopProgressAnimation() {
    if (progressRaf) {
      cancelAnimationFrame(progressRaf);
      progressRaf = null;
    }
  }

  function setProgress(pct) {
    const { barFill, barProgress } = els();
    displayedProgress = Math.max(0, Math.min(100, pct));
    if (barFill) barFill.style.width = `${displayedProgress}%`;
    if (barProgress) barProgress.setAttribute("aria-valuenow", String(Math.round(displayedProgress)));
  }

  function resetProgressVisual() {
    stopProgressAnimation();
    displayedProgress = 0;
    progressStart = 0;
    const { barFill } = els();
    if (barFill) {
      barFill.style.transition = "none";
      barFill.style.width = "0%";
    }
    setProgress(0);
  }

  function startProgressAnimation() {
    stopProgressAnimation();
    progressStart = performance.now();
    setProgress(8);

    const tick = (now) => {
      if (active.size === 0 || !visible) return;

      const elapsed = now - progressStart;
      const next = 8 + 82 * (1 - Math.exp(-elapsed / 2200));
      setProgress(Math.min(next, 92));
      if (active.size > 0 && displayedProgress < 92) {
        progressRaf = requestAnimationFrame(tick);
      }
    };
    progressRaf = requestAnimationFrame(tick);
  }

  function completeProgress(onDone) {
    stopProgressAnimation();
    const { barFill } = els();
    if (barFill) barFill.style.transition = "width 0.18s ease-out";
    setProgress(100);
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      onDone?.();
    }, 200);
  }

  function paint() {
    const { bar, barText, barFill } = els();
    if (!bar) return;

    const busy = active.size > 0;
    const msg = currentMessage();

    visible = busy;

    bar.classList.toggle("is-idle", !busy);
    bar.classList.remove("hidden");
    bar.setAttribute("aria-busy", busy ? "true" : "false");
    bar.setAttribute("aria-hidden", busy ? "false" : "true");
    document.body.classList.toggle("is-global-loading", busy);

    if (barText) barText.textContent = msg;

    if (busy) {
      if (barFill && displayedProgress === 0) {
        barFill.style.transition = "width 0.25s ease-out";
      }
      startProgressAnimation();
    } else {
      resetProgressVisual();
    }
  }

  function cancelShowTimer() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  }

  function refresh() {
    if (active.size > 0 && hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (active.size === 0) {
      cancelShowTimer();
      if (visible) {
        completeProgress(() => {
          visible = false;
          paint();
        });
      } else {
        visible = false;
        paint();
      }
      return;
    }
    if (visible) {
      paint();
      return;
    }
    if (!showTimer) {
      showTimer = setTimeout(() => {
        showTimer = null;
        if (active.size > 0) paint();
      }, SHOW_DELAY_MS);
    }
  }

  function pushController(controller) {
    controllerStack.push(controller);
  }

  function popController(controller) {
    const idx = controllerStack.indexOf(controller);
    if (idx >= 0) controllerStack.splice(idx, 1);
  }

  function isUserCancelError(err) {
    if (!err) return false;
    if (userCancelPending) return true;
    if (err.name !== "AbortError") return false;
    const msg = String(err.message || "");
    if (/已取消載入/.test(msg)) return true;
    const reason = err.cause ?? err.reason;
    if (reason && /已取消載入/.test(String(reason.message || ""))) return true;
    return false;
  }

  function begin(message = "載入中…", _mode = "bar") {
    userCancelPending = false;
    const id = nextId++;
    const controller = new AbortController();
    active.set(id, { message, controller });
    pushController(controller);
    refresh();
    return id;
  }

  function end(id) {
    const entry = active.get(id);
    if (entry?.controller) popController(entry.controller);
    if (id != null) active.delete(id);
    refresh();
  }

  function getSignal() {
    const top = controllerStack[controllerStack.length - 1];
    return top?.signal ?? null;
  }

  function mergeSignal(external) {
    const loading = getSignal();
    if (!external) return loading;
    if (!loading) return external;
    if (external.aborted) return external;
    if (loading.aborted) return loading;
    const merged = new AbortController();
    const abort = (source) => {
      if (merged.signal.aborted) return;
      merged.abort(source?.reason ?? CANCEL_REASON());
    };
    external.addEventListener("abort", () => abort(external), { once: true });
    loading.addEventListener("abort", () => abort(loading), { once: true });
    return merged.signal;
  }

  function cancelAll() {
    userCancelPending = true;
    const reason = CANCEL_REASON();
    for (const controller of [...controllerStack]) {
      try {
        if (!controller.signal.aborted) controller.abort(reason);
      } catch {
        /* ignore */
      }
    }
    global.dispatchEvent(new CustomEvent("cbdb:loading-cancelled"));
  }

  function bindCancelButtons() {
    if (cancelBound) return;
    cancelBound = true;
    document.querySelectorAll("[data-loading-cancel]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelAll();
      });
    });
  }

  async function withLoading(fn, opts = {}) {
    const message = opts.message ?? "載入中…";
    const id = begin(message);
    try {
      if (typeof fn === "function" && fn.length >= 1) {
        return await fn({ signal: getSignal() });
      }
      return await fn();
    } finally {
      end(id);
    }
  }

  function init() {
    bindCancelButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.CbdbLoading = {
    begin,
    end,
    withLoading,
    getSignal,
    mergeSignal,
    cancelAll,
    isUserCancelError,
  };
})(globalThis);
