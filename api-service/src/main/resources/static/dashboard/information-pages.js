const informationElements = {
  apiExplorerForm: document.getElementById("apiExplorerForm"),
  apiPreset: document.getElementById("apiPreset"),
  apiCorridor: document.getElementById("apiCorridor"),
  apiRequestPath: document.getElementById("apiRequestPath"),
  apiRun: document.getElementById("apiRun"),
  apiCopy: document.getElementById("apiCopy"),
  apiResponseState: document.getElementById("apiResponseState"),
  apiResponseMeta: document.getElementById("apiResponseMeta"),
  apiResponseBody: document.getElementById("apiResponseBody"),
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  systemHero: document.getElementById("systemIntro"),
  systemHeroTitle: document.getElementById("systemHeroTitle"),
  systemHeroSource: document.getElementById("systemHeroSource"),
  systemHeroTarget: document.getElementById("systemHeroTarget"),
  systemHeroSignal: document.getElementById("systemHeroSignal"),
  systemPageRoute: document.getElementById("systemPageRoute"),
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
  statusRefresh: document.getElementById("statusRefresh"),
  i25DailyFastest: document.getElementById("i25DailyFastest"),
  i25DailySlowest: document.getElementById("i25DailySlowest"),
  i70DailyFastest: document.getElementById("i70DailyFastest"),
  i70DailySlowest: document.getElementById("i70DailySlowest"),
  dailyRangeStatus: document.getElementById("dailyRangeStatus")
};

const SYSTEM_STATUS_REFRESH_MS = 60_000;
const SYSTEM_STATUS_TIMEOUT_MS = 8_000;
let statusPulseTimer;

function initializeInformationPage() {
  initializeApiExplorer();
  initializeInformationTheme();
  initializePanelBorderTraces();
  initializeGridLights();
  initializeHistoryTrackLights();
  initializeMotionBudget();
  initializeSystemHero();
  initializeSystemPageRoute();
  initializeArchitectureHighlights();
  initializeArchitectureConnectors();
  initializeVerificationConsole();
  void initializeDataDailyRange();
  if (!informationElements.systemOverview) return;
  informationElements.statusRefresh?.addEventListener("click", () => void loadOperationalStatus());
  void loadOperationalStatus("initial");
  window.setInterval?.(() => {
    if (!document.hidden) void loadOperationalStatus("automatic");
  }, SYSTEM_STATUS_REFRESH_MS);
}

const DATA_DAILY_TIMEOUT_MS = 8_000;
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
  const updateVisibility = () => root?.classList?.toggle("motion-suspended", Boolean(document.hidden));
  updateVisibility();
  document.addEventListener?.("visibilitychange", updateVisibility);
  if (scopes.length === 0 || typeof window.IntersectionObserver !== "function") return;
  scopes.forEach(scope => scope.classList.add("motion-paused"));
  const observer = new window.IntersectionObserver(entries => {
    entries.forEach(entry => entry.target.classList.toggle("motion-paused", !entry.isIntersecting));
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
const API_EXPLORER_TIMEOUT_MS = 8_000;
const API_EXAMPLES = Object.freeze({
 latest: corridor => `/traffic/latest?corridor=${corridor}&preferUsable=true`,
 summary: corridor => `/traffic/summary?corridor=${corridor}`,
 history: corridor => `/traffic/history?corridor=${corridor}&windowMinutes=120&limit=12&includeIncidents=false`,
 incidents: corridor => `/traffic/map/incidents/recent?corridor=${corridor}&windowMinutes=1440&limit=12`,
 status: () => "/system/operational-status"
});

function initializeApiExplorer() {
  const form = informationElements.apiExplorerForm;
  if (!form) return;

  const update = () => {
    const preset = informationElements.apiPreset?.value || "latest";
    const needsCorridor = preset !== "status";
    if (informationElements.apiCorridor) informationElements.apiCorridor.disabled = !needsCorridor;
    informationElements.apiRequestPath.textContent = apiExplorerPath();
  };

  informationElements.apiPreset?.addEventListener("change", update);
  informationElements.apiCorridor?.addEventListener("change", update);
  informationElements.apiCopy?.addEventListener("click", () => void copyApiExplorerPath());
  informationElements.apiRun?.addEventListener("click", event => {
    event.preventDefault();
    void runApiExplorerRequest();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    void runApiExplorerRequest();
  });
  update();
}

function apiExplorerPath() {
  const preset = informationElements.apiPreset?.value || "latest";
  const corridor = informationElements.apiCorridor?.value === "I70" ? "I70" : "I25";
  const template = Object.hasOwn(API_EXAMPLES, preset) ? API_EXAMPLES[preset] : API_EXAMPLES.latest;
  const runtime = informationRuntime(window.location.pathname);
  return `${runtime.apiBase}${template(corridor)}`;
}

async function copyApiExplorerPath() {
  const buttonLabel = informationElements.apiCopy?.querySelector?.("span");
  try {
    if (!window.navigator?.clipboard?.writeText) throw new Error("Clipboard access unavailable");
    await window.navigator.clipboard.writeText(apiExplorerPath());
    if (buttonLabel) buttonLabel.textContent = "Copied";
  } catch {
    if (buttonLabel) buttonLabel.textContent = "Copy unavailable";
  } finally {
    window.setTimeout?.(() => {
      if (buttonLabel) buttonLabel.textContent = "Copy path";
    }, 1600);
  }
}

async function runApiExplorerRequest() {
  const responsePanel = informationElements.apiResponseBody?.closest?.(".api-response");
  if (!responsePanel || informationElements.apiRun?.disabled) return;
  const path = apiExplorerPath();
  informationElements.apiRun.disabled = true;
  responsePanel.classList.remove("is-success", "is-error");
  responsePanel.classList.add("is-loading");
  informationElements.apiResponseState.textContent = "Loading";
  informationElements.apiResponseMeta.textContent = path;
  informationElements.apiResponseBody.textContent = "Reading retained data…";

  try {
    const startedAt = Date.now();
    const response = await window.fetch(path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(API_EXPLORER_TIMEOUT_MS) });
    const contentType = response.headers?.get?.("content-type") || "";
    const payload = contentType.includes("json") ? await response.json() : await response.text();
    if (!response.ok) throw new ApiExplorerError(response.status, payload, response.headers?.get?.("retry-after"));
    const elapsedMs = Date.now() - startedAt;
    responsePanel.classList.add("is-success");
    informationElements.apiResponseState.textContent = `${response.status} OK`;
    const remaining = response.headers?.get?.("x-ratelimit-remaining");
    const ceiling = response.headers?.get?.("x-ratelimit-limit");
    informationElements.apiResponseMeta.textContent = `${elapsedMs} ms${remaining !== null && remaining !== undefined ? ` · ${remaining}${ceiling ? ` / ${ceiling}` : ""} reads remain this minute` : ""}`;
    informationElements.apiResponseBody.textContent = apiResponseText(payload);
  } catch (error) {
    responsePanel.classList.add("is-error");
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    informationElements.apiResponseState.textContent = error?.status ? `HTTP ${error.status}` : timedOut ? "Timed out" : "Unavailable";
    informationElements.apiResponseMeta.textContent = error?.status === 429
      ? `Rate limit reached. Honor Retry-After${error.retryAfter ? `: ${error.retryAfter}` : ""} before running again.`
      : error?.status ? "Check the response and request, then run again."
      : timedOut ? "The eight-second read timed out. Run the example again to retry."
      : "The retained-data request could not be completed. Run again to retry.";
    informationElements.apiResponseBody.textContent = apiResponseText(error?.payload || {
      message: error?.message || "The API request failed without an explanation."
    });
  } finally {
    responsePanel.classList.remove("is-loading");
    informationElements.apiRun.disabled = false;
  }
}

function apiResponseText(payload) {
  const formatted = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) ?? "";
  const limit = 18_000;
  return formatted.length > limit ? `${formatted.slice(0, limit)}\n\n… response shortened for this preview` : formatted;
}

class ApiExplorerError extends Error {
  constructor(status, payload, retryAfter) {
    super(`API request returned HTTP ${status}`);
    this.status = status;
    this.payload = payload;
    this.retryAfter = retryAfter;
  }
}

const DATA_CORRIDORS = Object.freeze([
  { id: "I25", label: "I-25", distanceMiles: 63, fastest: "i25DailyFastest", slowest: "i25DailySlowest" },
  { id: "I70", label: "I-70", distanceMiles: 68, fastest: "i70DailyFastest", slowest: "i70DailySlowest" }
]);

async function initializeDataDailyRange() {
  if (!informationElements.dailyRangeStatus) return;
  const runtime = informationRuntime(window.location.pathname);
  const results = await Promise.allSettled(DATA_CORRIDORS.map(async corridor => {
    const options = { headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(DATA_DAILY_TIMEOUT_MS) };
    const summaryResponse = await window.fetch(`${runtime.apiBase}/traffic/summary?corridor=${corridor.id}&preferUsable=true`, options);
    if (!summaryResponse.ok) throw new Error("The retained-data endpoint could not be reached.");
    const summary = await summaryResponse.json();
    const observedAt = summary?.latest?.polledAt;
    if (!observedAt || !Number.isFinite(Date.parse(observedAt))) {
      throw new Error("No valid retained observation time is available.");
    }
    const trendResponse = await window.fetch(`${runtime.apiBase}/traffic/zones/trends?corridor=${corridor.id}&windowHours=24&asOf=${encodeURIComponent(observedAt)}`, options);
    if (!trendResponse.ok) throw new Error("The retained-data endpoint could not be reached.");
    const trend = await trendResponse.json();
    return { observedAt, range: retainedDailyTravelRange(trend?.points, corridor.distanceMiles, observedAt) };
  }));
  const labels = results.map((result, index) => {
    const corridor = DATA_CORRIDORS[index];
    const fastestNode = informationElements[corridor.fastest];
    const slowestNode = informationElements[corridor.slowest];
    if (result.status === "fulfilled" && Number.isFinite(result.value.range.fastest)) {
      fastestNode.textContent = formatTravelMinutes(result.value.range.fastest);
      slowestNode.textContent = formatTravelMinutes(result.value.range.slowest);
      return `${corridor.label} · ${formatDenverDay(result.value.observedAt)}`;
    }
    fastestNode.textContent = "Unavailable";
    slowestNode.textContent = "Unavailable";
    if (result.status === "fulfilled") return `${corridor.label} · no complete retained estimates`;
    if (result.reason?.name === "TimeoutError" || result.reason?.name === "AbortError") {
      return `${corridor.label} · request timed out`;
    }
    return `${corridor.label} · retained data could not be loaded`;
  });
  const incomplete = results.some(result => result.status === "rejected"
    || !Number.isFinite(result.value.range.fastest));
  informationElements.dailyRangeStatus.textContent = labels.join(" / ")
    + (incomplete ? ". Refresh this page to retry." : " · latest retained days");
}

function numericDataValue(value) {
  return typeof value === "number" || (typeof value === "string" && value.trim() !== "")
    ? Number(value) : Number.NaN;
}

function retainedDailyTravelRange(points, distanceMiles, observedAt) {
  const cutoff = Date.parse(observedAt);
  const activeDay = denverDayKey(observedAt);
  const buckets = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const timestamp = Date.parse(point?.bucketStart || point?.polledAt);
    if (!Number.isFinite(cutoff) || !Number.isFinite(timestamp) || timestamp > cutoff || denverDayKey(timestamp) !== activeDay) continue;
    if (!buckets.has(timestamp)) buckets.set(timestamp, []);
    buckets.get(timestamp).push(point);
  }
  const minutes = [...buckets.values()]
    .map(bucket => estimateZoneTravelMinutes(bucket, distanceMiles))
    .filter(Number.isFinite);
  return minutes.length > 0
    ? { fastest: Math.min(...minutes), slowest: Math.max(...minutes) }
    : { fastest: Number.NaN, slowest: Number.NaN };
}

function estimateZoneTravelMinutes(points, distanceMiles) {
  if (!Number.isFinite(distanceMiles) || distanceMiles <= 0) return Number.NaN;
  const zones = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const start = numericDataValue(point?.startMileMarker);
    const end = numericDataValue(point?.endMileMarker);
    const speed = numericDataValue(point?.avgCurrentSpeed);
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower
        || !Number.isFinite(speed) || speed <= 0) continue;
    zones.set(String(point?.zoneKey || `${lower}|${upper}`), { lower, upper, speed });
  }
  const segments = [...zones.values()].sort((left, right) => left.lower - right.lower);
  if (segments.length === 0) return Number.NaN;
  const tolerance = 0.02;
  const coveredMiles = segments.reduce((total, segment) => total + segment.upper - segment.lower, 0);
  const span = segments.at(-1).upper - segments[0].lower;
  const contiguous = segments.every((segment, index) => index === 0
    || Math.abs(segment.lower - segments[index - 1].upper) <= tolerance);
  if (!contiguous || Math.abs(coveredMiles - distanceMiles) > tolerance
      || Math.abs(span - distanceMiles) > tolerance) return Number.NaN;
  return segments.reduce((total, segment) => total + ((segment.upper - segment.lower) / segment.speed) * 60, 0);
}

function denverDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function formatDenverDay(value) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric"
  }).format(new Date(value));
}

function formatTravelMinutes(value) {
  return Number.isFinite(value) ? `${Math.round(value)} min` : "Unavailable";
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

function initializeSystemPageRoute() {
  const route = informationElements.systemPageRoute;
  const links = [...(route?.querySelectorAll?.('a[href^="#"]') || [])];
  if (links.length === 0 || typeof window.addEventListener !== "function") return;

  const stops = links.map(link => ({
    link,
    target: document.getElementById(link.getAttribute("href").slice(1))
  })).filter(stop => stop.target);
  if (stops.length === 0) return;

  const updateRoute = () => {
    route.classList.toggle("is-revealed", window.scrollY > 64);
    const activationLine = Math.min(160, Math.max(96, window.innerHeight * 0.2));
    let activeStop = stops[0];
    for (const stop of stops) {
      if (stop.target.getBoundingClientRect().top <= activationLine) activeStop = stop;
    }
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) {
      activeStop = stops.at(-1);
    }

    for (const stop of stops) {
      const active = stop === activeStop;
      stop.link.classList.toggle("is-active", active);
      if (active) stop.link.setAttribute("aria-current", "location");
      else stop.link.removeAttribute("aria-current");
    }

    const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollRange > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollRange)) : 0;
    route.style.setProperty("--system-route-progress", `${progress * 83.334}%`);
  };

  let updateScheduled = false;
  const scheduleUpdate = () => {
    if (updateScheduled) return;
    updateScheduled = true;
    const render = () => {
      updateScheduled = false;
      updateRoute();
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(render);
    else render();
  };

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  updateRoute();
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
  let storedTheme;
  try { storedTheme = window.localStorage.getItem("ctt-dashboard-theme"); } catch { /* Storage can be disabled. */ }
  const deviceTheme = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const followsDeviceTheme = storedTheme !== "dark" && storedTheme !== "light";
  applyInformationTheme(followsDeviceTheme && deviceTheme?.matches ? "dark" : storedTheme === "dark" ? "dark" : "light");

  deviceTheme?.addEventListener?.("change", event => {
    let savedTheme;
    try { savedTheme = window.localStorage.getItem("ctt-dashboard-theme"); } catch { /* Keep the current theme. */ }
    if (savedTheme !== "dark" && savedTheme !== "light") {
      applyInformationTheme(event.matches ? "dark" : "light");
    }
  });

  informationElements.themeToggle?.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { window.localStorage.setItem("ctt-dashboard-theme", nextTheme); } catch { /* Theme still works for this visit. */ }
    applyInformationTheme(nextTheme);
  });
}

function applyInformationTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const darkMode = theme === "dark";
  informationElements.themeToggle?.setAttribute("aria-pressed", String(darkMode));
  informationElements.themeToggle?.setAttribute("aria-label", darkMode ? "Switch to light mode" : "Switch to dark mode");
  informationElements.themeIcon?.setAttribute("href", darkMode ? "#icon-sun" : "#icon-moon");
}

async function loadOperationalStatus(source = "manual") {
  if (informationElements.statusRefresh.disabled) return;
  const runtime = informationRuntime(window.location.pathname);
  informationElements.statusRefresh.disabled = true;
  informationElements.systemOverview.classList.add("is-refreshing");
  informationElements.systemOverview.setAttribute("aria-busy", "true");
  startStatusSyncPulse(source);
  let succeeded = false;
  try {
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
  window.clearTimeout?.(statusPulseTimer);
  informationElements.systemOverview.classList.remove("is-sync-complete", "is-sync-failed");
  informationElements.systemOverview.classList.add("is-heartbeat");
  informationElements.statusSyncCalloutText.textContent = source === "automatic"
    ? "Dashboard sync · checking health…"
    : source === "manual" ? "Refreshing dashboard health…" : "Reading dashboard health…";
}

function finishStatusSyncPulse(succeeded) {
  window.clearTimeout?.(statusPulseTimer);
  informationElements.systemOverview.classList.add(succeeded ? "is-sync-complete" : "is-sync-failed");
  informationElements.statusSyncCalloutText.textContent = succeeded
    ? "Dashboard health synced" : "Health sync could not connect";
  statusPulseTimer = window.setTimeout?.(() => {
    informationElements.systemOverview.classList.remove("is-heartbeat", "is-sync-complete", "is-sync-failed");
    statusPulseTimer = undefined;
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
