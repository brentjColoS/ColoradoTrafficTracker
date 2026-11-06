const informationElements = {
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  systemHero: document.getElementById("systemIntro"),
  systemHeroTitle: document.getElementById("systemHeroTitle"),
  systemHeroSource: document.getElementById("systemHeroSource"),
  systemHeroTarget: document.getElementById("systemHeroTarget"),
  systemHeroSignal: document.getElementById("systemHeroSignal"),
  architectureStage: document.getElementById("systemArchitecture"),
  verificationConsole: document.getElementById("verificationConsole"),
  systemOverview: document.getElementById("systemOverview"),
  systemState: document.getElementById("systemState"),
  systemStatusTitle: document.getElementById("systemStatusTitle"),
  systemSummary: document.getElementById("systemSummary"),
  systemCheckedAt: document.getElementById("systemCheckedAt"),
  statusCheckCount: document.getElementById("statusCheckCount"),
  statusSignalGrid: document.getElementById("statusSignalGrid"),
  statusDetailCount: document.getElementById("statusDetailCount"),
  statusSyncCallout: document.getElementById("statusSyncCallout"),
  statusSyncCalloutText: document.getElementById("statusSyncCalloutText"),
  operationalChecks: document.getElementById("operationalChecks"),
  statusRefresh: document.getElementById("statusRefresh")
};

const SYSTEM_STATUS_REFRESH_MS = 60_000;
const SYSTEM_STATUS_TIMEOUT_MS = 8_000;
let statusPulseTimer;
let statusPulseCleanupPending = false;
let statusPulseEpoch = 0;
let informationPageHidden = false;
const STATUS_HEARTBEAT_ANIMATIONS = new Set([
  "status-ecg-reveal", "status-ecg-handoff", "status-content-yield", "status-snapshot-yield"
]);

const apiExplorer = window.InformationApi.create({ apiBase: () => informationRuntime(window.location.pathname).apiBase });
const dataDailyRange = window.InformationData.create({ apiBase: () => informationRuntime(window.location.pathname).apiBase });

function initializeInformationPage() {
  apiExplorer.initialize();
  initializeInformationTheme();
  initializePanelBorderTraces();
  initializeGridLights();
  initializeHistoryTrackLights();
  initializeMotionBudget();
  initializeSystemHero();
  initializeArchitectureHighlights();
  initializeArchitectureConnectors();
  initializeVerificationConsole();
  void dataDailyRange.initialize();
  if (!informationElements.systemOverview) return;
  informationElements.statusRefresh?.addEventListener("click", () => void loadOperationalStatus());
  void loadOperationalStatus("initial");
  window.setInterval?.(() => {
    if (!document.hidden) void loadOperationalStatus("automatic");
  }, SYSTEM_STATUS_REFRESH_MS);
}

const GRID_MOTION_SCOPES = ".architecture-stage, .status-overview, .data-truth, .api-guardrails";
const MOTION_SCOPE_SELECTOR = [".system-hero", ".system-plain-flow", ".architecture-stage",
  ".runtime-panel", ".operations-panel", ".verification-console", ".status-overview",
  ".data-journey", ".geometry-gates", ".history-track", ".data-truth", ".api-guardrails",
  ".api-terminal", ".api-request-path", ".access-handoff", ".api-explorer"].join(",");

function initializeGridLights() {
  document.querySelectorAll(GRID_MOTION_SCOPES).forEach(section => {
    const grid = document.createElement("div");
    grid.className = "grid-light";
    grid.setAttribute("aria-hidden", "true");
    const beam = document.createElement("span");
    beam.className = "grid-light-beam";
    grid.appendChild(beam);
    section.appendChild(grid);
  });
}

function initializeMotionBudget() {
  const root = document.documentElement;
  const scopes = [...document.querySelectorAll(MOTION_SCOPE_SELECTOR)];
  const updateVisibility = () => {
    root?.classList?.toggle("motion-suspended", Boolean(document.hidden || informationPageHidden));
    updateStatusPulseVisibility();
  };
  updateVisibility();
  document.addEventListener?.("visibilitychange", updateVisibility);
  window.addEventListener?.("pagehide", () => {
    informationPageHidden = true;
    updateVisibility();
  });
  window.addEventListener?.("pageshow", () => {
    informationPageHidden = false;
    updateVisibility();
  });
  if (scopes.length === 0 || typeof window.IntersectionObserver !== "function") return;
  scopes.forEach(scope => scope.classList.add("motion-paused"));
  const observer = new window.IntersectionObserver(entries => {
    entries.forEach(entry => {
      entry.target.classList.toggle("motion-paused", !entry.isIntersecting);
      if (entry.target === informationElements.systemOverview) updateStatusPulseVisibility();
    });
  }, { rootMargin: "48px 0px", threshold: 0 });
  scopes.forEach(scope => observer.observe(scope));
  window.addEventListener?.("pagehide", event => {
    if (!event.persisted) observer.disconnect();
  });
}

function initializeHistoryTrackLights() {
  document.querySelectorAll(".history-track").forEach(track => {
    const rail = document.createElement("div");
    rail.className = "history-track-light";
    rail.setAttribute("aria-hidden", "true");
    rail.appendChild(document.createElement("span"));
    track.appendChild(rail);
  });
}

function initializeVerificationConsole() {
  const consolePanel = informationElements.verificationConsole;
  if (!consolePanel) return;
  let visible = typeof window.IntersectionObserver !== "function";
  let active = false;
  let disposed = false;
  const update = () => {
    const next = visible && !document.hidden && !disposed;
    if (next === active) return;
    active = next;
    consolePanel.classList.toggle("is-active", active);
    if (active) startVerificationGateSequence(consolePanel);
    else stopVerificationGateSequence(consolePanel);
  };
  let observer;
  if (typeof window.IntersectionObserver === "function") {
    observer = new window.IntersectionObserver(entries => {
      const entry = entries.find(entry => entry.target === consolePanel);
      if (entry) visible = entry.isIntersecting;
      update();
    }, { threshold: 0.22 });
    observer.observe(consolePanel);
  }
  document.addEventListener?.("visibilitychange", update);
  window.addEventListener?.("pagehide", event => {
    if (!event.persisted) {
      disposed = true;
      observer?.disconnect();
    }
    active = false;
    consolePanel.classList.remove("is-active");
    stopVerificationGateSequence(consolePanel);
  });
  window.addEventListener?.("pageshow", update);
  update();
}

function randomizeVerificationGates(consolePanel) {
  const gates = [...(consolePanel.querySelectorAll?.(".verification-checks li") || [])];
  for (let index = gates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [gates[index], gates[swapIndex]] = [gates[swapIndex], gates[index]];
  }

  const lastIndex = Math.max(1, gates.length - 1);
  return gates.map((gate, index) => {
    const secondsAfterAutomation = 1 + (index / lastIndex) * 4;
    gate.dataset.verificationOrder = String(index + 1);
    return { gate, completeAtSeconds: Number((3.3 + secondsAfterAutomation).toFixed(2)) };
  });
}

const verificationSequenceTimers = new WeakMap();

function startVerificationGateSequence(consolePanel) {
  stopVerificationGateSequence(consolePanel);
  const gates = [...(consolePanel.querySelectorAll?.(".verification-checks li") || [])];
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    gates.forEach(gate => gate.classList.add("is-complete"));
    return;
  }

  const sequence = { stopped: false, timers: [] };
  const runCycle = () => {
    if (sequence.stopped) return;
    sequence.timers.forEach(timer => window.clearTimeout?.(timer));
    sequence.timers = [];
    gates.forEach(gate => gate.classList.remove("is-complete"));
    for (const { gate, completeAtSeconds } of randomizeVerificationGates(consolePanel)) {
      const timer = window.setTimeout?.(() => {
        if (!sequence.stopped && !document.hidden) gate.classList.add("is-complete");
      }, completeAtSeconds * 1000);
      if (timer !== undefined) sequence.timers.push(timer);
    }
    const nextCycle = window.setTimeout?.(runCycle, 16000);
    if (nextCycle !== undefined) sequence.timers.push(nextCycle);
  };
  verificationSequenceTimers.set(consolePanel, sequence);
  runCycle();
}

function stopVerificationGateSequence(consolePanel) {
  const sequence = verificationSequenceTimers.get(consolePanel);
  if (sequence) {
    sequence.stopped = true;
    sequence.timers.forEach(timer => window.clearTimeout?.(timer));
  }
  verificationSequenceTimers.delete(consolePanel);
  const gates = [...(consolePanel.querySelectorAll?.(".verification-checks li") || [])];
  gates.forEach(gate => gate.classList.remove("is-complete"));
}

function initializeArchitectureConnectors() {
  const stage = informationElements.architectureStage;
  const links = [...(stage?.querySelectorAll?.("[data-connector-from][data-connector-to]") || [])];
  if (links.length === 0 || typeof window.requestAnimationFrame !== "function") return;

  const bindings = links.map(link => ({
    link,
    source: document.getElementById(link.dataset.connectorFrom),
    target: document.getElementById(link.dataset.connectorTo),
    container: link.parentElement
  })).filter(binding => binding.source && binding.target && binding.container);
  if (bindings.length === 0) return;

  const positionConnectors = () => {
    const nodeRects = new Map();
    const containerRects = new Map();
    const rectFor = (element, cache) => {
      if (!cache.has(element)) cache.set(element, element.getBoundingClientRect());
      return cache.get(element);
    };
    const measurements = bindings.map(binding => ({
      binding,
      geometry: architectureConnectorGeometry(
        rectFor(binding.source, nodeRects),
        rectFor(binding.target, nodeRects),
        rectFor(binding.container, containerRects)
      )
    }));
    for (const { binding, geometry } of measurements) {
      binding.link.style.setProperty("--architecture-link-offset", `${geometry.offset}px`);
      binding.link.style.setProperty("--architecture-link-length", `${geometry.length}px`);
    }
  };

  let visible = typeof window.IntersectionObserver !== "function";
  let frameId = 0;
  let disposed = false;
  let observer;
  let resizeObserver;
  const schedule = () => {
    if (disposed || !visible || document.hidden || frameId) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      if (!disposed && visible && !document.hidden) positionConnectors();
    });
  };

  if (typeof window.IntersectionObserver === "function") {
    observer = new window.IntersectionObserver(entries => {
      visible = entries.some(entry => entry.target === stage && entry.isIntersecting);
      if (visible) schedule();
    }, { rootMargin: "80px 0px" });
    observer.observe(stage);
  }

  if (typeof window.ResizeObserver === "function") {
    resizeObserver = new window.ResizeObserver(schedule);
    const observed = new Set([stage]);
    bindings.forEach(({ source, target, container }) => {
      observed.add(source);
      observed.add(target);
      observed.add(container);
    });
    observed.forEach(element => resizeObserver.observe(element));
  }

  window.addEventListener?.("resize", schedule, { passive: true });
  document.addEventListener?.("visibilitychange", () => {
    if (!document.hidden) schedule();
  });
  document.fonts?.ready?.then?.(schedule);
  window.addEventListener?.("pagehide", event => {
    if (frameId) window.cancelAnimationFrame?.(frameId);
    frameId = 0;
    if (!event.persisted) {
      disposed = true;
      observer?.disconnect();
      resizeObserver?.disconnect();
    }
  });
  window.addEventListener?.("pageshow", schedule);
  positionConnectors();
}

function architectureConnectorGeometry(sourceRect, targetRect, containerRect) {
  const offset = sourceRect.bottom - containerRect.top;
  const length = Math.max(0, targetRect.top - sourceRect.bottom);
  return {
    offset: Math.round(offset * 100) / 100,
    length: Math.round(length * 100) / 100
  };
}

function initializePanelBorderTraces() {
  const panels = [...document.querySelectorAll(".architecture-node, .pipeline-card, .provider-control")];
  if (panels.length === 0) return;
  const namespace = "http://www.w3.org/2000/svg";
  const traces = new Map();
  const dirty = new Set(panels);
  let pending = null;
  let disposed = false;
  for (const panel of panels) {
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("class", "panel-border-trace");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const paths = [1, -1].map(() => {
      const path = document.createElementNS(namespace, "path");
      path.setAttribute("pathLength", "1");
      svg.appendChild(path);
      return path;
    });
    panel.appendChild(svg);
    panel.classList.add("has-border-trace");
    traces.set(panel, { svg, paths, size: "" });
  }
  const update = () => {
    pending = null;
    if (disposed) return;
    // Read all geometry before writing any SVG attributes.
    const measurements = [...dirty].map(panel => {
      const width = panel.clientWidth + 4;
      const height = panel.clientHeight + 4;
      const radius = Math.max(1, Math.min(
        parseFloat(window.getComputedStyle(panel).borderTopLeftRadius) + 1 || 1,
        width / 2 - 1, height / 2 - 1));
      return { trace: traces.get(panel), width, height, radius };
    });
    dirty.clear();
    for (const { trace, width, height, radius } of measurements) {
      const size = `${width}|${height}|${radius}`;
      if (trace.size === size || width <= 4 || height <= 4) continue;
      trace.size = size;
      trace.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      trace.paths.forEach((path, index) => path.setAttribute("d",
        panelBorderPath(width, height, radius, index === 0)));
    }
  };
  const schedule = () => {
    if (disposed || pending !== null) return;
    if (typeof window.requestAnimationFrame === "function") pending = window.requestAnimationFrame(update);
    else update();
  };
  let observer;
  if (typeof window.ResizeObserver === "function") {
    observer = new window.ResizeObserver(entries => {
      entries.forEach(entry => dirty.add(entry.target));
      schedule();
    });
    panels.forEach(panel => observer.observe(panel));
  } else {
    window.addEventListener?.("resize", () => {
      panels.forEach(panel => dirty.add(panel));
      schedule();
    }, { passive: true });
  }
  window.addEventListener?.("pagehide", event => {
    if (event.persisted) return;
    disposed = true;
    if (pending !== null) window.cancelAnimationFrame?.(pending);
    observer?.disconnect();
    dirty.clear();
  });
  schedule();
}

function panelBorderPath(width, height, radius, clockwise) {
  const edge = clockwise ? width - 1 : 1;
  const turn = clockwise ? width - radius - 1 : radius + 1;
  const sweep = clockwise ? 1 : 0;
  return `M ${width / 2} 1 H ${turn} A ${radius} ${radius} 0 0 ${sweep} ${edge} ${radius + 1}`
    + ` V ${height - radius - 1} A ${radius} ${radius} 0 0 ${sweep} ${turn} ${height - 1} H ${width / 2}`;
}
function initializeSystemHero() {
  const hero = informationElements.systemHero;
  if (!hero) return;
  let pending = false;
  const updateSignalPath = () => {
    if (pending) return;
    pending = true;
    const update = () => { pending = false; positionSystemHeroSignal(hero); };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(update);
    else update();
  };
  document.fonts?.ready?.then(updateSignalPath);
  document.fonts?.addEventListener?.("loadingdone", updateSignalPath);
  window.addEventListener?.("resize", updateSignalPath);
  if (typeof window.IntersectionObserver !== "function") {
    updateSignalPath();
    hero.classList.add("is-visible");
    return;
  }

  const observer = new window.IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target !== hero) continue;
      if (entry.isIntersecting) updateSignalPath();
      hero.classList.toggle("is-visible", entry.isIntersecting);
    }
  }, { threshold: 0.18 });
  observer.observe(hero);
}

function positionSystemHeroSignal(hero) {
  const { systemHeroTitle: title, systemHeroSource: source, systemHeroTarget: target,
    systemHeroSignal: signal } = informationElements;
  if (!title || !source || !target || !signal
      || typeof title.getBoundingClientRect !== "function"
      || typeof source.getClientRects !== "function"
      || typeof target.getClientRects !== "function"
      || typeof hero.style?.setProperty !== "function") return;

  const sourceRects = [...source.getClientRects()];
  const targetRects = [...target.getClientRects()];
  if (sourceRects.length === 0 || targetRects.length === 0) return;

  const titleRect = title.getBoundingClientRect();
  const dotSize = signal.getBoundingClientRect?.().width || 9;
  const targetWords = [...(target.querySelectorAll?.(".system-hero-highlight-word") || [])];
  const targetWordRects = targetWords.map(word => word.getBoundingClientRect());
  const targetLineRects = targetWordRects.reduce((lines, rect) => {
    const line = lines.find(candidate => Math.abs(candidate.top - rect.top) < 1);
    if (line) {
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    }
    return lines;
  }, []);
  const targetLines = [...(title.querySelectorAll?.(".system-hero-highlight-line") || [])];
  while (targetLines.length < targetLineRects.length) {
    const line = document.createElement("span");
    line.className = "system-hero-highlight-line";
    line.setAttribute("aria-hidden", "true");
    title.appendChild(line);
    targetLines.push(line);
  }
  targetLines.forEach((line, index) => {
    const rect = targetLineRects[index];
    line.hidden = !rect;
    if (!rect) return;
    line.style.setProperty("--system-highlight-left", `${rect.left - titleRect.left}px`);
    line.style.setProperty("--system-highlight-top", `${rect.bottom - titleRect.top}px`);
    line.style.setProperty("--system-highlight-width", `${rect.right - rect.left}px`);
  });

  const sourceStart = sourceRects[0];
  const sourceEnd = sourceRects.at(-1);
  const targetStart = targetRects[0];
  const targetEnd = targetRects[0];
  hero.style.setProperty("--system-signal-source-start-x", `${sourceStart.left - titleRect.left}px`);
  hero.style.setProperty("--system-signal-source-start-y", `${sourceStart.bottom - titleRect.top - dotSize}px`);
  hero.style.setProperty("--system-signal-source-end-x", `${sourceEnd.right - titleRect.left}px`);
  hero.style.setProperty("--system-signal-source-end-y", `${sourceEnd.bottom - titleRect.top - dotSize}px`);
  hero.style.setProperty("--system-signal-target-x", `${targetStart.left - titleRect.left - dotSize}px`);
  hero.style.setProperty("--system-signal-target-y", `${targetStart.bottom - titleRect.top - dotSize}px`);
  hero.style.setProperty("--system-signal-target-end-x", `${targetEnd.right - titleRect.left - dotSize}px`);
  hero.style.setProperty("--system-signal-target-end-y", `${targetEnd.bottom - titleRect.top - dotSize}px`);
  hero.style.setProperty("--system-signal-start-x", `${sourceEnd.right - titleRect.left - dotSize / 2}px`);
  hero.style.setProperty("--system-signal-start-y", `${sourceEnd.bottom - titleRect.top - dotSize * 0.55}px`);
  hero.style.setProperty("--system-signal-end-x", `${targetStart.left - titleRect.left - dotSize / 2}px`);
  hero.style.setProperty("--system-signal-end-y", `${targetStart.bottom - titleRect.top - dotSize * 0.55}px`);
  hero.classList.add("has-signal-path");
}


function initializeArchitectureHighlights() {
  const stage = informationElements.architectureStage;
  if (!stage || typeof document.querySelectorAll !== "function") return;

  const items = [...document.querySelectorAll("[data-architecture-flow]")];
  const sources = items.filter(item => item.matches?.("[tabindex]"));
  const showPanel = source => {
    stage.classList.add("has-active-flow");
    for (const item of items) {
      const containsSource = typeof item.contains === "function" && item.contains(source);
      item.classList.toggle("is-related", item === source || containsSource);
    }
  };

  const clearFlow = () => {
    stage.classList.remove("has-active-flow");
    for (const item of items) item.classList.remove("is-related");
  };

  for (const source of sources) {
    source.addEventListener("pointerenter", () => showPanel(source));
    source.addEventListener("pointerleave", event => {
      const nextPanel = event?.relatedTarget?.closest?.("[data-architecture-flow][tabindex]");
      if (nextPanel && (typeof stage.contains !== "function" || stage.contains(nextPanel))) showPanel(nextPanel);
      else clearFlow();
    });
    source.addEventListener("focus", () => showPanel(source));
    source.addEventListener("blur", clearFlow);
  }
}

function informationRuntime(pathname) {
  const experimental = pathname === "/dashboard-experimental"
    || String(pathname || "").startsWith("/dashboard-experimental/");
  return { apiBase: experimental ? "/dashboard-experimental-api" : "/dashboard-api" };
}

function initializeInformationTheme() {
  window.BrowserTheme.initialize({
    toggle: informationElements.themeToggle,
    icon: informationElements.themeIcon,
    iconPrefix: "information-icons.svg",
    recheckStoredPreference: true
  });
}

async function loadOperationalStatus(source = "manual") {
  if (informationElements.statusRefresh.disabled) return;
  const runtime = informationRuntime(window.location.pathname);
  informationElements.statusRefresh.disabled = true;
  informationElements.systemOverview.classList.add("is-refreshing");
  informationElements.systemOverview.setAttribute("aria-busy", "true");
  let succeeded = false;
  try {
    startStatusSyncPulse(source);
    const response = await window.fetch(`${runtime.apiBase}/system/operational-status`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SYSTEM_STATUS_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`status endpoint returned HTTP ${response.status}`);
    renderOperationalStatus(await response.json());
    succeeded = true;
  } catch (error) {
    renderStatusUnavailable(error);
  } finally {
    informationElements.statusRefresh.disabled = false;
    informationElements.systemOverview.classList.remove("is-refreshing");
    informationElements.systemOverview.setAttribute("aria-busy", "false");
    finishStatusSyncPulse(succeeded);
  }
}

function startStatusSyncPulse(source) {
  statusPulseEpoch++;
  window.clearTimeout?.(statusPulseTimer);
  statusPulseTimer = undefined;
  statusPulseCleanupPending = false;
  informationElements.systemOverview.classList.remove("is-sync-complete", "is-sync-failed");
  informationElements.systemOverview.classList.add("is-heartbeat");
  try {
    for (const animation of informationElements.systemOverview.getAnimations?.({subtree: true}) || []) {
      if (STATUS_HEARTBEAT_ANIMATIONS.has(animation.animationName)) animation.currentTime = 0;
    }
  } catch { /* Decorative replay must not prevent the retained-data health read. */ }
  informationElements.statusSyncCalloutText.textContent = source === "automatic"
    ? "Dashboard sync · checking health…"
    : source === "manual" ? "Refreshing dashboard health…" : "Reading dashboard health…";
}

function finishStatusSyncPulse(succeeded) {
  statusPulseEpoch++;
  window.clearTimeout?.(statusPulseTimer);
  statusPulseTimer = undefined;
  informationElements.systemOverview.classList.add(succeeded ? "is-sync-complete" : "is-sync-failed");
  informationElements.statusSyncCalloutText.textContent = succeeded
    ? "Dashboard health synced" : "Health sync could not connect";
  statusPulseCleanupPending = true;
  updateStatusPulseVisibility();
}

function updateStatusPulseVisibility() {
  const panel = informationElements.systemOverview;
  if (!panel) return;
  const visible = !document.hidden && !informationPageHidden && !panel.classList.contains("motion-paused");
  if (!visible) {
    statusPulseEpoch++;
    window.clearTimeout?.(statusPulseTimer);
    statusPulseTimer = undefined;
    return;
  }
  if (!statusPulseCleanupPending || statusPulseTimer !== undefined) return;
  const epoch = statusPulseEpoch;
  statusPulseTimer = window.setTimeout?.(() => {
    if (epoch !== statusPulseEpoch) return;
    statusPulseTimer = undefined;
    if (document.hidden || informationPageHidden || panel.classList.contains("motion-paused")) return;
    informationElements.systemOverview.classList.remove("is-heartbeat", "is-sync-complete", "is-sync-failed");
    statusPulseCleanupPending = false;
  }, 3000);
}

function renderOperationalStatus(status) {
  const overall = normalizedStatus(status?.status);
  informationElements.systemOverview.dataset.status = overall;
  informationElements.systemState.textContent = statusLabel(overall);
  informationElements.systemStatusTitle.textContent = overall === "HEALTHY"
    ? "Traffic data is updating normally"
    : overall === "DEGRADED" ? "Some traffic information may be delayed"
      : "Current traffic updates are unavailable";
  informationElements.systemSummary.textContent = status?.summary || "The service returned no overall explanation.";
  informationElements.systemCheckedAt.textContent = status?.checkedAt
    ? `Checked ${formatStatusTime(status.checkedAt)}` : "Check time was not provided.";

  const checks = Array.isArray(status?.checks) ? status.checks : [];
  renderOperationalSnapshot(checks);
  informationElements.operationalChecks.replaceChildren();
  if (checks.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No component checks were returned. Refresh the status or inspect the operational-status endpoint.";
    informationElements.operationalChecks.appendChild(empty);
    return;
  }
  for (const check of checks) {
    informationElements.operationalChecks.appendChild(buildOperationalCheck(check));
  }
}

function renderOperationalSnapshot(checks) {
  const healthyCount = checks.filter(check => normalizedStatus(check?.status) === "HEALTHY").length;
  const attentionCount = checks.length - healthyCount;
  informationElements.statusCheckCount.textContent = checks.length === 0
    ? "No checks" : `${healthyCount} / ${checks.length} clear`;
  informationElements.statusDetailCount.textContent = checks.length === 0
    ? "No checks returned"
    : attentionCount === 0 ? `${checks.length} checks clear`
      : `${attentionCount} ${attentionCount === 1 ? "check needs" : "checks need"} attention`;
  informationElements.statusSignalGrid.replaceChildren();

  for (const check of checks) {
    const signal = document.createElement("div");
    signal.className = "status-signal-item";
    signal.dataset.status = normalizedStatus(check?.status);

    const label = document.createElement("strong");
    label.textContent = compactComponentLabel(check?.component);
    const detail = document.createElement("small");
    detail.textContent = checkSnapshotDetail(check);
    signal.append(label, detail);
    informationElements.statusSignalGrid.appendChild(signal);
  }
}

function compactComponentLabel(component) {
  const [type, name] = String(component || "unknown").split(":", 2);
  if (type === "flow") return `${corridorLabel(name)} flow`;
  if (type === "incidents") return "CDOT reports";
  if (type === "provider") return "TomTom source";
  if (type === "database") return "Database";
  return componentLabel(component);
}

function checkSnapshotDetail(check) {
  if (Number.isFinite(check?.ageMinutes)) return `${formatCheckAge(check.ageMinutes)} old`;
  if (check?.observedAt) return `Seen ${formatStatusTime(check.observedAt)}`;
  return normalizedStatus(check?.status) === "HEALTHY" ? "Within threshold" : "Needs attention";
}

function formatCheckAge(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`;
  return `${Math.round(minutes / 1440)} days`;
}

function buildOperationalCheck(check) {
  const status = normalizedStatus(check?.status);
  const card = document.createElement("article");
  card.className = "operational-check";
  card.dataset.status = status;

  const heading = document.createElement("div");
  heading.className = "check-heading";
  const title = document.createElement("h3");
  title.textContent = componentLabel(check?.component);
  const state = document.createElement("span");
  state.className = "check-state";
  state.textContent = statusLabel(status);
  heading.append(title, state);

  const message = document.createElement("p");
  message.className = "check-message";
  message.textContent = check?.message || "This check did not provide an explanation.";
  card.append(heading, message);

  const meta = checkMetadata(check);
  if (meta) card.appendChild(meta);
  if (status !== "HEALTHY") card.appendChild(checkAction(check?.suggestedAction));
  return card;
}

function checkMetadata(check) {
  const values = [];
  if (check?.code) values.push(String(check.code).replaceAll("_", " ").toLowerCase());
  if (Number.isFinite(check?.ageMinutes)) values.push(`${check.ageMinutes} min old`);
  if (Number.isFinite(check?.thresholdMinutes)) values.push(`${check.thresholdMinutes} min threshold`);
  if (values.length === 0 && check?.observedAt) values.push(`observed ${formatStatusTime(check.observedAt)}`);
  if (values.length === 0) return null;
  const meta = document.createElement("p");
  meta.className = "check-meta";
  meta.textContent = values.join(" · ");
  return meta;
}

function checkAction(suggestedAction) {
  const action = document.createElement("p");
  action.className = "check-action";
  const label = document.createElement("strong");
  label.textContent = "Next action: ";
  action.append(label, document.createTextNode(suggestedAction
    || "Review this component’s current ingest logs; no specific recovery action was returned."));
  return action;
}

function renderStatusUnavailable(error) {
  informationElements.systemOverview.dataset.status = "UNAVAILABLE";
  informationElements.systemState.textContent = "Status unavailable";
  informationElements.systemStatusTitle.textContent = "The operational status could not be loaded";
  informationElements.systemSummary.textContent = "This page could not reach the status endpoint. That connection failure does not by itself mean traffic ingestion is down.";
  informationElements.systemCheckedAt.textContent = "Refresh this page or check the operational-status endpoint directly.";
  informationElements.statusCheckCount.textContent = "Connection failed";
  informationElements.statusDetailCount.textContent = "Status endpoint unavailable";
  informationElements.statusSignalGrid.replaceChildren();
  const unavailable = document.createElement("span");
  unavailable.className = "status-signal-placeholder";
  unavailable.textContent = "No live checks received";
  informationElements.statusSignalGrid.appendChild(unavailable);
  informationElements.operationalChecks.replaceChildren();
  const detail = document.createElement("p");
  detail.textContent = error?.message
    ? `Status request failed: ${error.message}.` : "The status request failed without an error message.";
  informationElements.operationalChecks.appendChild(detail);
}

function normalizedStatus(value) {
  const status = String(value || "").toUpperCase();
  return ["HEALTHY", "DEGRADED", "OUT_OF_SERVICE"].includes(status) ? status : "DEGRADED";
}

function statusLabel(status) {
  if (status === "OUT_OF_SERVICE") return "Out of service";
  return status === "HEALTHY" ? "Healthy" : "Degraded";
}

function componentLabel(component) {
  const [type, name] = String(component || "unknown").split(":", 2);
  if (type === "flow") return `${corridorLabel(name)} traffic flow`;
  if (type === "incidents") return "CDOT incidents";
  if (type === "provider") return "TomTom provider";
  if (type === "database") return "Traffic database";
  return String(component || "Unknown component").replaceAll("_", " ");
}

function corridorLabel(value) {
  const corridor = String(value || "Corridor");
  return corridor.replace(/^I-?(\d+)$/i, "I-$1");
}

function formatStatusTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "at an unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

initializeInformationPage();
