const CORRIDOR_IDS = ["I25", "I70"];
const CORRIDOR_CONFIG = {
  I25: {
    label: "I-25 Front Range",
    distanceMiles: 63,
    currentColorVariable: "--gold-data",
    summaryPrefix: "i25",
    chartId: "i25Chart",
    incidentRowsId: "i25IncidentRows"
  },
  I70: {
    label: "I-70 Mountain–Denver",
    distanceMiles: 68,
    currentColorVariable: "--rose",
    summaryPrefix: "i70",
    chartId: "i70Chart",
    incidentRowsId: "i70IncidentRows"
  }
};

const AUTO_REFRESH_MS = 60_000;
const REPLAY_REFRESH_MS = 15_000;
const MANUAL_REFRESH_COOLDOWN_MS = 15_000;
const DASHBOARD_RANGE_HOURS = [2, 6, 24, 168, 720];

const RECENT_INCIDENT_WINDOW_MINUTES = 1_440;

const SIGMA_COVERAGE = { 1: "68.3%", 2: "95.4%", 3: "99.7%" };
const QUERY_PARAMS = new URLSearchParams(window.location.search);
const DEMO_MODE = QUERY_PARAMS.get("demo") === "1";
const HISTORICAL_MODE = !DEMO_MODE && QUERY_PARAMS.get("historical") === "1";
const DASHBOARD_RUNTIME = dashboardRuntime(window.location.pathname);
const REPLAY_MODE = document.documentElement.dataset.replayEnabled !== "false"
  && !DASHBOARD_RUNTIME.experimental
  && !DEMO_MODE && !HISTORICAL_MODE && QUERY_PARAMS.get("replay") === "1";
const REPLAY_CONFIG = buildReplayConfig(QUERY_PARAMS);
const PRELOAD_DASHBOARD_VIEWS = !REPLAY_MODE;

function dashboardRuntime(pathname) {
  const experimental = pathname === "/dashboard-experimental"
    || String(pathname || "").startsWith("/dashboard-experimental/");
  return experimental
    ? { experimental: true, apiBase: "/dashboard-experimental-api", healthPath: "/dashboard-experimental-health" }
    : { experimental: false, apiBase: "/dashboard-api", healthPath: "/actuator/health" };
}

function dashboardApi(path) {
  const suffix = String(path || "");
  return `${DASHBOARD_RUNTIME.apiBase}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

const state = {
  selectedHours: 24,
  referenceSigma: 2,
  focusedCorridor: "ALL",
  chartView: "overall",
  zoneFinder: false,
  variableSpeedHistoricalView: false,
  selectedZoneKey: null,
  replayStartedAt: Date.now(),
  followsDeviceTheme: true,
  deviceThemeQuery: null,
  routeData: new Map(),
  corridorFeatures: new Map(),
  snapshots: new Map(),
  readSections: new Map(),
  syncController: null,
  lastSyncedAt: null,
  health: null,
  refreshing: false,
  refreshPending: false,
  manualRefreshTimer: null,
  expandedIncidents: new Set(),
  incidentLegendExpanded: false,
  refreshTimer: null,
  resizeTimer: null
};

let pendingIncidentPageScroll = 0;
let incidentPageScrollScheduled = false;
let zoneLayoutRevision = 0;
let zoneLayoutAnimations = [];
let pendingZoneLayoutBefore = null;

const elements = {
  corridorControl: document.getElementById("corridorControl"),
  refreshButton: document.getElementById("refreshButton"),
  statusText: document.getElementById("statusText"),
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  rangeControl: document.getElementById("rangeControl"),
  chartViewControl: document.getElementById("chartViewControl"),
  zoneFinderToggle: document.getElementById("zoneFinderToggle"),
  zoneFinderReveal: document.getElementById("zoneFinderReveal"),
  comparisonTitle: document.getElementById("comparisonTitle"),
  sigmaControl: document.getElementById("sigmaControl"),
  sigmaValue: document.getElementById("sigmaValue"),
  sigmaCoverage: document.getElementById("sigmaCoverage"),
  sigmaDecrease: document.getElementById("sigmaDecrease"),
  sigmaIncrease: document.getElementById("sigmaIncrease"),
  chartSummary: document.getElementById("chartSummary"),
  historyToggle: document.getElementById("historyScrollToggle"),
  historyState: document.getElementById("historyScrollState"),
  historyDetails: document.getElementById("chartHistoryDetails"),
  historyFirst: document.getElementById("historyFirst"),
  historyOlder: document.getElementById("historyOlder"),
  historyNewer: document.getElementById("historyNewer"),
  historyCurrent: document.getElementById("historyCurrent"),
  historyRetry: document.getElementById("historyRetry"),
  historyWindow: document.getElementById("chartHistoryWindow"),
  historyMarkerNotice: document.getElementById("chartHistoryMarkerNotice"),
  historyHelp: document.getElementById("chartHistoryHelp"),
  systemWarning: document.getElementById("systemWarning"),
  systemWarningTitle: document.getElementById("systemWarningTitle"),
  systemWarningMessage: document.getElementById("systemWarningMessage"),
  systemHeadline: document.getElementById("systemHeadline"),
  routesServiceStatus: document.getElementById("routesServiceStatus"),
  ingestServiceStatus: document.getElementById("ingestServiceStatus"),
  apiServiceStatus: document.getElementById("apiServiceStatus"),
  databaseStatus: document.getElementById("databaseStatus"),
  pipelineStatus: document.getElementById("pipelineStatus")
};

const chartSeries = window.DashboardSeries.create({ parseDate, finiteNumber, dateMillis, formatZoneMileMarkerRange });

const incidentModel = window.DashboardIncidentModel.create({ finiteNumber, parseDate, types: window.IncidentTypes, dateMillis, formatMileMarker });

const chartAxis = window.DashboardChartAxis.create({ displayTimeFormatter });

const chartPainter = window.DashboardChartPainter.create({
  sizeCanvas: (...args) => sizeCanvas(...args),
  chartEndTime,
  state,
  chartSeries,
  drawEmptyChart: (...args) => drawEmptyChart(...args),
  chartHistoryEmptyMessage,
  chartColors: (...args) => chartColors(...args),
  chartAxis,
  CORRIDOR_CONFIG,
  hasLiveChartEdge: (...args) => hasLiveChartEdge(...args),
  chartHistory,
  historyWindowKey,
  zoneFinderActive,
  finiteNumber,
  formatMetricNumber,
  HISTORICAL_MODE,
  REPLAY_MODE,
  dateMillis,
  displayTimeFormatter,
  Path2D,
  types: window.IncidentTypes
});

initializeDashboard();

async function initializeDashboard() {
  initializeTheme();
  initializeCorridorFocus();
  initializeControls();
  void window.CorridorMapPanel?.preload?.();
  await resolveDefaultReplayWindow();
  await hydrateDashboardBootstrap();
  void refreshDashboard();
  if (!HISTORICAL_MODE) {
    state.refreshTimer = window.setInterval(
      () => { if (!document.hidden) void refreshDashboard({ queueIfBusy: false }); },
      REPLAY_MODE ? REPLAY_REFRESH_MS : AUTO_REFRESH_MS
    );
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) state.syncController?.abort();
    else if (!HISTORICAL_MODE && (!state.lastSyncedAt || Date.now() - state.lastSyncedAt.getTime() >= AUTO_REFRESH_MS)) {
      void refreshDashboard({ queueIfBusy: true });
    }
  });
  window.addEventListener("pagehide", () => state.syncController?.abort());
}

function initializeTheme() {
  let storedTheme;
  try { storedTheme = window.localStorage.getItem("ctt-dashboard-theme"); } catch { /* Storage can be disabled. */ }
  state.followsDeviceTheme = storedTheme !== "dark" && storedTheme !== "light";
  state.deviceThemeQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  applyTheme(state.followsDeviceTheme && state.deviceThemeQuery?.matches ? "dark" : storedTheme === "dark" ? "dark" : "light");
  state.deviceThemeQuery?.addEventListener?.("change", (event) => {
    if (state.followsDeviceTheme) applyTheme(event.matches ? "dark" : "light");
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const darkMode = theme === "dark";
  elements.themeToggle.setAttribute("aria-pressed", String(darkMode));
  elements.themeToggle.setAttribute("aria-label", darkMode ? "Switch to light mode" : "Switch to dark mode");
  elements.themeIcon?.setAttribute("href", darkMode ? "#icon-sun" : "#icon-moon");
  window.CorridorMapPanel?.setTheme(theme);
  if (state.routeData.size > 0) {
    window.requestAnimationFrame(drawAllCharts);
  }
}

function initializeCorridorFocus() {
  const requestedCorridor = String(new URLSearchParams(window.location.search).get("corridor") || "ALL").toUpperCase();
  const initialFocus = CORRIDOR_IDS.includes(requestedCorridor) ? requestedCorridor : "ALL";
  applyCorridorFocus(initialFocus, false);
}

function initializeControls() {
  document.getElementById("incidentLegendToggle")?.addEventListener("click", () => {
    setIncidentLegendExpanded(!state.incidentLegendExpanded);
  });
  initializeHistoryControls();
  updateReferenceBandControl();
  elements.corridorControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-corridor-focus]");
    if (!button || button.disabled || button.dataset.corridorFocus === state.focusedCorridor) return;
    applyCorridorFocus(button.dataset.corridorFocus, true);
  });

  elements.refreshButton.addEventListener("click", requestManualRefresh);

  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    state.followsDeviceTheme = false;
    try { window.localStorage.setItem("ctt-dashboard-theme", nextTheme); } catch { /* Theme still works for this visit. */ }
    applyTheme(nextTheme);
  });

  elements.chartViewControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-chart-view]");
    if (!button || button.disabled) return;
    setChartView(button.dataset.chartView);
  });

  elements.zoneFinderToggle.addEventListener("click", () => setZoneFinder(!state.zoneFinder));

  for (const corridor of CORRIDOR_IDS) {
    document.getElementById(CORRIDOR_CONFIG[corridor].chartId).addEventListener("click", event => {
      if (!zoneFinderActive() || state.focusedCorridor !== corridor) return;
      const groups = visibleSpeedZoneGroups(corridor);
      const bounds = event.currentTarget.getBoundingClientRect();
      const rowHeight = (bounds.height - 36) / Math.max(1, groups.length);
      const index = Math.floor((event.clientY - bounds.top - 6) / rowHeight);
      if (event.clientX - bounds.left > 112 || index < 0 || index >= groups.length) return;
      window.CorridorMapPanel?.selectZone?.(groups[index].referenceKey || groups[index].key, true);
    });
  }

  elements.sigmaControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-sigma-step]");
    if (!button || button.disabled) return;
    showHistoryButtonFeedback(button);
    setReferenceSigma(state.referenceSigma + Number(button.dataset.sigmaStep));
  });

  for (const link of document.querySelectorAll("[data-incident-toggle]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (state.focusedCorridor !== "ALL") return;
      const corridor = link.dataset.incidentToggle;
      if (state.expandedIncidents.has(corridor)) state.expandedIncidents.delete(corridor);
      else state.expandedIncidents.add(corridor);
      renderIncidentTable(corridor, state.routeData.get(corridor)?.incidentThreads || []);
    });
  }

  for (const scroller of document.querySelectorAll(".incident-table-wrap")) {
    scroller.addEventListener("wheel", (event) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
      const remainder = nestedScrollRemainder(scroller, event.deltaY * unit);
      if (Math.abs(remainder) < 0.5) return;
      event.preventDefault();
      queueIncidentPageScroll(remainder);
    }, { passive: false });
  }

  elements.rangeControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-hours]");
    if (!button) return;
    const requestedHours = Number(button.dataset.hours);
    if (!Number.isFinite(requestedHours) || requestedHours === state.selectedHours) return;
    window.HistoricalSummary?.navigation("discrete");
    const endTime = historyEndForRange(requestedHours);
    state.selectedHours = requestedHours;
    chartHistory.endTime = endTime;
    resetHistoryWheelHover();
    for (const rangeButton of elements.rangeControl.querySelectorAll("button[data-hours]")) {
      const active = Number(rangeButton.dataset.hours) === requestedHours;
      rangeButton.classList.toggle("active", active);
      rangeButton.setAttribute("aria-pressed", String(active));
    }
    if (PRELOAD_DASHBOARD_VIEWS) applyDashboardSnapshot(requestedHours);
    else void refreshDashboard({ queueIfBusy: true });
    refreshHistorySelection();
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(drawAllCharts, 120);
  });
}

function nestedScrollRemainder(scroller, deltaY) {
  const viewportHeight = Number(scroller?.clientHeight);
  const contentHeight = Number(scroller?.scrollHeight);
  const currentScroll = Number(scroller?.scrollTop);
  if (!Number.isFinite(deltaY) || deltaY === 0
      || !Number.isFinite(viewportHeight) || !Number.isFinite(contentHeight)
      || !Number.isFinite(currentScroll)) return 0;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  if (maxScroll <= 0) return 0;
  const start = Math.max(0, Math.min(maxScroll, currentScroll));
  const end = Math.max(0, Math.min(maxScroll, start + deltaY));
  const consumed = end - start;
  const remainder = deltaY - consumed;
  if (Math.abs(remainder) < 0.5) return 0;
  scroller.scrollTop = end;
  return remainder;
}

function queueIncidentPageScroll(deltaY) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return;
  pendingIncidentPageScroll += deltaY;
  if (incidentPageScrollScheduled) return;
  incidentPageScrollScheduled = true;
  window.requestAnimationFrame(() => {
    const distance = pendingIncidentPageScroll;
    pendingIncidentPageScroll = 0;
    incidentPageScrollScheduled = false;
    window.scrollBy({ top: distance, left: 0, behavior: "instant" });
  });
}

function setReferenceSigma(value) {
  const requestedSigma = finiteNumber(value);
  const nextSigma = Math.max(1, Math.min(3, Math.round(Number.isFinite(requestedSigma) ? requestedSigma : 2)));
  if (nextSigma === state.referenceSigma) return;
  state.referenceSigma = nextSigma;
  updateReferenceBandControl();
  window.requestAnimationFrame(drawAllCharts);
}

function updateReferenceBandControl() {
  const empiricalCoverage = referenceCoveragePercentage();
  const usesEmpiricalCoverage = Number.isFinite(empiricalCoverage);
  const coverage = usesEmpiricalCoverage
    ? `${empiricalCoverage.toFixed(1)}%`
    : SIGMA_COVERAGE[state.referenceSigma];
  elements.sigmaValue.textContent = `±${state.referenceSigma}σ`;
  elements.sigmaCoverage.textContent = coverage;
  elements.sigmaCoverage.title = usesEmpiricalCoverage
    ? "Recency-weighted share of matching historical observations inside this band."
    : "Theoretical coverage for a normal distribution; historical coverage is unavailable.";
  elements.sigmaDecrease.disabled = state.referenceSigma <= 1;
  elements.sigmaIncrease.disabled = state.referenceSigma >= 3;
  elements.sigmaControl.setAttribute(
    "aria-label",
    `Reference band width, plus or minus ${state.referenceSigma} standard deviations, ${coverage} ${usesEmpiricalCoverage ? "historical" : "theoretical normal"} coverage`
  );
}

function referenceCoveragePercentage() {
  const coverageField = `coverage${["", "One", "Two", "Three"][state.referenceSigma]}Sigma`;
  const corridors = state.focusedCorridor === "ALL" ? CORRIDOR_IDS : [state.focusedCorridor];
  let weightedCoverage = 0;
  let totalWeight = 0;
  for (const corridor of corridors) {
    const routeData = chartRouteData(corridor);
    if (!routeData) continue;
    const endTime = chartEndTime(routeData);
    const startTime = endTime - state.selectedHours * 3_600_000;
    const series = window.ContinuousHistory?.active && chartHistory.endTime !== null
      ? window.ContinuousHistory.reference(corridor, startTime, endTime)
      : state.chartView === "zones" && state.focusedCorridor === corridor
      ? chartSeries.groupZoneSeries(routeData?.zones || [], state.selectedHours, endTime, routeData?.zoneBaseline?.zones || [])
        .flatMap(group => chartSeries.buildBaselineSeries([], startTime, endTime, group.baselineProfiles))
      : chartSeries.buildBaselineSeries(
        routeData?.trend?.buckets || [],
        startTime,
        endTime,
        routeData?.baseline?.profiles || []
      );
    for (const point of series) {
      const coverage = finiteNumber(point?.[coverageField]);
      if (!Number.isFinite(coverage)) continue;
      const sampleWeight = finiteNumber(point?.effectiveSampleSize);
      const weight = Number.isFinite(sampleWeight) && sampleWeight > 0 ? sampleWeight : 1;
      weightedCoverage += coverage * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? weightedCoverage / totalWeight : Number.NaN;
}

function applyCorridorFocus(corridor, updateUrl) {
  stopZoneLayoutMotion();
  const normalized = CORRIDOR_IDS.includes(corridor) ? corridor : "ALL";
  if (normalized !== state.focusedCorridor) {
    resetCorridorHistory();
    state.selectedZoneKey = null;
    state.zoneFinder = false;
  }
  state.focusedCorridor = normalized;
  document.body.dataset.focus = normalized === "ALL" ? "" : normalized;
  for (const button of elements.corridorControl.querySelectorAll("button[data-corridor-focus]")) {
    const active = button.dataset.corridorFocus === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  elements.chartViewControl.hidden = normalized === "ALL";
  const zoneButton = elements.chartViewControl.querySelector('button[data-chart-view="zones"]');
  zoneButton.disabled = normalized === "ALL";
  if (normalized === "ALL") setChartView("overall");
  else updateChartCopy();
  refreshHistorySelection();
  updateHistoryControls();
  if (state.routeData.size > 0) {
    for (const route of CORRIDOR_IDS) {
      renderIncidentTable(route, state.routeData.get(route)?.incidentThreads || []);
    }
  }
  renderIncidentLegend();
  updateReferenceBandControl();
  updateZoneMapLayout();
  renderVariableSpeedNotice();
  renderFocusedCorridorMap();
  window.requestAnimationFrame(drawAllCharts);
  if (!updateUrl) return;
  const url = new URL(window.location.href);
  if (normalized === "ALL") {
    url.searchParams.delete("corridor");
  } else {
    url.searchParams.set("corridor", normalized);
  }
  window.history.replaceState(null, "", url);
}

function setChartView(requestedView) {
  stopZoneLayoutMotion();
  const view = requestedView === "zones" && state.focusedCorridor !== "ALL" ? "zones" : "overall";
  state.chartView = view;
  if (chartHistory.endTime !== null) chartHistory.endTime = historyEndForRange(state.selectedHours, view);
  if (view !== "zones") {
    state.zoneFinder = false;
    state.selectedZoneKey = null;
  }
  document.body.dataset.chartView = view;
  for (const button of elements.chartViewControl.querySelectorAll("button[data-chart-view]")) {
    const active = button.dataset.chartView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateChartCopy();
  refreshHistorySelection();
  updateReferenceBandControl();
  updateZoneMapLayout();
  renderFocusedCorridorMap();
  window.requestAnimationFrame(drawAllCharts);
}

function zoneFinderActive() {
  return state.zoneFinder && state.chartView === "zones" && state.focusedCorridor !== "ALL";
}

function setZoneFinder(enabled) {
  const before = pendingZoneLayoutBefore || captureZoneLayout();
  stopZoneLayoutMotion();
  const revision = zoneLayoutRevision;
  pendingZoneLayoutBefore = before;
  state.zoneFinder = Boolean(enabled) && state.chartView === "zones" && state.focusedCorridor !== "ALL";
  if (!state.zoneFinder) state.selectedZoneKey = null;
  updateZoneMapLayout();
  renderFocusedCorridorMap();
  window.requestAnimationFrame(() => {
    if (revision !== zoneLayoutRevision) return;
    pendingZoneLayoutBefore = null;
    drawAllCharts();
    animateZoneLayout(before);
  });
}

function captureZoneLayout() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return [];
  const canvas = document.getElementById(CORRIDOR_CONFIG[state.focusedCorridor]?.chartId);
  const shield = canvas?.closest?.(".chart-lane")?.querySelector?.(".lane-label");
  const collapseShield = !window.matchMedia?.("(max-width: 48rem)").matches;
  return [canvas?.closest?.(".chart-canvas-wrap"), shield, document.getElementById("corridorMapPanel")]
    .filter(node => node?.animate && !node.hidden)
    .map(node => ({node, bounds: node.getBoundingClientRect(), shield: node === shield && collapseShield,
      visible: node !== shield || !zoneFinderActive() || !collapseShield}));
}

function stopZoneLayoutMotion() {
  zoneLayoutRevision += 1;
  pendingZoneLayoutBefore = null;
  for (const {node, animation} of zoneLayoutAnimations) {
    animation.cancel();
    node.classList.remove("zone-layout-moving");
  }
  zoneLayoutAnimations = [];
}

function animateZoneLayout(before) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const moves = before.map(entry => ({...entry, before: entry.bounds, after: entry.node.getBoundingClientRect()}));
  for (const {node, before: first, after: last, shield, visible} of moves) {
    if (node.hidden || !(first.width > 0 && last.width > 0)) continue;
    const targetX = shield && zoneFinderActive() ? -last.width : 0;
    const x = first.left - (last.left - targetX), y = first.top - last.top, scale = first.width / last.width;
    const scaleY = first.height > 0 && last.height > 0 ? first.height / last.height : 1;
    if (Math.abs(x - targetX) < 1 && Math.abs(y) < 1 && Math.abs(scale - 1) < 0.001
        && Math.abs(scaleY - 1) < 0.001) continue;
    node.classList.add("zone-layout-moving");
    // Offscreen destinations use a short rise/exit rather than a cross-page flight.
    const viewportHeight = window.innerHeight || Infinity;
    const entering = node.id === "corridorMapPanel" && first.top >= viewportHeight && last.top < viewportHeight;
    const leaving = node.id === "corridorMapPanel" && last.top >= viewportHeight && first.top < viewportHeight;
    const animation = node.animate([
      {transform: entering ? "translate(0, 150px) scaleX(1)" : `translate(${x}px, ${y}px) scaleX(${scale})${scaleY === 1 ? "" : ` scaleY(${scaleY})`}`,
        opacity: entering || (shield && !visible) ? 0 : 1, transformOrigin: "top left"},
      {transform: leaving ? `translate(${x}px, ${y + 150}px) scaleX(${scale})` : `translate(${targetX}px, 0) scaleX(1)`,
        opacity: leaving || (shield && zoneFinderActive()) ? 0 : 1, transformOrigin: "top left"}
    ], {duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)"});
    const motion = {node, animation};
    zoneLayoutAnimations.push(motion);
    animation.onfinish = () => {
      node.classList.remove("zone-layout-moving");
      zoneLayoutAnimations = zoneLayoutAnimations.filter(item => item !== motion);
    };
  }
}

function updateZoneMapLayout() {
  const available = state.chartView === "zones" && state.focusedCorridor !== "ALL";
  const zones = zoneFinderActive();
  elements.chartViewControl.dataset.finderAvailable = String(available);
  elements.chartViewControl.querySelector('button[data-chart-view="zones"]').setAttribute("aria-expanded", String(available));
  elements.zoneFinderReveal.inert = !available;
  elements.zoneFinderReveal.setAttribute("aria-hidden", String(!available));
  elements.zoneFinderToggle.disabled = !available;
  elements.zoneFinderToggle.setAttribute("aria-pressed", String(zones));
  document.body.dataset.zoneFinder = zones ? "enabled" : "disabled";
  const comparison = document.getElementById("comparisonPanel");
  const panel = document.getElementById("corridorMapPanel");
  const destination = zones ? comparison : document.getElementById("incidentRouteGrid");
  comparison?.classList?.toggle("zone-reference-active", zones);
  if (destination?.appendChild && panel?.parentElement !== destination) destination.appendChild(panel);
}

function visibleSpeedZoneGroups(corridor) {
  const data = chartRouteData(corridor);
  return data?.layoutGroups || chartSeries.groupZoneSeries(data?.zones || [], state.selectedHours,
    chartEndTime(data), data?.zoneBaseline?.zones || []);
}

function selectSpeedZone(key) {
  if (!zoneFinderActive()) return;
  state.selectedZoneKey = key;
  window.requestAnimationFrame(drawAllCharts);
}

function updateChartCopy() {
  const label = CORRIDOR_CONFIG[state.focusedCorridor]?.label;
  elements.comparisonTitle.textContent = state.chartView === "zones"
    ? `${label || "Corridor"} Speed Zones`
    : `${label || "Corridor"} Speed vs 3-Month Baseline`;
  for (const corridor of CORRIDOR_IDS) {
    const canvas = document.getElementById(CORRIDOR_CONFIG[corridor].chartId);
    canvas.setAttribute("aria-label", state.chartView === "zones" && state.focusedCorridor === corridor
      ? `${CORRIDOR_CONFIG[corridor].label} speed zones compared with their three-month baselines and incident activity`
      : `${CORRIDOR_CONFIG[corridor].label} ${chartHistory.endTime === null ? "current" : "historical observed"} speed compared with its three-month baseline and incident activity`);
  }
}

function requestManualRefresh() {
  if (state.refreshing || state.manualRefreshTimer !== null) return;
  showHistoryButtonFeedback(elements.refreshButton);
  state.manualRefreshTimer = window.setTimeout(() => {
    state.manualRefreshTimer = null;
    updateRefreshButtonState();
  }, MANUAL_REFRESH_COOLDOWN_MS);
  updateRefreshButtonState();
  void refreshDashboard({ queueIfBusy: false });
  window.HistoricalSummary?.schedule(true);
}

function updateRefreshButtonState() {
  elements.refreshButton.disabled = state.refreshing || state.manualRefreshTimer !== null;
}

async function refreshDashboard(options = {}) {
  if (state.refreshing) {
    if (options.queueIfBusy) state.refreshPending = true;
    return;
  }
  state.refreshing = true;
  elements.refreshButton.setAttribute("aria-busy", "true");
  updateRefreshButtonState();
  setStatus(DEMO_MODE ? "Syncing the local design preview…"
    : HISTORICAL_MODE ? "Loading retained corridor data…"
      : REPLAY_MODE ? "Advancing the retained-data replay…"
        : state.snapshots.size > 0 ? "Syncing all dashboard views in the background…"
          : "Preloading all dashboard views…");

  try {
    if (PRELOAD_DASHBOARD_VIEWS) {
      const snapshots = DEMO_MODE ? buildDemoDashboardSnapshots() : await loadLiveDashboardSnapshots();
      state.snapshots = mergeDashboardSnapshots(state.snapshots, snapshots);
      state.lastSyncedAt = new Date();
      applyDashboardSnapshot(state.selectedHours);
      window.ContinuousHistory?.prepare();
    } else {
      const dashboardData = DEMO_MODE ? buildDemoDashboardData() : await loadLiveDashboardData(state.selectedHours);
      applyDashboardData(dashboardData);
      updateDashboardStatus(dashboardData, new Date());
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (state.snapshots.size > 0) {
      applyDashboardSnapshot(state.selectedHours, false);
      const lastSync = state.lastSyncedAt ? ` Showing data synced at ${formatSyncTime(state.lastSyncedAt)}.` : "";
      setStatus(`${error instanceof Error ? error.message : "Dashboard sync failed."}${lastSync}`, true);
    } else {
      state.routeData = new Map();
      state.corridorFeatures = new Map();
      state.health = null;
      renderDashboard();
      setStatus(error instanceof Error ? error.message : "Dashboard data is unavailable.", true);
    }
  } finally {
    if (state.routeData.size && chartHistory.bounds === null && !chartHistory.coverageFailures.size) void loadHistoryCoverage();
    state.refreshing = false;
    elements.refreshButton.removeAttribute("aria-busy");
    updateRefreshButtonState();
    if (state.refreshPending) {
      state.refreshPending = false;
      if (!document.hidden) void refreshDashboard({ queueIfBusy: false });
    }
  }
}

function applyDashboardSnapshot(hours, updateStatus = true) {
  const dashboardData = state.snapshots.get(hours);
  if (!dashboardData) return false;
  applyDashboardData(dashboardData);
  if (updateStatus) updateDashboardStatus(dashboardData, state.lastSyncedAt);
  return true;
}

function applyDashboardData(dashboardData) {
  state.routeData = dashboardData.routeData;
  state.corridorFeatures = dashboardData.corridorFeatures || new Map();
  state.health = dashboardData.health;
  updateHistoryControls();
  renderDashboard();
}

function updateDashboardStatus(dashboardData, syncedAt) {
  const failures = dashboardData.health?.failures || [];
  const historicalTime = latestRouteTime(dashboardData.routeData);
  const successStatus = HISTORICAL_MODE
    ? `Historical snapshot · ${formatShortDateTime(historicalTime)} · Ingestion off`
    : REPLAY_MODE
      ? `Replay live · ${formatShortDateTime(historicalTime)} · ${formatReplayRate(REPLAY_CONFIG.rate)} · Ingestion off`
      : `${DEMO_MODE ? "Demo preview · Sample data" : "Data"} synced at ${formatSyncTime(syncedAt || new Date())} · Syncs every 60 seconds`;
  setStatus(failures.length ? `Some data is unavailable: ${failures.join("; ")}` : successStatus, failures.length > 0);
}

async function loadLiveDashboardData(selectedHours, options = {}) {
  const requestJson = options.requestJson || fetchJson;
  const replayAnchor = REPLAY_MODE ? replayAsOf() : null;
  const trendWindowHours = options.preload ? Math.max(...DASHBOARD_RANGE_HOURS) + 169 : selectedHours + 169;
  const trendLimit = trendWindowHours + 1;
  const incidentWindowMinutes = Math.min(43_200, selectedHours * 60);
  const failures = [];
  const healthPromise = Promise.allSettled([
    requestJson(DASHBOARD_RUNTIME.healthPath),
    requestJson(dashboardApi("/traffic/map/corridors")),
    requestJson(dashboardApi("/system/operational-status"))
  ]);

  const routeResults = await Promise.allSettled(CORRIDOR_IDS.map(async (corridor) => {
    const replayAsOfParam = replayAnchor ? `&asOf=${encodeURIComponent(replayAnchor.toISOString())}` : "";
    const summaryPath = REPLAY_MODE
      ? dashboardApi(`/traffic/history?corridor=${corridor}&windowMinutes=60&limit=1&preferUsable=true&includeIncidents=true${replayAsOfParam}`)
      : dashboardApi(`/traffic/summary?corridor=${corridor}&windowHours=168&recentIncidentWindowMinutes=${RECENT_INCIDENT_WINDOW_MINUTES}&preferUsable=true`);
    const summaryResult = await Promise.allSettled([requestJson(summaryPath)]).then(([result]) => result);
    const summary = summaryResult.status === "fulfilled"
      ? (REPLAY_MODE ? buildReplaySummary(summaryResult.value, replayAnchor) : summaryResult.value)
      : null;
    const rawDataAnchor = summary?.latest?.polledAt;
    const dataAnchor = REPLAY_MODE && replayAnchor
      ? replayAnchor.toISOString()
      : HISTORICAL_MODE && parseDate(rawDataAnchor) ? String(rawDataAnchor) : null;
    const asOfParam = dataAnchor ? `&asOf=${encodeURIComponent(dataAnchor)}` : "";
    const detailWindowMinutes = options.preload ? 1_440 : Math.min(selectedHours * 60, 10_080);
    const detailSampleLimit = detailedSpeedSampleLimit(detailWindowMinutes);
    const currentFlowCellsPromise = dataAnchor
      ? requestJson(dashboardApi(`/traffic/map/flow-cells/hourly?corridor=${corridor}&asOf=${encodeURIComponent(dataAnchor)}`))
      : requestJson(dashboardApi(`/traffic/map/flow-cells/current?corridor=${corridor}`));
    const zoneTrendsPromise = requestJson(dashboardApi(`/traffic/zones/trends?corridor=${corridor}&windowHours=${selectedHours}${asOfParam}`));
    const dailyZoneTrendsPromise = selectedHours === 24
      ? zoneTrendsPromise
      : requestJson(dashboardApi(`/traffic/zones/trends?corridor=${corridor}&windowHours=24${asOfParam}`));
    const reads = {
      "speed history": requestJson(dashboardApi(`/traffic/analytics/trends?corridor=${corridor}&windowHours=${trendWindowHours}&limit=${trendLimit}&preferUsable=true${asOfParam}`)),
      incidents: HISTORICAL_MODE || REPLAY_MODE
        ? requestJson(dashboardApi(`/traffic/map/incidents/timeline?corridor=${corridor}&windowMinutes=${incidentWindowMinutes}&limit=1000${asOfParam}`))
        : requestJson(dashboardApi(`/traffic/map/incidents/recent?corridor=${corridor}&windowMinutes=${incidentWindowMinutes}&limit=1000`)),
      "speed zones": zoneTrendsPromise,
      "speed-zone baseline": requestJson(dashboardApi(`/traffic/zones/baselines?corridor=${corridor}${asOfParam}`)),
      "detailed speeds": selectedHours <= 24
        ? requestJson(dashboardApi(`/traffic/history?corridor=${corridor}&windowMinutes=${detailWindowMinutes}&limit=${detailSampleLimit}&preferUsable=true&includeIncidents=false${asOfParam}`))
        : Promise.resolve({ samples: [] }),
      "baseline profile": requestJson(dashboardApi(`/traffic/analytics/baselines?corridor=${corridor}${asOfParam}`)),
      "current flow cells": currentFlowCellsPromise,
      "slowdown frequency": selectedHours > 24
        ? requestJson(dashboardApi(`/traffic/map/flow-cells/frequency?corridor=${corridor}&windowHours=${selectedHours}${asOfParam}`))
        : Promise.resolve(null),
      "daily travel zones": dailyZoneTrendsPromise,
      "variable speed signs": corridor === "I70" && !HISTORICAL_MODE && !REPLAY_MODE
        ? requestJson(dashboardApi("/traffic/map/variable-speed-limits/current?corridor=I70"))
        : Promise.resolve(null)
    };
    const settled = await Promise.allSettled(Object.values(reads));
    const results = { summary: summaryResult, ...Object.fromEntries(Object.keys(reads).map((name, index) => [name, settled[index]])) };
    const available = name => results[name].status === "fulfilled";
    const value = name => available(name) ? results[name].value : null;
    for (const name of Object.keys(results)) if (!available(name)) failures.push(`${corridor} ${name}`);
    const meaningfulResults = Object.entries(results).filter(([name]) => !(
      (name === "detailed speeds" && selectedHours > 24) || (name === "slowdown frequency" && selectedHours <= 24) || name === "variable speed signs"
    ));
    if (meaningfulResults.every(([, result]) => result.status === "rejected")) throw new Error("Unavailable");
    const incidents = value("incidents");
    const route = buildRouteData(corridor, summary, value("speed history"), incidents, dataAnchor,
      value("detailed speeds"), value("baseline profile"));
    route.incidentsAvailable = incidents !== null;
    route.incidentsTruncated = incidents?.truncated ?? ((incidents?.features?.length || 0) >= 1000);
    route.zones = value("speed zones")?.points || [];
    route.zoneBaseline = value("speed-zone baseline") || { zones: [] };
    route.dailyZones = value("daily travel zones")?.points || [];
    route.variableSpeedSigns = value("variable speed signs");
    route.currentFlowCells = value("current flow cells");
    route.flowCells = value(selectedHours > 24 ? "slowdown frequency" : "current flow cells");
    route.syncAvailability = {
      summary: available("summary"),
      trend: available("speed history"),
      incidents: available("incidents"),
      zones: available("speed zones"),
      zoneBaseline: available("speed-zone baseline"),
      history: selectedHours > 24 || available("detailed speeds"),
      baseline: available("baseline profile"),
      currentFlowCells: available("current flow cells"),
      flowCells: available(selectedHours <= 24 ? "current flow cells" : "slowdown frequency"),
      dailyZones: available("daily travel zones"),
      variableSpeedSigns: available("variable speed signs")
    };
    if (route.incidentsTruncated) failures.push(`${corridor} incidents limited to the latest 1,000`);
    return route;
  }));

  const routeData = new Map();
  routeResults.forEach((result, resultIndex) => {
    const corridor = CORRIDOR_IDS[resultIndex];
    if (result.status === "fulfilled") {
      routeData.set(corridor, result.value);
    } else {
      failures.push(`${corridor}: ${result.reason instanceof Error ? result.reason.message : "unavailable"}`);
    }
  });

  const [healthResult, routesResult, operationalResult] = await healthPromise;
  if (operationalResult.status === "rejected") failures.push("pipeline status");
  const corridorFeatures = new Map();
  if (routesResult.status === "fulfilled" && Array.isArray(routesResult.value?.features)) {
    for (const feature of routesResult.value.features) {
      const corridor = feature?.properties?.corridor;
      if (CORRIDOR_IDS.includes(corridor)) corridorFeatures.set(corridor, feature);
    }
  }

  return {
    routeData,
    corridorFeatures,
    health: {
      apiUp: healthResult.status === "fulfilled" && healthResult.value?.status === "UP",
      routesUp: routesResult.status === "fulfilled" && CORRIDOR_IDS.every(id => routesResult.value?.features?.some(f => f.properties?.corridor === id)),
      databaseUp: operationalResult.status === "fulfilled" && !operationalResult.value?.checks?.some(check => check.component === "database"),
      operational: operationalResult.status === "fulfilled" ? operationalResult.value : null,
      partial: failures.length > 0,
      failures
    }
  };
}

function detailedSpeedSampleLimit(windowMinutes) {
  return Math.min(2_000, Math.max(120, Math.ceil(windowMinutes) + 60));
}

function buildRouteData(corridor, summary, trend, incidents, dataAnchor = null, history = null, baseline = null) {
  const incidentFeatures = Array.isArray(incidents?.features) ? incidents.features : [];
  const resolvedIncidentFeatures = (HISTORICAL_MODE || REPLAY_MODE) && incidentFeatures.length === 0
    ? incidentModel.legacySnapshotIncidentFeatures(summary?.latest) : incidentFeatures;
  const incidentThreads = incidentModel.aggregateIncidentThreads(resolvedIncidentFeatures, dataAnchor);
  return {
    corridor,
    summary: summary || {},
    trend: trend || { buckets: [] },
    history: history || { samples: [] },
    baseline: baseline || { profiles: [] },
    incidentFeatures: resolvedIncidentFeatures,
    incidentThreads,
    dataAnchor
  };
}

function buildReplayConfig(searchParams) {
  const defaultStart = Date.parse("2026-09-10T20:30:00Z");
  const defaultDuration = 5 * 60 * 60_000;
  const requestedStart = dateMillis(searchParams.get("replayStart"));
  const requestedEnd = dateMillis(searchParams.get("replayEnd"));
  const start = requestedStart || defaultStart;
  const end = requestedEnd > start ? requestedEnd : start + defaultDuration;
  const requestedRate = finiteNumber(searchParams.get("replayRate"));
  const rate = Number.isFinite(requestedRate) ? Math.min(3_600, Math.max(1, requestedRate)) : 30;
  return { start, end, rate };
}

async function resolveDefaultReplayWindow(requestJson = fetchJson) {
  if (!REPLAY_MODE || dateMillis(QUERY_PARAMS.get("replayStart"))
      || dateMillis(QUERY_PARAMS.get("replayEnd"))) return;

  const latestResults = await Promise.allSettled(CORRIDOR_IDS.map(corridor =>
    requestJson(dashboardApi(`/traffic/latest?corridor=${corridor}&preferUsable=true`))
  ));
  const latestTimes = latestResults.map(result => result.status === "fulfilled"
    ? dateMillis(result.value?.polledAt) : 0);
  if (latestTimes.some(time => !Number.isFinite(time) || time <= 0)) return;

  const end = Math.min(...latestTimes);
  REPLAY_CONFIG.end = end;
  REPLAY_CONFIG.start = end - 5 * 60 * 60_000;
  state.replayStartedAt = Date.now();
}

function replayAsOf(realNow = Date.now()) {
  const duration = Math.max(1, REPLAY_CONFIG.end - REPLAY_CONFIG.start);
  const elapsed = Math.max(0, realNow - state.replayStartedAt) * REPLAY_CONFIG.rate;
  const replayTime = REPLAY_CONFIG.start + (elapsed % duration);
  return new Date(Math.floor(replayTime / 60_000) * 60_000);
}

function buildReplaySummary(historyResponse, replayAnchor) {
  return {
    generatedAt: replayAnchor?.toISOString?.() || null,
    latest: Array.isArray(historyResponse?.samples) ? historyResponse.samples[0] || null : null,
    providerStatus: { halted: false, stale: false, state: "REPLAY" }
  };
}

function formatReplayRate(rate) {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}× speed`;
}

function renderDashboard() {
  for (const corridor of CORRIDOR_IDS) {
    const routeData = state.routeData.get(corridor);
    renderCorridorSummary(corridor, routeData);
    renderIncidentTable(corridor, routeData?.incidentThreads || []);
  }
  renderIncidentLegend();
  renderWarning();
  renderVariableSpeedNotice();
  renderSystemHealth();
  updateReferenceBandControl();
  renderFocusedCorridorMap();
  window.requestAnimationFrame(drawAllCharts);
}

function renderFocusedCorridorMap() {
  if (!window.CorridorMapPanel) return;
  if (!CORRIDOR_IDS.includes(state.focusedCorridor)) {
    window.CorridorMapPanel.hide();
    return;
  }
  window.CorridorMapPanel.render({
    corridor: state.focusedCorridor,
    corridorFeature: state.corridorFeatures.get(state.focusedCorridor),
    incidentFeatures: state.routeData.get(state.focusedCorridor)?.incidentFeatures || [],
    flowCells: state.routeData.get(state.focusedCorridor)?.flowCells || null,
    selectedHours: state.selectedHours,
    zoneMode: zoneFinderActive(),
    variableSpeedSigns: currentVariableSpeedSigns(),
    variableSpeedSignsConfirmed: state.routeData.get("I70")?.syncAvailability?.variableSpeedSigns !== false,
    theme: document.documentElement.dataset.theme
  });
}

function refreshVariableSpeedContext() {
  const historical = HISTORICAL_MODE || REPLAY_MODE || chartHistory.endTime !== null;
  if (historical === state.variableSpeedHistoricalView) return;
  state.variableSpeedHistoricalView = historical;
  renderVariableSpeedNotice();
  renderFocusedCorridorMap();
}

function currentVariableSpeedSigns() {
  if (HISTORICAL_MODE || REPLAY_MODE || chartHistory.endTime !== null) return null;
  return state.routeData.get("I70")?.variableSpeedSigns || null;
}

function renderVariableSpeedNotice() {
  const notice = document.getElementById("variableLimitNotice");
  const badge = document.getElementById("i70VariableLimitBadge");
  if (!notice || !badge) return;
  const snapshot = currentVariableSpeedSigns();
  const confirmed = state.routeData.get("I70")?.syncAvailability?.variableSpeedSigns !== false;
  const summary = window.VariableSpeedSigns?.summary(snapshot, confirmed);
  const hasChanges = snapshot && summary?.changed.length > 0;
  const visible = hasChanges && state.focusedCorridor !== "I25";
  notice.hidden = !visible;
  badge.hidden = !hasChanges;
  if (!snapshot || !summary) return;
  const count = summary.changed.length;
  const reported = summary.records.filter(sign => sign.differentFromRegular).map(sign => sign.reportedLimitMph);
  const minimum = Math.min(...reported), maximum = Math.max(...reported);
  const limitLabel = minimum === maximum ? `${minimum} mph` : `${minimum}–${maximum} mph`;
  const detail = summary.unavailable.length ? ` · ${summary.unavailable.length} sign locations unconfirmed` : "";
  notice.textContent = count
    ? `I-70 current posted limits: ${limitLabel} at ${count} sign ${count === 1 ? "location" : "locations"}, different from the regular reference${detail}. ${state.focusedCorridor === "ALL" ? "Select I-70 for sign details." : "Select a map badge for sign details."}`
    : `I-70 current posted limits: ${summary.available.length ? "no confirmed differences from the regular reference" : "limits unavailable"}${detail}.`;
  notice.title = "Comparison uses regular road limits and CDOT directional sign-location defaults, not a CDOT per-sign maximum. Sign reports do not establish the cause of a change.";
  badge.textContent = count ? "Posted limits differ*" : summary.unavailable.length ? "Some limits unconfirmed" : "Variable limits";
  badge.title = notice.title;
}

function renderCorridorSummary(corridor, routeData) {
  const historical = window.HistoricalSummary?.historical ?? (chartHistory.endTime !== null);
  if (historical && window.HistoricalSummary) return window.HistoricalSummary.render(corridor);
  const config = CORRIDOR_CONFIG[corridor];
  const summary = routeData?.summary || {};
  const latest = summary.latest || {};
  const periodView = state.selectedHours > 24;
  const currentSpeed = finiteNumber(latest.avgCurrentSpeed);
  const currentTravelMinutes = estimateCorridorTravelMinutes(
    routeData?.currentFlowCells,
    config.distanceMiles,
    currentSpeed
  );
  const period = periodView
    ? periodCorridorMetrics(routeData, config.distanceMiles, state.selectedHours)
    : null;
  const speed = period?.averageSpeed ?? currentSpeed;
  const travelMinutes = period?.averageTravelMinutes ?? currentTravelMinutes;
  const travelRange = periodView
    ? { fastest: period.fastestTravelMinutes, slowest: period.slowestTravelMinutes }
    : dailyTravelTimeRange(routeData, config.distanceMiles, currentTravelMinutes);
  const incidentCount = periodView
    ? (routeData?.incidentThreads || []).length
    : (routeData?.incidentThreads || []).filter((thread) => thread.ongoing).length;
  const worst = periodView
    ? period?.slowestAverageZone
    : slowestCurrentCell(routeData?.currentFlowCells)
      || slowestCurrentZone(routeData?.zones || [], latest.polledAt);
  const worstMileMarkers = formatZoneMileMarkerRange(worst);
  const minimumSpeed = finiteNumber(worst?.speedMph ?? worst?.avgCurrentSpeed);

  renderCorridorSummaryLabels(config.summaryPrefix, periodView);
  setText(`${config.summaryPrefix}AverageSpeed`, formatMetricNumber(speed, 0));
  setText(`${config.summaryPrefix}TravelTime`, formatMetricNumber(travelMinutes, 0));
  setText(`${config.summaryPrefix}FastestTravelTime`, formatMetricNumber(travelRange.fastest, 0));
  setText(`${config.summaryPrefix}SlowestTravelTime`, formatMetricNumber(travelRange.slowest, 0));
  setText(`${config.summaryPrefix}ActiveIncidents`, routeData?.incidentsAvailable === false || !routeData ? "—" : `${incidentCount}${routeData.incidentsTruncated ? "+" : ""}`);
  setText(`${config.summaryPrefix}WorstMileMarker`, worstMileMarkers || "MM unavailable");
  renderSummaryWorstSpeed(config.summaryPrefix, minimumSpeed);
}

function renderSummaryWorstSpeed(prefix, speed) {
  const available = Number.isFinite(speed);
  const value = available ? String(Math.round(speed)) : "";
  const number = document.getElementById(`${prefix}WorstSpeed`);
  if (number && number.textContent !== value) number.textContent = value;
  const unit = document.getElementById(`${prefix}WorstSpeedUnit`);
  if (unit && unit.hidden !== !available) unit.hidden = !available;
}

function renderCorridorSummaryLabels(prefix, periodView) {
  const travelBucket = state.selectedHours === 720 ? "3-hour" : "hour";
  setText(`${prefix}AverageSpeedLabel`, periodView ? `${state.selectedHours === 168 ? "7-Day" : "30-Day"} Average Speed` : "Average Speed");
  setText(`${prefix}TravelTimeLabel`, periodView ? "Average Travel Time" : "Estimated Travel Time");
  setText(`${prefix}FastestTravelTimeLabel`, periodView ? `Fastest ${travelBucket}` : "Fastest today");
  setText(`${prefix}SlowestTravelTimeLabel`, periodView ? `Slowest ${travelBucket}` : "Slowest today");
  setText(`${prefix}IncidentsLabel`, periodView ? "Observed Incidents" : "Active Incidents");
  setText(`${prefix}WorstSegmentLabel`, periodView ? "Slowest Avg Segment" : "Worst Segment");
  const worstCard = document.getElementById(`${prefix}WorstMileMarker`)?.closest?.(".metric-worst");
  worstCard?.removeAttribute("data-speed-fallback");
  worstCard?.querySelector?.("use")?.setAttribute("href", "#icon-pin");
  const incidentLabel = document.getElementById(`${prefix}IncidentsLabel`);
  if (incidentLabel) incidentLabel.title = periodView ? "Tracked incidents observed in the selected period." : "Currently active tracked incidents.";

  const travelLabel = document.getElementById(`${prefix}TravelTimeLabel`);
  const travelRange = document.getElementById(`${prefix}TravelTimeRange`);
  const worstLabel = document.getElementById(`${prefix}WorstSegmentLabel`);
  if (travelLabel) {
    travelLabel.title = periodView
      ? `Average of complete ${travelBucket} end-to-end estimates. Each estimate adds the travel time through every speed zone.`
      : "Estimated end-to-end travel time from current half-mile speeds; falls back to the corridor average when complete interval coverage is unavailable.";
  }
  if (travelRange) {
    travelRange.title = periodView
      ? `Fastest and slowest complete ${travelBucket} speed-zone travel estimates in the selected period.`
      : "Shortest and longest end-to-end estimates since midnight in Denver. Each 15-minute estimate adds the travel time through every speed zone; the current half-mile estimate is also included.";
  }
  if (worstLabel) {
    worstLabel.title = periodView
      ? "Speed zone with the lowest observation-weighted average speed in the selected period."
      : "Slowest current half-mile interval; falls back to the latest speed-zone observation when interval data is unavailable.";
  }
}

function periodCorridorMetrics(routeData, distanceMiles, hours) {
  const endTime = routeEndTime(routeData);
  const startTime = endTime - hours * 3_600_000;
  const trendBuckets = chartSeries.selectDisplayBuckets(routeData?.trend?.buckets, hours, endTime);
  const averageSpeed = weightedAverage(
    trendBuckets,
    bucket => finiteNumber(bucket?.avgCurrentSpeed),
    bucket => finiteNumber(bucket?.sampleCount)
  );
  const zoneBuckets = new Map();
  for (const zone of Array.isArray(routeData?.zones) ? routeData.zones : []) {
    const timestamp = dateMillis(zone?.bucketStart || zone?.polledAt);
    if (!timestamp || timestamp < startTime || timestamp > endTime) continue;
    if (!zoneBuckets.has(timestamp)) zoneBuckets.set(timestamp, []);
    zoneBuckets.get(timestamp).push(zone);
  }
  const travelTimes = [...zoneBuckets.values()]
    .map(zones => estimateSpeedZoneTravelMinutes(zones, distanceMiles))
    .filter(Number.isFinite);
  return {
    averageSpeed,
    averageTravelMinutes: travelTimes.length > 0
      ? travelTimes.reduce((total, minutes) => total + minutes, 0) / travelTimes.length
      : Number.NaN,
    fastestTravelMinutes: travelTimes.length > 0 ? Math.min(...travelTimes) : Number.NaN,
    slowestTravelMinutes: travelTimes.length > 0 ? Math.max(...travelTimes) : Number.NaN,
    slowestAverageZone: slowestAverageZone(routeData?.zones, startTime, endTime)
  };
}

function slowestAverageZone(zones, startTime, endTime) {
  const groups = new Map();
  for (const zone of Array.isArray(zones) ? zones : []) {
    const timestamp = dateMillis(zone?.bucketStart || zone?.polledAt);
    const speed = finiteNumber(zone?.avgCurrentSpeed);
    if (!timestamp || timestamp < startTime || timestamp > endTime || !Number.isFinite(speed)) continue;
    const key = String(zone?.zoneKey || `${zone?.startMileMarker}|${zone?.endMileMarker}`);
    const weight = positiveWeight(zone?.observationCount);
    const group = groups.get(key) || { zone, weightedSpeed: 0, totalWeight: 0 };
    group.weightedSpeed += speed * weight;
    group.totalWeight += weight;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(group => ({
      ...group.zone,
      avgCurrentSpeed: group.totalWeight > 0 ? group.weightedSpeed / group.totalWeight : Number.NaN
    }))
    .filter(zone => Number.isFinite(zone.avgCurrentSpeed))
    .sort((left, right) => left.avgCurrentSpeed - right.avgCurrentSpeed)[0] || null;
}

function weightedAverage(rows, valueSelector, weightSelector) {
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = valueSelector(row);
    if (!Number.isFinite(value)) continue;
    const weight = positiveWeight(weightSelector(row));
    weightedTotal += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedTotal / totalWeight : Number.NaN;
}

function positiveWeight(value) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function estimateCorridorTravelMinutes(flowCells, distanceMiles, averageSpeed) {
  return window.TrafficEstimates.estimateCorridorTravelMinutes(
    flowCells, distanceMiles, averageSpeed, HISTORICAL_MODE || REPLAY_MODE);
}

function dailyTravelTimeRange(routeData, distanceMiles, currentTravelMinutes) {
  const endTime = routeEndTime(routeData);
  const activeDay = chartSeries.denverCalendarDay(endTime);
  const buckets = new Map();
  for (const zone of Array.isArray(routeData?.dailyZones) ? routeData.dailyZones : []) {
    const timestamp = dateMillis(zone?.bucketStart || zone?.polledAt);
    if (!timestamp || timestamp > endTime || chartSeries.denverCalendarDay(timestamp) !== activeDay) continue;
    if (!buckets.has(timestamp)) buckets.set(timestamp, []);
    buckets.get(timestamp).push(zone);
  }
  const travelTimes = [...buckets.values()]
    .map(zones => estimateSpeedZoneTravelMinutes(zones, distanceMiles))
    .filter(Number.isFinite);
  const currentObservedAt = dateMillis(routeData?.summary?.latest?.polledAt);
  if (Number.isFinite(currentTravelMinutes) && currentObservedAt > 0 && currentObservedAt <= endTime
      && chartSeries.denverCalendarDay(currentObservedAt) === activeDay) {
    travelTimes.push(currentTravelMinutes);
  }
  return travelTimes.length > 0
    ? { fastest: Math.min(...travelTimes), slowest: Math.max(...travelTimes) }
    : { fastest: Number.NaN, slowest: Number.NaN };
}

function estimateSpeedZoneTravelMinutes(zones, distanceMiles) {
  return window.TrafficEstimates.estimateSpeedZoneTravelMinutes(zones, distanceMiles, finiteNumber);
}

function slowestCurrentZone(zones, sampleTime) {
  const sampleMillis = dateMillis(sampleTime);
  const candidates = (Array.isArray(zones) ? zones : []).map(zone => ({
    zone,
    timestamp: dateMillis(zone?.bucketStart || zone?.polledAt),
    speed: finiteNumber(zone?.avgCurrentSpeed)
  })).filter(candidate => candidate.timestamp && Number.isFinite(candidate.speed)
    && (!sampleMillis || candidate.timestamp <= sampleMillis + 5 * 60_000));
  const latestTime = Math.max(0, ...candidates.map(candidate => candidate.timestamp));
  if (!latestTime || (!(HISTORICAL_MODE || REPLAY_MODE) && Date.now() - latestTime > 60 * 60_000)) return null;
  return candidates.filter(candidate => candidate.timestamp === latestTime)
    .sort((left, right) => left.speed - right.speed)[0]?.zone || null;
}

function slowestCurrentCell(flowCells) {
  const cells = currentFlowCells(flowCells);
  return cells.sort((left, right) => left.speedMph - right.speedMph)[0]?.cell || null;
}

function currentFlowCells(flowCells) {
  return window.TrafficEstimates.currentFlowCells(flowCells, HISTORICAL_MODE || REPLAY_MODE);
}

function renderIncidentTable(corridor, incidentThreads) {
  const config = CORRIDOR_CONFIG[corridor];
  const tableBody = document.getElementById(config.incidentRowsId);
  const openDetails = new Set([...tableBody.querySelectorAll("details[open]")].map(details => details.dataset.incidentKey));
  tableBody.replaceChildren();
  const combinedView = state.focusedCorridor === "ALL";
  const expanded = state.expandedIncidents.has(corridor);
  const rows = combinedView && !expanded ? incidentThreads.slice(0, 3) : incidentThreads;
  const link = document.querySelector(`[data-incident-toggle="${corridor}"]`);
  if (link) {
    link.textContent = expanded ? "Show fewer ↑" : `See all ${corridor.replace("I", "I-")} incidents (${incidentThreads.length}) →`;
    link.setAttribute("aria-expanded", String(expanded));
  }
  const count = document.getElementById(`${corridor.toLowerCase()}IncidentCount`);
  if (count) {
    const ongoingCount = incidentThreads.filter((incident) => incident.ongoing).length;
    const continuingCount = incidentThreads.filter((incident) => window.IncidentTypes.nextContinuationStart(incident, incident.referenceTime || new Date())).length;
    count.textContent = incidentThreads.length === 0
      ? "No incidents"
      : `${ongoingCount} active${continuingCount ? ` · ${continuingCount} continuing later` : ""} · ${incidentThreads.length} total`;
  }
  if (incidentThreads.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = !state.routeData.has(corridor) || state.routeData.get(corridor)?.incidentsAvailable === false
      ? "Incident feed unavailable. Try refreshing."
      : "No incidents in the selected window.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  for (const incident of rows) {
    const row = document.createElement("tr");
    row.appendChild(buildIncidentNameCell(incident));
    row.appendChild(buildIncidentLocationCell(incident, openDetails.has(incident.key), openDetails.has(`source:${incident.key}`)));
    row.appendChild(buildTextCell(formatShortDateTime(incident.firstSeenAt)));
    row.appendChild(buildLastSeenCell(incident));
    tableBody.appendChild(row);
  }
}

function buildIncidentNameCell(incident) {
  const cell = document.createElement("td");
  const wrapper = document.createElement("span");
  wrapper.className = "incident-name";
  const symbol = window.IncidentTypes.svg(document, incident.type);
  const label = document.createElement("span");
  label.textContent = incident.displayType || incident.type;
  wrapper.append(symbol, label);
  cell.appendChild(wrapper);
  const status = buildIncidentStatus(incident);
  status.className += " incident-row-state";
  cell.appendChild(status);
  return cell;
}

function buildIncidentLocationCell(incident, expanded = false, sourceExpanded = false) {
  const cell = document.createElement("td");
  const location = document.createElement("span");
  location.textContent = incident.locationLabel || "Location unavailable";
  cell.appendChild(location);

  if (!incidentHasDetails(incident)) return cell;
  const details = document.createElement("details");
  details.className = "incident-details";
  details.dataset.incidentKey = incident.key;
  const summary = document.createElement("summary");
  summary.textContent = "Incident details";
  details.appendChild(summary);
  const renderDetails = () => {
    if (!details.open || details.children.length > 1) return;
    for (const detailLine of incidentDetailLines(incident)) {
      const line = document.createElement("span");
      line.textContent = detailLine;
      details.appendChild(line);
    }
    const source = document.createElement("details");
    source.className = "incident-source";
    source.dataset.incidentKey = `source:${incident.key}`;
    const sourceSummary = document.createElement("summary");
    sourceSummary.textContent = incident.description ? `Full ${incident.providerLabel} report` : `${incident.providerLabel} details`;
    source.appendChild(sourceSummary);
    const renderSource = () => {
      if (!source.open || source.children.length > 1) return;
      const lines = [];
      if (incident.sourceUpdatedAt) lines.push(`Updated: ${formatShortDateTime(incident.sourceUpdatedAt)}`);
      if (incident.description) lines.push(incident.description.replace(/\s*•\s*/g, "\n• "));
      for (const text of lines) {
        const line = document.createElement("span"); line.textContent = text; source.appendChild(line);
      }
    };
    source.addEventListener("toggle", renderSource);
    source.open = sourceExpanded; renderSource();
    details.appendChild(source);
  };
  details.addEventListener("toggle", renderDetails);
  details.open = expanded;
  renderDetails();
  cell.appendChild(details);
  return cell;
}

function incidentHasDetails(incident) {
  return Boolean(incident.inferenceDetail || incident.restrictionDetail || incident.impactLabel || (incident.severity && incident.severity.toLowerCase() !== "unknown")
    || (incident.description && incident.description.toLowerCase() !== String(incident.displayType || "").toLowerCase())
    || Number.isFinite(incident.sourceStartMarker) || Number.isFinite(incident.sourceEndMarker)
    || incident.sourceStartedAt || incident.sourceEndedAt || incident.sourceUpdatedAt);
}

function incidentDetailLines(incident) {
  const lines = [];
  if (incident.inferenceDetail) lines.push(incident.inferenceDetail);
  if (incident.restrictionDetail) lines.push(incident.restrictionDetail);
  const markers = [incident.sourceStartMarker, incident.sourceEndMarker].filter(Number.isFinite);
  if (markers.length) {
    const low = Math.min(...markers).toLocaleString(undefined, {maximumFractionDigits: 3});
    const high = Math.max(...markers).toLocaleString(undefined, {maximumFractionDigits: 3});
    lines.push(`MM ${low}${low === high ? "" : `–${high}`}`);
  }
  if (incident.impactLabel) lines.push(incident.impactLabel);
  if (incident.severity && incident.severity.toLowerCase() !== "unknown") {
    lines.push(`${incident.severity.charAt(0).toUpperCase()}${incident.severity.slice(1).toLowerCase()} severity`);
  }
  const context = lines.join(" · ");
  const timing = incidentTimeRange(incident), message = compactIncidentMessage(incident);
  return [context, timing, message].filter(Boolean);
}

function incidentTimeRange(incident) {
  const stamp = date => {
    if (!date) return null;
    const p = Object.fromEntries(displayTimeFormatter({year: "2-digit", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", timeZoneName: "short"})
      .formatToParts(date).map(part => [part.type, part.value]));
    return {date: `${p.month}/${p.day}/${p.year}`, time: `${p.hour}:${p.minute} ${p.dayPeriod}`, zone: p.timeZoneName};
  };
  const start = stamp(incident.sourceStartedAt), end = stamp(incident.sourceEndedAt);
  const label = incident.normalizedStatus === "planned" ? "Scheduled" : "Reported";
  if (!start && !end) return "";
  if (!start || !end) {
    const value = start || end;
    return `${label} ${start ? "start" : "end"}: ${value.date} ${value.time} ${value.zone}`;
  }
  return `${label}: ${start.date} ${start.time}${start.zone === end.zone ? "" : ` ${start.zone}`} → ${start.date === end.date ? "" : `${end.date} `}${end.time} ${end.zone}`;
}

function compactIncidentMessage(incident) {
  const words = text => String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(word => word && !["the", "is", "a", "an", "and"].includes(word));
  const impact = new Set(words(incident.impactLabel));
  const sentences = String(incident.description || "").split(/\bfull\s+schedule(?:\s+below)?\s*:/i)[0]
    .split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(sentence => {
      if (!sentence || /^(?:between|at|from)\b.*(?:\bmile (?:point|marker)\b|\bexit\s+\d|\binterchanges?\b)/i.test(sentence)) return false;
      if (incident.sourceStartedAt && incident.sourceEndedAt && /^(?:starting|until|work begins)\b/i.test(sentence)) return false;
      if (incident.sourceStartedAt && incident.sourceEndedAt && /^scheduled(?: overnight)? work\.?$/i.test(sentence)) return false;
      const content = words(sentence);
      return content.join(" ") !== words(incident.displayType).join(" ") && !content.every(word => impact.has(word));
    }).map(sentence => {
      const reason = sentence.match(/^(.*?)\bclosed\s+(?:due to|for)\s+(.+)$/i);
      return reason && words(`${reason[1]} closed`).every(word => impact.has(word))
        ? reason[2].replace(/^./, letter => letter.toUpperCase()) : sentence;
    });
  const message = sentences.slice(0, 2).join(" "), suffix = sentences.length > 2 ? " …" : "";
  return message.length + suffix.length > 180 ? `${message.slice(0, 177).replace(/\s+\S*$/, "")}…` : message + suffix;
}

function buildTextCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  cell.title = value || "";
  return cell;
}

function buildIncidentStatus(incident) {
  const status = document.createElement("span");
  const nextStart = window.IncidentTypes.nextContinuationStart(incident, incident.referenceTime || new Date());
  const continuing = nextStart || incident.ongoing && window.IncidentTypes.longTermSpan(incident);
  status.className = continuing ? "continuing-pill" : incident.ongoing ? "ongoing-pill" : "incident-status-pill";
  status.textContent = incidentStatusLabel(incident);
  if (nextStart) status.title = `Not active now. Next reported work start: ${formatShortDateTime(nextStart)}. Check the full provider report for restrictions.`;
  else if (continuing) status.title = "Active long-term report spanning at least two days. Restrictions may be intermittent; check the full provider report.";
  return status;
}

function buildLastSeenCell(incident) {
  const cell = document.createElement("td");
  const timestamp = document.createElement("span");
  timestamp.textContent = formatShortDateTime(incident.lastSeenAt);
  cell.appendChild(timestamp);
  const duration = incidentObservedDuration(incident);
  if (duration) {
    const durationLabel = document.createElement("small");
    durationLabel.className = "incident-duration";
    durationLabel.textContent = duration;
    cell.appendChild(durationLabel);
  }
  return cell;
}

function incidentStatusLabel(incident) {
  const status = String(incident.normalizedStatus || "").toLowerCase();
  if (incident.archived || ["cleared", "closed", "ended", "inactive", "resolved", "cancel"].some(value => status.includes(value))) return "Cleared";
  const referenceTime = incident.referenceTime || new Date();
  const nextStart = window.IncidentTypes.nextContinuationStart(incident, referenceTime);
  if (nextStart) return window.IncidentTypes.continuationLabel(nextStart, referenceTime, DISPLAY_TIME_ZONE);
  if (["planned", "scheduled"].some((value) => status.includes(value))
    || incident.sourceStartedAt && incident.sourceStartedAt > referenceTime) return "Planned";
  if (incident.ongoing) return window.IncidentTypes.longTermSpan(incident) ? "Active · Long-term" : "Active";
  if (incident.sourceEndedAt && incident.sourceEndedAt <= referenceTime) {
    return "Cleared";
  }
  return "Last reported";
}

function incidentObservedDuration(incident) {
  const continuing = incident.ongoing && window.IncidentTypes.longTermSpan(incident);
  const reportedTiming = Boolean(incident.sourceStartedAt && incident.sourceEndedAt);
  const start = continuing ? new Date(continuing.start) : reportedTiming ? incident.sourceStartedAt : incident.firstSeenAt;
  const end = continuing ? new Date(continuing.end) : reportedTiming ? incident.sourceEndedAt : incident.lastSeenAt;
  const label = continuing ? continuing.basis : reportedTiming ? incident.normalizedStatus === "planned" ? "Scheduled" : "Reported" : "Observed";
  if (!start || !end || end <= start) return "";
  const totalMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
  if (totalMinutes < 60) return `${label} ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${label} ${hours} hr${minutes ? ` ${minutes} min` : ""}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${label} ${days} day${days === 1 ? "" : "s"}${remainingHours ? ` ${remainingHours} hr` : ""}`;
}

function renderWarning() {
  if (REPLAY_MODE) {
    elements.systemWarningTitle.textContent = "Historical live-feed simulation.";
    elements.systemWarningMessage.textContent = `Looping retained CDOT-era data from ${formatShortDateTime(REPLAY_CONFIG.start)} to ${formatShortDateTime(REPLAY_CONFIG.end)} at ${formatReplayRate(REPLAY_CONFIG.rate)}. Ingestion is off; no TomTom or CDOT requests are being made.`;
    elements.systemWarning.classList.remove("hidden");
    return;
  }
  if (HISTORICAL_MODE) {
    const snapshotTime = latestRouteTime(state.routeData);
    elements.systemWarningTitle.textContent = "Historical snapshot mode.";
    elements.systemWarningMessage.textContent = `Showing retained data from ${formatShortDateTime(snapshotTime)}. Ingestion is off; no TomTom or CDOT requests are being made.`;
    elements.systemWarning.classList.remove("hidden");
    return;
  }
  const warningStatuses = CORRIDOR_IDS
    .map((corridor) => state.routeData.get(corridor)?.summary?.providerStatus)
    .filter((status) => status?.halted || status?.stale);
  const staleSamples = [...state.routeData.values()].some(entry =>
    !entry.summary?.latest?.polledAt || Date.now() - dateMillis(entry.summary.latest.polledAt) > 60 * 60_000);

  if (warningStatuses.length === 0 && !staleSamples) {
    elements.systemWarning.classList.add("hidden");
    return;
  }

  const halted = warningStatuses.some((status) => status.halted);
  elements.systemWarningTitle.textContent = halted ? "Traffic ingestion is paused." : "Traffic data is delayed.";
  elements.systemWarningMessage.textContent = halted
    ? "The provider guard paused ingestion. Existing corridor history remains available."
    : "The latest provider status is older than expected. Displayed data may lag current roadway conditions.";
  elements.systemWarning.classList.remove("hidden");
}

function renderSystemHealth() {
  const apiHealthy = state.health?.apiUp === true;
  const routesHealthy = state.health?.routesUp === true;
  const databaseHealthy = state.health?.databaseUp === true;
  const ingestHealthy = state.health?.operational?.status === "HEALTHY";
  const retainedDataMode = HISTORICAL_MODE || REPLAY_MODE;
  window.HealthMonitor?.setRetained(retainedDataMode || DEMO_MODE);
  const allHealthy = !retainedDataMode && apiHealthy && routesHealthy && databaseHealthy && ingestHealthy && !state.health?.partial;

  setServiceStatus(elements.routesServiceStatus, routesHealthy ? "Catalog ready" : "Unavailable", routesHealthy);
  elements.routesServiceStatus.title = "Stored route catalog availability; not a routes-service liveness probe.";
  setServiceStatus(elements.ingestServiceStatus, retainedDataMode ? "Off for replay" : ingestHealthy ? "Feeds current" : "Unconfirmed", !retainedDataMode && ingestHealthy);
  elements.ingestServiceStatus.title = "Flow, incident and provider checks from the operational status API.";
  setServiceStatus(elements.apiServiceStatus, apiHealthy ? "Healthy" : "Unavailable", apiHealthy);
  setServiceStatus(elements.databaseStatus, databaseHealthy ? "Connected" : "Unconfirmed", databaseHealthy);
  setServiceStatus(elements.systemHeadline, REPLAY_MODE ? "Historical Live Replay" : HISTORICAL_MODE ? "Historical Data Replay" : allHealthy ? "All Data Checks Passing" : "Some Data Checks Unavailable", allHealthy);
  setServiceStatus(elements.pipelineStatus, REPLAY_MODE ? "Replaying" : HISTORICAL_MODE ? "Historical" : ingestHealthy ? "Live" : "Unconfirmed", !retainedDataMode && ingestHealthy);

}

function setServiceStatus(element, label, healthy) {
  element.textContent = label;
  element.dataset.healthState = healthy ? "healthy" : "attention";
  element.style.color = healthy ? "var(--forest-soft)" : "var(--gold-data)";
}

function drawAllCharts() {
  const summaries = [];
  if (zoneFinderActive()) {
    window.CorridorMapPanel?.setZones?.(visibleSpeedZoneGroups(state.focusedCorridor), state.selectedZoneKey, selectSpeedZone);
  }
  const visibleCorridors = state.focusedCorridor === "ALL" ? CORRIDOR_IDS : [state.focusedCorridor];
  for (const corridor of visibleCorridors) {
    const routeData = chartRouteData(corridor);
    const canvas = document.getElementById(CORRIDOR_CONFIG[corridor].chartId);
    const liveLabel = document.getElementById(`${corridor.toLowerCase()}LiveDot`);
    if (liveLabel) liveLabel.hidden = !hasLiveChartEdge(routeData);
    if (window.ContinuousHistory?.active && chartHistory.endTime !== null
        && window.ContinuousHistory.paint(canvas, corridor)) {
      summaries.push(`${CORRIDOR_CONFIG[corridor].label}: retained observations. ${elements.historyWindow.textContent}.`);
      continue;
    }
    if (state.chartView === "zones" && state.focusedCorridor === corridor) {
      chartPainter.drawZoneChart(canvas, corridor, routeData);
    } else {
      canvas.closest?.(".chart-lane")?.style.removeProperty("--chart-height");
      chartPainter.drawCorridorChart(canvas, corridor, routeData);
    }
    if (routeData) {
      if (state.chartView === "zones" && state.focusedCorridor === corridor) {
        const groups = chartSeries.groupZoneSeries(
          routeData?.zones || [],
          state.selectedHours,
          chartEndTime(routeData),
          routeData?.zoneBaseline?.zones || []
        );
        summaries.push(`${CORRIDOR_CONFIG[corridor].label} speed zones: ${groups
          .map(group => `${group.referenceLabel}, ${group.marker}, posted limit ${formatMetricNumber(group.postedSpeedMph, 0)} miles per hour, observed speed ${formatMetricNumber(group.latestSpeed, 0)} miles per hour`)
          .join("; ")}.`);
      } else if (chartHistory.endTime !== null) {
        const count = chartSeries.selectDisplayBuckets(routeData.trend?.buckets || [], state.selectedHours, chartEndTime(routeData)).length;
        const description = routeData.chartUnavailable ? "historical observations unavailable; choose Retry or Current"
          : `${count} hourly observations in the historical window`;
        summaries.push(`${CORRIDOR_CONFIG[corridor].label}: ${description}. ${elements.historyWindow.textContent}.`);
      } else {
        const latestSpeed = finiteNumber(routeData.summary?.latest?.avgCurrentSpeed);
        summaries.push(`${CORRIDOR_CONFIG[corridor].label} is ${formatMetricNumber(latestSpeed, 0)} miles per hour with ${routeData.incidentThreads.filter((thread) => thread.ongoing).length} active incidents.`);
      }
    }
  }
  const summary = summaries.join(" ");
  if (elements.chartSummary.textContent !== summary) elements.chartSummary.textContent = summary;
  renderPipelineViewSamples();
}

function renderPipelineViewSamples() {
  const number = document.getElementById("pipelineViewSamples"), note = document.getElementById("pipelineViewNote");
  if (!number || !note || window.ContinuousHistory?.moving) return;
  const corridors = state.focusedCorridor === "ALL" ? CORRIDOR_IDS : [state.focusedCorridor];
  let count = 0, unavailable = false;
  for (const corridor of corridors) {
    const route = chartRouteData(corridor);
    if (!route || route.chartUnavailable) { unavailable = true; continue; }
    const end = chartEndTime(route), start = end - state.selectedHours * 3_600_000;
    const samples = state.chartView === "zones" && state.focusedCorridor === corridor
      ? (route.layoutGroups || chartSeries.groupZoneSeries(route.zones || [], state.selectedHours, end, route.zoneBaseline?.zones || [])).flatMap(group => group.samples)
      : route.continuousSamples || chartSeries.buildCurrentSpeedSeries(route.trend?.buckets || [], state.selectedHours <= 24 ? route.history?.samples || [] : [], state.selectedHours, end);
    for (const point of samples) if (!point.isBoundary && Number.isFinite(point.speed)
      && point.timestamp >= start && point.timestamp <= end) count++;
  }
  number.textContent = unavailable ? "—" : count.toLocaleString();
  note.textContent = `${state.focusedCorridor === "ALL" ? "Both" : state.focusedCorridor.replace("I", "I-")}${state.chartView === "zones" ? " zones" : ""} · ${state.selectedHours <= 24 ? `${state.selectedHours}H` : `${state.selectedHours / 24}D`}`;
}

function hasLiveChartEdge(routeData) {
  const latest = routeData?.summary?.latest;
  const observedAt = dateMillis(latest?.polledAt);
  return chartHistory.endTime === null && !HISTORICAL_MODE && !REPLAY_MODE && !DEMO_MODE
    && !routeData?.chartUnavailable && Boolean(observedAt)
    && Number.isFinite(finiteNumber(latest?.avgCurrentSpeed))
    && Date.now() - observedAt <= 60 * 60_000;
}

function sizeCanvas(canvas) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(canvas.clientWidth || bounds.width));
  const height = Math.max(1, Math.round(canvas.clientHeight || bounds.height));
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const targetWidth = Math.round(width * pixelRatio);
  const targetHeight = Math.round(height * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width, height };
}

function drawEmptyChart(context, dimensions, message) {
  const colors = chartColors();
  context.save();
  context.fillStyle = colors.muted;
  context.font = "12px Archivo, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(message, dimensions.width / 2, dimensions.height / 2);
  context.restore();
}

function chartColors() {
  const styles = window.getComputedStyle(document.documentElement);
  return {
    "--gold": styles.getPropertyValue("--gold").trim() || "#d5a021",
    "--gold-data": styles.getPropertyValue("--gold-data").trim() || "#ba8500",
    "--rose": styles.getPropertyValue("--rose").trim() || "#764248",
    forest: styles.getPropertyValue("--forest-soft").trim() || "#0f5a34",
    ink: styles.getPropertyValue("--ink").trim() || "#0b2413",
    weather: styles.getPropertyValue("--incident-weather").trim() || "#277098",
    muted: styles.getPropertyValue("--muted").trim() || "#526056",
    panel: styles.getPropertyValue("--panel").trim() || "#fffef7",
    grid: document.documentElement.dataset.theme === "dark" ? "rgba(211,193,195,.20)" : "rgba(118,66,72,.22)",
    gridStrong: document.documentElement.dataset.theme === "dark" ? "rgba(224,173,53,.34)" : "rgba(118,66,72,.34)",
    band: document.documentElement.dataset.theme === "dark" ? "rgba(118,66,72,.28)" : "rgba(211,193,195,.34)"
  };
}

function incidentLegendTypeOrder() {
  const recent = new Map();
  const corridors = state.focusedCorridor === "ALL" ? CORRIDOR_IDS : [state.focusedCorridor];
  for (const corridor of corridors) {
    for (const incident of state.routeData.get(corridor)?.incidentThreads || []) {
      if (!window.IncidentTypes.types[incident.type]) continue;
      const firstSeenAt = dateMillis(incident.firstSeenAt);
      const lastSeenAt = dateMillis(incident.lastSeenAt) || firstSeenAt;
      const previous = recent.get(incident.type);
      if (!previous || lastSeenAt > previous.lastSeenAt
          || (lastSeenAt === previous.lastSeenAt && firstSeenAt > previous.firstSeenAt)) {
        recent.set(incident.type, { firstSeenAt, lastSeenAt });
      }
    }
  }
  return Object.keys(window.IncidentTypes.types)
    .filter(type => type !== "Weather" || recent.has(type))
    .sort((left, right) => Number(recent.has(right)) - Number(recent.has(left))
      || (recent.get(right)?.lastSeenAt || 0) - (recent.get(left)?.lastSeenAt || 0)
      || (recent.get(right)?.firstSeenAt || 0) - (recent.get(left)?.firstSeenAt || 0));
}

function renderIncidentLegend() {
  const items = document.getElementById("incidentLegendItems");
  if (!items) return;
  items.replaceChildren();
  incidentLegendTypeOrder().forEach(type => {
    const definition = window.IncidentTypes.icon(type);
    const item = document.createElement("span");
    item.dataset.incidentType = type;
    item.appendChild(window.IncidentTypes.svg(document, type));
    const label = document.createElement("span");
    label.textContent = definition.label;
    item.appendChild(label);
    items.appendChild(item);
  });
  setIncidentLegendExpanded(state.incidentLegendExpanded);
}

function setIncidentLegendExpanded(expanded) {
  state.incidentLegendExpanded = expanded;
  const items = document.getElementById("incidentLegendItems");
  if (items) Array.from(items.children).forEach((item, index) => { item.hidden = !expanded && index >= 8; });
  const toggle = document.getElementById("incidentLegendToggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Fewer types" : "More types";
  }
}

function formatShortDateTime(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return "—";
  return displayTimeFormatter({
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function formatClockTime(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return "—";
  return displayTimeFormatter({
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function formatMetricNumber(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatMileMarker(value) {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatZoneMileMarkerRange(zone) {
  const start = finiteNumber(zone?.startMileMarker);
  const end = finiteNumber(zone?.endMileMarker);
  if (!Number.isFinite(start) && !Number.isFinite(end)) return "";
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return `MM ${formatMileMarker(Number.isFinite(start) ? start : end)}`;
  }
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return Math.abs(upper - lower) < 0.05
    ? `MM ${formatMileMarker(lower)}`
    : `MM ${formatMileMarker(lower)}–${formatMileMarker(upper)}`;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateMillis(value) {
  const date = parseDate(value);
  return date ? date.getTime() : 0;
}

function routeEndTime(routeData) {
  if (!(HISTORICAL_MODE || REPLAY_MODE)) return Date.now();
  return dateMillis(routeData?.dataAnchor || routeData?.summary?.latest?.polledAt) || Date.now();
}

function latestRouteTime(routeData) {
  const values = routeData instanceof Map ? [...routeData.values()] : [];
  return values
    .map((entry) => parseDate(entry?.dataAnchor || entry?.summary?.latest?.polledAt))
    .filter(Boolean)
    .sort((left, right) => right - left)[0] || null;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setStatus(message, error = false) {
  elements.statusText.textContent = message;
  elements.statusText.title = message;
  elements.statusText.style.color = error ? "var(--rose)" : "var(--muted)";
}

function buildDemoDashboardSnapshots() {
  const now = new Date();
  return new Map(DASHBOARD_RANGE_HOURS.map(hours => [hours, buildDemoDashboardData(hours, now)]));
}

function buildDemoDashboardData(selectedHours = state.selectedHours, now = new Date()) {
  const routeData = new Map();
  routeData.set("I25", buildDemoRouteData("I25", now, selectedHours));
  routeData.set("I70", buildDemoRouteData("I70", now, selectedHours));
  return {
    routeData,
    corridorFeatures: new Map(),
    health: { apiUp: true, routesUp: true, databaseUp: true, operational: { status: "HEALTHY" }, partial: false, failures: [] }
  };
}

function buildDemoRouteData(corridor, now, selectedHours = state.selectedHours) {
  const config = corridor === "I25"
    ? { current: 61, minimum: 38, baseline: 66, hotspot: "Northglenn—Thornton", startMileMarker: 221, endMileMarker: 225 }
    : { current: 54, minimum: 31, baseline: 62, hotspot: "Floyd Hill—Idaho Springs", startMileMarker: 241, endMileMarker: 248 };
  const totalHours = selectedHours + 169;
  const buckets = [];
  for (let hourOffset = totalHours - 1; hourOffset >= 0; hourOffset -= 1) {
    const bucketTime = new Date(now.getTime() - hourOffset * 3_600_000);
    const localHour = Number(new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Denver"
    }).format(bucketTime));
    const morningDrop = Math.exp(-Math.pow((localHour - 8) / 2.3, 2)) * (corridor === "I25" ? 17 : 11);
    const eveningDrop = Math.exp(-Math.pow((localHour - 17) / 2.7, 2)) * (corridor === "I25" ? 14 : 18);
    const wave = Math.sin(hourOffset / 4.4) * 2.2;
    const speed = Math.max(18, config.baseline - morningDrop - eveningDrop + wave);
    buckets.push({
      bucketStart: bucketTime.toISOString(),
      sampleCount: 58 + (hourOffset % 4),
      avgCurrentSpeed: hourOffset === 0 ? config.current : Number(speed.toFixed(1)),
      avgFreeflowSpeed: config.baseline + 4,
      minCurrentSpeed: Math.max(15, speed - 10),
      totalIncidents: corridor === "I25" ? 3 : 2
    });
  }

  const incidentThreads = corridor === "I25"
    ? [
      demoIncident("Crash", "MP 221 · Near Northglenn", now, 230, 12, true),
      demoIncident("Disabled Vehicle", "MP 225 · Near Thornton", now, 205, 6, true),
      demoIncident("Construction", "MP 257 · Near Loveland", now, 720, 4, true)
    ]
    : [
      demoIncident("Disabled Vehicle", "MP 216 · Near Loveland Pass", now, 320, 290, false),
      demoIncident("Closure", "MP 232 · Near Silver Plume", now, 680, 8, true),
      demoIncident("Construction", "MP 244 · Near Idaho Springs", now, 520, 5, true)
    ];
  const zoneDefinitions = corridor === "I25"
    ? [
      { key: "I25-208-221_5", order: 0, start: 208, end: 221.5, posted: 55, baseline: 53, offset: -23 },
      { key: "I25-221_5-225_552", order: 1, start: 221.5, end: 225.552, posted: 65, baseline: 64, offset: 0 },
      { key: "I25-225_552-271", order: 2, start: 225.552, end: 271, posted: 75, baseline: 70, offset: 6 }
    ]
    : [
      { key: "I70-206-213_1", order: 0, start: 206, end: 213.1, posted: 60, baseline: 57, offset: -23 },
      { key: "I70-213_1-216", order: 1, start: 213.1, end: 216, posted: 50, baseline: 48, offset: -2 },
      { key: "I70-216-236_918", order: 2, start: 216, end: 236.918, posted: 65, baseline: 61, offset: 1 },
      { key: "I70-236_918-241_907", order: 3, start: 236.918, end: 241.907, posted: 60, baseline: 57, offset: -3 },
      { key: "I70-241_907-244_857", order: 4, start: 241.907, end: 244.857, posted: 55, baseline: 48, offset: -10 },
      { key: "I70-244_857-259", order: 5, start: 244.857, end: 259, posted: 65, baseline: 61, offset: -4 },
      { key: "I70-259-270_274", order: 6, start: 259, end: 270.274, posted: 65, baseline: 60, offset: -12 },
      { key: "I70-270_274-274", order: 7, start: 270.274, end: 274, posted: 55, baseline: 52, offset: -6 }
    ];
  const zones = zoneDefinitions.flatMap(zone => buckets.map(bucket => ({
    zoneKey: zone.key,
    zoneOrder: zone.order,
    zoneLabel: formatZoneMileMarkerRange({ startMileMarker: zone.start, endMileMarker: zone.end }),
    zoneDescription: config.hotspot,
    startMileMarker: zone.start,
    endMileMarker: zone.end,
    postedSpeedMph: zone.posted,
    bucketStart: bucket.bucketStart,
    avgCurrentSpeed: Math.max(15, finiteNumber(bucket.avgCurrentSpeed) + zone.offset),
    observationCount: finiteNumber(bucket.sampleCount)
  })));
  const zoneBaseline = { zones: zoneDefinitions.map(zone => ({
    zoneKey: zone.key,
    zoneOrder: zone.order,
    startMileMarker: zone.start,
    endMileMarker: zone.end,
    postedSpeedMph: zone.posted,
    profiles: demoBaselineProfiles(zone.baseline)
  })) };

  return {
    corridor,
    summary: {
      generatedAt: now.toISOString(),
      sampleAgeMinutes: 1,
      providerStatus: {
        state: "HEALTHY",
        halted: false,
        stale: false,
        lastSuccessAt: new Date(now.getTime() - 38_000).toISOString()
      },
      latest: {
        corridor,
        avgCurrentSpeed: config.current,
        avgFreeflowSpeed: config.baseline + 4,
        minCurrentSpeed: config.minimum,
        polledAt: new Date(now.getTime() - 38_000).toISOString(),
        sourceMode: "tile"
      },
      topHotspot: { referenceLabel: config.hotspot }
    },
    trend: { corridor, windowHours: totalHours, returned: buckets.length, buckets },
    zones,
    zoneBaseline,
    dailyZones: zones,
    incidentsAvailable: true,
    incidentThreads
  };
}

function demoBaselineProfiles(baseSpeed) {
  return Array.from({ length: 7 * 24 }, (_, index) => {
    const hour = index % 24;
    const morningDrop = Math.exp(-Math.pow((hour - 8) / 2.6, 2)) * 5;
    const eveningDrop = Math.exp(-Math.pow((hour - 17) / 2.9, 2)) * 4;
    return {
      dayOfWeek: Math.floor(index / 24) + 1,
      hourOfDay: hour,
      sourceProfile: "DEMO",
      sampleCount: 13,
      effectiveSampleSize: 9.5,
      meanSpeed: Math.max(15, baseSpeed - morningDrop - eveningDrop),
      standardDeviation: 3,
      coverageOneSigma: 68.5,
      coverageTwoSigma: 94.5,
      coverageThreeSigma: 99.1
    };
  });
}

function demoIncident(type, locationLabel, now, firstMinutesAgo, lastMinutesAgo, ongoing) {
  return {
    key: `${type}|${locationLabel}`,
    type,
    locationLabel,
    firstSeenAt: new Date(now.getTime() - firstMinutesAgo * 60_000),
    lastSeenAt: new Date(now.getTime() - lastMinutesAgo * 60_000),
    archived: !ongoing,
    normalizedStatus: ongoing ? "active" : "cleared",
    sourceUpdatedAt: new Date(now.getTime() - lastMinutesAgo * 60_000),
    ongoing
  };
}
