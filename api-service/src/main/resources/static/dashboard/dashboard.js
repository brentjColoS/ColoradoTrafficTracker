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
  mapExpanded: false,
  variableSpeedHistoricalView: false,
  limitDetailsPending: false,
  selectedZoneKey: null,
  replayStartedAt: Date.now(),
  routeData: new Map(),
  corridorFeatures: new Map(),
  snapshots: new Map(),
  readSections: new Map(),
  syncController: null,
  lastSyncedAt: null,
  health: null,
  refreshing: false,
  refreshPending: false,
  cacheRefreshTimer: null,
  cacheRefreshRetries: 0,
  manualRefreshTimer: null,
  expandedIncidents: new Set(),
  incidentLegendExpanded: false,
  incidentTypeFilters: new Set(),
  chartIncidentSelection: null,
  refreshTimer: null,
  resizeTimer: null
};

let pendingIncidentPageScroll = 0;
let incidentPageScrollScheduled = false;
let zoneLayoutRevision = 0;
let zoneLayoutAnimations = [];
let zoneMapSizeMotion = null;
let mapLayoutGhost = null;
let mapControlMotion = null;
let i25TraceMotion = null;
let mapPositioning = null;
let pendingZoneLayoutBefore = null;
let mapViewChanging = false;
let incidentFold = null;

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

const incidentTable = window.DashboardIncidentTable.create({
  document, types: window.IncidentTypes, formatShortDateTime, displayTimeFormatter, displayTimeZone: DISPLAY_TIME_ZONE
});

const chartPainter = window.DashboardChartPainter.create({
  sizeCanvas: (...args) => sizeCanvas(...args),
  chartSeries,
  drawEmptyChart: (...args) => drawEmptyChart(...args),
  chartColors: (...args) => chartColors(...args),
  chartAxis,
  CORRIDOR_CONFIG,
  finiteNumber,
  formatMetricNumber,
  dateMillis,
  displayTimeFormatter,
  Path2D,
  types: window.IncidentTypes
});

const liveTransition = window.DashboardLiveTransition?.create({draw:()=>drawAllCharts(true),
  requestFrame:callback=>window.requestAnimationFrame(callback),cancelFrame:frame=>window.cancelAnimationFrame(frame),
  now:()=>window.performance?.now() ?? Date.now()});
const latestChartObservations = new WeakMap();
initializeDashboard();

async function initializeDashboard() {
  initializeTheme();
  initializeCorridorFocus();
  initializeControls();
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
    if (document.hidden) {
      if (zoneLayoutAnimations.length || zoneMapSizeMotion || mapPositioning || mapControlMotion) stopZoneLayoutMotion();
      state.syncController?.abort(); state.zoneBaselineController?.abort();
      window.clearTimeout(state.cacheRefreshTimer); state.cacheRefreshTimer = null;
    }
    else if (!HISTORICAL_MODE && (!state.lastSyncedAt || Date.now() - state.lastSyncedAt.getTime() >= AUTO_REFRESH_MS)) {
      void refreshDashboard({ queueIfBusy: true });
    }
  });
  window.addEventListener("pagehide", () => {
    if (zoneLayoutAnimations.length || zoneMapSizeMotion || mapPositioning || mapControlMotion) stopZoneLayoutMotion();
    liveTransition?.reset();
    state.syncController?.abort(); state.zoneBaselineController?.abort();
    window.clearTimeout(state.cacheRefreshTimer); state.cacheRefreshTimer = null;
  });
}

function initializeTheme() {
  window.BrowserTheme.initialize({
    toggle: elements.themeToggle,
    icon: elements.themeIcon,
    onChange(theme) {
      window.CorridorMapPanel?.setTheme(theme);
      if (state.routeData.size > 0) window.requestAnimationFrame(drawAllCharts);
    }
  });
}

function initializeCorridorFocus() {
  const requestedCorridor = String(new URLSearchParams(window.location.search).get("corridor") || "ALL").toUpperCase();
  const initialFocus = CORRIDOR_IDS.includes(requestedCorridor) ? requestedCorridor : "ALL";
  applyCorridorFocus(initialFocus, false);
}

function initializeControls() {
  document.getElementById("zoneMapExpand")?.addEventListener("click", toggleZoneMapSize);
  if (typeof window.ResizeObserver === "function") {
    let frame = null;
    const observer = new window.ResizeObserver(entries => {
      if (mapViewChanging) return;
      if (!state.mapExpanded && !entries.some(entry=>entry.target.classList.contains("chart-canvas-wrap"))) return;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (mapViewChanging) return;
        updateExpandedZoneMapSize(); drawAllCharts();
      });
    });
    for (const corridor of CORRIDOR_IDS) {
      const wrap = document.getElementById(CORRIDOR_CONFIG[corridor].chartId)?.closest(".chart-canvas-wrap");
      if (wrap) observer.observe(wrap);
    }
    for (const selector of ["#comparisonPanel",".comparison-header"]) {
      const node = document.querySelector(selector); if (node) observer.observe(node);
    }
    window.addEventListener("pagehide", event => {
      if (!event.persisted) { observer.disconnect(); window.cancelAnimationFrame(frame); }
    });
  }
  document.getElementById("i70VariableLimitBadge")?.addEventListener("click", () => {
    if (!renderVariableSpeedNotice()?.changed.length) return;
    state.limitDetailsPending = true;
    state.zoneFinder = false;
    state.selectedZoneKey = null;
    applyCorridorFocus("I70", true);
    document.getElementById("corridorMapPanel")?.scrollIntoView?.({block:"center",behavior:"instant"});
  });
  document.getElementById("incidentLegendToggle")?.addEventListener("click", () => {
    setIncidentLegendExpanded(!state.incidentLegendExpanded);
  });
  document.getElementById("incidentLegendItems")?.addEventListener("click", event => {
    const type = event.target.closest("button[data-incident-type]")?.dataset.incidentType;
    if (!window.IncidentTypes.types[type]) return;
    state.chartIncidentSelection = null;
    if (state.incidentTypeFilters.has(type)) state.incidentTypeFilters.delete(type);
    else state.incidentTypeFilters.add(type);
    updateIncidentTypeFilterButtons();
    setIncidentLegendExpanded(state.incidentLegendExpanded);
    for (const corridor of CORRIDOR_IDS) renderIncidentTable(corridor,state.routeData.get(corridor)?.incidentThreads || []);
  });
  initializeHistoryControls();
  updateReferenceBandControl();
  elements.corridorControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-corridor-focus]");
    if (!button || button.disabled || button.dataset.corridorFocus === state.focusedCorridor) return;
    applyCorridorFocus(button.dataset.corridorFocus, true);
  });

  elements.refreshButton.addEventListener("click", requestManualRefresh);

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
      const expand = !state.expandedIncidents.has(corridor);
      for (const route of CORRIDOR_IDS) {
        if (expand) state.expandedIncidents.add(route);
        else state.expandedIncidents.delete(route);
        renderIncidentTable(route, state.routeData.get(route)?.incidentThreads || []);
      }
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
    if (zoneLayoutAnimations.length || zoneMapSizeMotion || mapPositioning || mapControlMotion) stopZoneLayoutMotion();
    if (state.mapExpanded) updateZoneMapLayout();
    updateExpandedZoneMapSize();
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
    ? "Share of matching past readings within the shaded band."
    : "Expected coverage; measured historical coverage is unavailable.";
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
    state.chartIncidentSelection = null;
    state.mapExpanded = false;
    resetCorridorHistory();
    state.selectedZoneKey = null;
    state.zoneFinder = false;
  }
  state.focusedCorridor = normalized;
  if (normalized !== "I70") state.limitDetailsPending = false;
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
  const view = requestedView === "zones" && state.focusedCorridor !== "ALL" ? "zones" : "overall";
  const motion = prepareMapViewTransition(view !== state.chartView && state.focusedCorridor !== 'ALL');
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
  finishMapViewTransition(motion);
}

function speedZoneViewActive() {
  return state.chartView === "zones" && state.focusedCorridor !== "ALL";
}

function zoneFinderActive() {
  return state.zoneFinder && speedZoneViewActive();
}

function zoneMapInlineActive() {
  return speedZoneViewActive() && (state.zoneFinder || state.mapExpanded);
}

function setZoneFinder(enabled) {
  const fold = state.focusedCorridor === 'I25' && speedZoneViewActive() && state.mapExpanded
    && Boolean(enabled) !== state.zoneFinder;
  const stageBefore = speedZoneViewActive() && state.mapExpanded
    ? document.querySelector('.corridor-map-stage')?.getBoundingClientRect().height : null;
  const motion = prepareMapViewTransition(true,true);
  if (fold && mapViewChanging && !window.matchMedia?.('(max-width: 64rem)').matches) {
    const node=document.getElementById('recent-incidents');
    const entry=motion.before.find(entry=>entry.node===node),bounds=entry.bounds;
    incidentFold={node,entering:Boolean(enabled),visibleHeight:entry.visibleHeight,ghost:createMapLayoutGhost(node,bounds),bounds};
  }
  state.zoneFinder = Boolean(enabled) && state.chartView === "zones" && state.focusedCorridor !== "ALL";
  if (!state.zoneFinder) state.selectedZoneKey = null;
  updateZoneMapLayout();
  renderFocusedCorridorMap();
  finishMapViewTransition(motion,stageBefore);
}

function prepareMapViewTransition(changing = true, verticalIncidents = false) {
  const before = changing ? pendingZoneLayoutBefore || captureZoneMapTransition() : [];
  stopZoneLayoutMotion();
  pendingZoneLayoutBefore = before;
  mapViewChanging = before.length > 0;
  document.getElementById('comparisonPanel').classList.toggle('map-view-changing',mapViewChanging);
  if (mapViewChanging) window.CorridorMapPanel?.beginResize();
  if (mapViewChanging && state.focusedCorridor==='I70' && state.mapExpanded
      && !window.matchMedia?.('(max-width: 64rem)').matches) {
    const node=document.getElementById('recent-incidents'),entry=before.find(entry=>entry.node===node),bounds=entry.bounds;
    incidentFold={node,bounds,visibleHeight:entry.visibleHeight,slide:true,vertical:verticalIncidents,fromFinder:zoneFinderActive(),ghost:createMapLayoutGhost(node,bounds)};
  }
  return {before,revision:zoneLayoutRevision};
}

function finishMapViewTransition({before,revision}, stageBefore = null) {
  window.requestAnimationFrame(()=>{
    if (revision !== zoneLayoutRevision) return;
    pendingZoneLayoutBefore = null;
    updateExpandedZoneMapSize();
    drawAllCharts();
    if (stageBefore != null) animateZoneMapFormat(stageBefore,before.find(entry=>entry.node.id==='corridorMapPanel')?.bounds.height);
    animateZoneLayout(before,undefined,false,state.mapExpanded ? 640 : undefined);
    finishMapViewMotion();
  });
}

function finishMapViewMotion() {
  if (!mapViewChanging || zoneLayoutAnimations.length) return;
  mapViewChanging = false;
  document.getElementById('comparisonPanel').classList.remove('map-view-changing','zone-map-sizing');
  updateExpandedZoneMapSize();
  window.CorridorMapPanel?.resize();
  window.requestAnimationFrame(drawAllCharts);
}

function captureZoneLayout() {
  if ((window.BrowserMotion?.media() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)"))?.matches) return [];
  const canvas = document.getElementById(CORRIDOR_CONFIG[state.focusedCorridor]?.chartId);
  const shield = canvas?.closest?.(".chart-lane")?.querySelector?.(".lane-label");
  const collapseShield = !window.matchMedia?.("(max-width: 48rem)").matches;
  return [canvas?.closest?.(".chart-canvas-wrap"), shield, document.getElementById("corridorMapPanel")]
    .filter(node => node?.animate && !node.hidden)
    .map(node => ({node, bounds: node.getBoundingClientRect(), controlBounds:node.id === "corridorMapPanel"
      ? document.getElementById("zoneMapExpand")?.getBoundingClientRect?.() : null, shield: node === shield && collapseShield,
      visible: node !== shield || !zoneMapInlineActive() || !collapseShield}));
}

function visiblePanelHeight(node,bounds) {
  // Preserve the visible slice before cancelling an interrupted handoff.
  const clip=getComputedStyle(node).clipPath || 'none';
  if (!clip.startsWith('inset(')) return bounds.height;
  const values=(clip.match(/[-+\d.e]+px/gi)||[]).map(parseFloat);
  const inset=(values[0]||0)+(values.length>2?values[2]:values[0]||0);
  const scale=bounds.height/(node.offsetHeight || bounds.height || 1);
  return Math.max(0,Math.min(bounds.height,bounds.height-inset*scale));
}

function captureZoneMapTransition() {
  if ((window.BrowserMotion?.media() ?? window.matchMedia?.('(prefers-reduced-motion: reduce)'))?.matches) return [];
  return [...captureZoneLayout(), ...['recent-incidents','system-health','under-the-hood']
    .map(id=>document.getElementById(id)).filter(node=>node?.animate && !node.hidden)
    .map(node=>{
      const bounds=node.getBoundingClientRect();
      return {node,bounds,visible:true,follower:true,
        visibleHeight:node.id==='recent-incidents' ? visiblePanelHeight(node,bounds) : bounds.height};
    })];
}

function animateZoneMapFormat(before,parentBefore) {
  if (!mapViewChanging) return;
  const panel=document.getElementById('corridorMapPanel'),stage=panel.querySelector('.corridor-map-stage');
  const height=stage.getBoundingClientRect().height;
  const parentHeight=panel.getBoundingClientRect().height,delta=before*parentHeight/(parentBefore || parentHeight)-height;
  if (!height || Math.abs(delta)<1) return;
  for (const node of [stage,...panel.querySelectorAll('.corridor-map-stage ~ *')].filter(node=>!node.hidden)) {
    const transform=node===stage ? `scaleY(${1+delta/height})` : `translateY(${delta}px)`;
    node.classList.add('zone-layout-moving');
    const animation=node.animate([{transform,transformOrigin:'top left'},{transform:'none',transformOrigin:'top left'}],
      {duration:640,easing:'cubic-bezier(0.22, 1, 0.36, 1)'});
    const motion={node,animation};zoneLayoutAnimations.push(motion);
    animation.onfinish=()=>{
      if (!zoneLayoutAnimations.includes(motion)) return;
      node.classList.remove('zone-layout-moving');zoneLayoutAnimations=zoneLayoutAnimations.filter(item=>item!==motion);
      finishMapViewMotion();
    };
  }
}

function stopZoneLayoutMotion() {
  const resizing=mapViewChanging || zoneLayoutAnimations.length>0 || zoneMapSizeMotion || mapControlMotion;
  mapPositioning?.cancel();
  i25TraceMotion?.clear();i25TraceMotion=null;
  zoneLayoutRevision += 1;
  pendingZoneLayoutBefore = null;
  mapViewChanging = false;
  document.getElementById('comparisonPanel').classList.remove('map-view-changing','zone-map-sizing');
  if (zoneMapSizeMotion) { zoneMapSizeMotion.cancel(); zoneMapSizeMotion=null; }
  for (const {node, animation} of zoneLayoutAnimations) {
    animation.cancel();
    node.classList.remove("zone-layout-moving");
  }
  zoneLayoutAnimations = [];
  clearIncidentFold();
  clearMapControlMotion();
  clearMapLayoutGhost();
  if (resizing) window.CorridorMapPanel?.resize?.();
}

function clearIncidentFold() {
  incidentFold=null;
  clearMapLayoutGhost();
}

function clearMapControlMotion() {
  if (!mapControlMotion) return;
  const {button,animation,style} = mapControlMotion;
  mapControlMotion = null;
  animation.cancel();button.classList.remove('zone-layout-moving');
  if (style === null) button.removeAttribute("style"); else button.setAttribute("style",style);
}

function mapControlFrames(frames,inset) {
  // Counter-scale the native control without measuring its header on every frame.
  const result=[];
  for(let index=1;index<frames.length;index++) {
    const first=frames[index-1],last=frames[index];
    const curve=first.easing?.match(/cubic-bezier\(([^)]+)\)/)?.[1].split(',').map(Number);
    const samples=first.x===last.x && first.y===last.y ? 1 : 64;
    for(let step=index===1?0:1;step<=samples;step++) {
      const progress=step/samples;let eased=progress;
      if(curve && progress>0 && progress<1) {
        let low=0,high=1,t=progress;
        for(let iteration=0;iteration<16;iteration++) {
          t=(low+high)/2;
          const x=3*(1-t)*(1-t)*t*curve[0]+3*(1-t)*t*t*curve[2]+t*t*t;
          if(x<progress)low=t;else high=t;
        }
        eased=3*(1-t)*(1-t)*t*curve[1]+3*(1-t)*t*t*curve[3]+t*t*t;
      }
      const x=first.x+(last.x-first.x)*eased,y=first.y+(last.y-first.y)*eased;
      result.push({offset:first.offset+(last.offset-first.offset)*progress,
        transform:`translateX(${inset*(1-1/x)}px) scale(${1/x},${1/y})`,transformOrigin:'right center'});
    }
  }
  return result;
}

function animateMapControl(last,animation,sourceFrames=animation.effect.getKeyframes()) {
  const button = document.getElementById("zoneMapExpand");
  if (!last?.width || button.hidden) return;
  clearMapControlMotion();
  const style=button.getAttribute('style'),inset=parseFloat(getComputedStyle(button.parentElement).paddingRight)||0;
  const frames=sourceFrames.map((frame,index)=>{
    const matrix=new DOMMatrix(frame.transform==='none'?'':frame.transform);
    return {offset:frame.computedOffset ?? frame.offset ?? index/(sourceFrames.length-1),x:matrix.a,y:matrix.d,easing:frame.easing};
  });
  button.classList.add('zone-layout-moving');
  const counter=button.animate(mapControlFrames(frames,inset),{...animation.effect.getTiming(),fill:'both'});
  const motion={button,style,animation:counter};
  mapControlMotion=motion;
  animation.ready.then(()=>{if(mapControlMotion===motion && animation.startTime!==null)counter.startTime=animation.startTime;},()=>{});
}

function clearMapLayoutGhost() {
  if (!mapLayoutGhost) return;
  window.removeEventListener("scroll",mapLayoutGhost.followScroll);
  mapLayoutGhost.layer.remove();
  mapLayoutGhost = null;
}

function createMapLayoutGhost(source, bounds) {
  const layer = document.createElement("div"), node = source.cloneNode(true);
  layer.className = "map-layout-ghost-layer";
  layer.inert = true; layer.setAttribute("aria-hidden","true");
  node.removeAttribute("id");
  for (const child of node.querySelectorAll("[id]")) child.removeAttribute("id");
  node.classList.remove("zone-layout-moving"); node.classList.add("map-layout-ghost");
  Object.assign(node.style,{left:`${bounds.left}px`,top:`${bounds.top}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});
  layer.appendChild(node); document.body.appendChild(layer);
  const originals = source.querySelectorAll(".incident-table-wrap");
  node.querySelectorAll(".incident-table-wrap").forEach((copy,index)=>{
    copy.scrollTop = originals[index].scrollTop; copy.scrollLeft = originals[index].scrollLeft;
  });
  const startScroll = window.scrollY;
  const followScroll = () => { node.style.top = `${bounds.top+startScroll-window.scrollY}px`; };
  window.addEventListener("scroll",followScroll,{passive:true});
  mapLayoutGhost = {layer,followScroll};
  return node;
}

function animateI70MapWrap(before, ghost, expanding) {
  const graph = before[0], map = before[1];
  const graphAfter = graph.node.getBoundingClientRect(), mapAfter = map.node.getBoundingClientRect();
  const controlAfter=document.getElementById("zoneMapExpand").getBoundingClientRect();
  const incoming = expanding ? document.getElementById("recent-incidents")
    : document.querySelector('.route-incidents[data-corridor="I70"]');
  const incomingAfter = incoming.getBoundingClientRect();
  const flip = (first,last) => `translate(${first.left-last.left}px, ${first.top-last.top}px) scale(${first.width/last.width},${first.height/last.height})`;
  const move = (node,first,last) => {
    node.classList.add("zone-layout-moving");
    const animation = node.animate([{transform:first,transformOrigin:"top left"},{transform:last,transformOrigin:"top left"}],
      {duration:900,easing:"cubic-bezier(.4,0,.2,1)",fill:node===ghost ? "forwards" : "none"});
    const motion = {node,animation}; zoneLayoutAnimations.push(motion);
    animation.onfinish = () => {
      if (!zoneLayoutAnimations.includes(motion)) return;
      if(node===map.node)clearMapControlMotion();
      node.classList.remove("zone-layout-moving");
      zoneLayoutAnimations = zoneLayoutAnimations.filter(item=>item!==motion);
      if (!zoneLayoutAnimations.length) clearMapLayoutGhost();
    };
    return animation;
  };
  move(graph.node,flip(graph.bounds,graphAfter),"none");
  const mapAnimation=move(map.node,flip(map.bounds,mapAfter),"none");
  animateMapControl(controlAfter,mapAnimation);
  const anchorBefore = expanding ? graph.bounds : map.bounds, anchorAfter = expanding ? graphAfter : mapAfter;
  const startX = expanding ? graph.bounds.right-incomingAfter.left : map.bounds.left-mapAfter.left;
  move(incoming,`translate(${startX}px, ${anchorBefore.top-anchorAfter.top}px) scaleY(${anchorBefore.height/anchorAfter.height})`,"none");
  const ghostAnchorBefore = expanding ? map.bounds : graph.bounds, ghostAnchorAfter = expanding ? mapAfter : graphAfter;
  const shiftX = expanding ? mapAfter.left-map.bounds.left : graphAfter.right-graph.bounds.right;
  move(ghost,"none",`translate(${shiftX}px, ${ghostAnchorAfter.top-ghostAnchorBefore.top}px) scaleY(${ghostAnchorAfter.height/ghostAnchorBefore.height})`);
  for (const entry of before.filter(entry=>entry.follower)) {
    move(entry.node,flip(entry.bounds,entry.node.getBoundingClientRect()),"none");
  }
}

function linkedModeFollowerFrames(moves, first, last) {
  // The lowest panel can change mid-flight; follow its edge rather than an endpoint interpolation.
  const edges=moves.filter(move=>!move.shield && !move.foldGhost && move.node!==incidentFold?.node
      && !['system-health','under-the-hood'].includes(move.node.id))
    .map(move=>({start:move.before.top+move.before.height,end:move.after.top+move.after.height}));
  if (incidentFold) {
    const incident=moves.find(move=>move.node===incidentFold.node),map=moves.find(move=>move.node.id==='corridorMapPanel');
    if (incidentFold.slide) {
      const graph=moves.find(move=>move.node.classList.contains('chart-canvas-wrap'));
      const start=Math.max(graph.before.top+graph.before.height,map.before.top+map.before.height);
      const end=Math.max(graph.after.top+graph.after.height,map.after.top+map.after.height);
      if(incidentFold.vertical)edges.push({start:incident.before.top+(incidentFold.visibleHeight ?? incident.before.height),end},
        {start,end:incident.after.top+incident.after.height});
      else edges.push({start:incident.before.top+incident.before.height,end:incidentFold.fromFinder ? end : incident.before.top+incident.before.height},
        {start:zoneFinderActive() ? start : incident.after.top+incident.after.height,end:incident.after.top+incident.after.height});
    }
    else edges.push(incidentFold.entering
      ? {start:map.before.top+map.before.height,end:incident.after.top+incident.after.height}
      : {start:incident.before.top+(incidentFold.visibleHeight ?? incident.before.height),end:map.after.top+map.after.height});
  }
  const bottom=progress=>Math.max(...edges.map(edge=>edge.start+(edge.end-edge.start)*progress));
  const offsets=new Set([0,1]);
  for(const a of edges)for(const b of edges){
    const start=a.start-b.start,end=a.end-b.end,at=start/(start-end);
    if(at>0&&at<1)offsets.add(at);
  }
  const beforeGap=first.top-bottom(0),afterGap=last.top-bottom(1);
  return [...offsets].sort((a,b)=>a-b).map(progress=>{
    const remaining=1-progress,x=(first.left-last.left)*remaining;
    const y=bottom(progress)+beforeGap*remaining+afterGap*progress-last.top;
    const sx=1+(first.width/last.width-1)*remaining,sy=1+(first.height/last.height-1)*remaining;
    return {offset:progress,transform:`translate(${x}px, ${y}px) scale(${sx}, ${sy})`,opacity:1,transformOrigin:'top left'};
  });
}

function incidentFoldFrames(moves, first, last, ghost) {
  const below=incidentFold.slide && (ghost ? incidentFold.fromFinder : zoneFinderActive());
  if (incidentFold.slide && !below && !incidentFold.vertical) {
    const distance=window.innerWidth-last.left+16;
    return [{transform:`translateX(${ghost ? 0 : distance}px)`,opacity:1},
      {transform:`translateX(${ghost ? distance : 0}px)`,opacity:1}];
  }
  const graph=moves.find(move=>move.node.classList.contains('chart-canvas-wrap'));
  const map=moves.find(move=>move.node.id==='corridorMapPanel');
  const incident=moves.find(move=>move.node===incidentFold.node);
  if (below || incidentFold.vertical) {
    const start=below ? Math.max(graph.before.top+graph.before.height,map.before.top+map.before.height) : map.before.top+map.before.height;
    const end=below ? Math.max(graph.after.top+graph.after.height,map.after.top+map.after.height) : map.after.top+map.after.height;
    const source=ghost ? incident.before : incident.after,gap=source.top-(ghost ? start : end);
    const visibleHeight=Math.min(last.height,incidentFold.visibleHeight ?? last.height);
    return [0,1].map(progress=>({transform:`translateY(${start+(end-start)*progress+gap*(ghost ? 1-progress : progress)-last.top}px)`,
      clipPath:`inset(0px 0px ${ghost ? last.height-visibleHeight*(1-progress) : last.height*(1-progress)}px 0px)`,opacity:1}));
  }
  const foldBelow=ghost ? !incidentFold.entering : incidentFold.entering;
  const source=ghost ? incident.before : incident.after;
  const visibleHeight=Math.min(source.height,incidentFold.visibleHeight ?? source.height);
  const gap=foldBelow ? source.top-(ghost ? map.before.top+map.before.height : map.after.top+map.after.height) : 0;
  return [0,1].map(progress=>{
    const edge=move=>(move.before.top+move.before.height)*(1-progress)+(move.after.top+move.after.height)*progress;
    const top=foldBelow ? edge(map)+gap*(ghost ? 1-progress : progress) : edge(graph);
    const height=foldBelow ? (ghost ? visibleHeight*(1-progress) : source.height*progress)
      : Math.min(ghost ? visibleHeight : Infinity,Math.max(0,edge(map)-top));
    return {transform:`translateY(${top-last.top}px)`,clipPath:`inset(0px 0px ${Math.max(0,last.height-height)}px 0px)`,
      opacity:1,transformOrigin:'top left'};
  });
}

function nestedMapFrames(first,last,parent) {
  // The restored map is inside the moving incident panel; do not apply its parent's scale twice.
  return Array.from({length:65},(_,index)=>{
    const progress=index/64,remaining=1-progress;
    const px=1+(parent.before.width/parent.after.width-1)*remaining;
    const py=1+(parent.before.height/parent.after.height-1)*remaining;
    const x=(first.left-last.left)*remaining,y=(first.top-last.top)*remaining;
    const ownerX=(parent.before.left-parent.after.left)*remaining;
    const ownerY=(parent.before.top-parent.after.top)*remaining;
    const insetX=last.left-parent.after.left,insetY=last.top-parent.after.top;
    const sx=(1+(first.width/last.width-1)*remaining)/px;
    const sy=(1+(first.height/last.height-1)*remaining)/py;
    return {offset:progress,transform:`translate(${(insetX+x-ownerX)/px-insetX}px, ${(insetY+y-ownerY)/py-insetY}px) scale(${sx},${sy})`,
      opacity:1,transformOrigin:'top left'};
  });
}

function animateZoneLayout(before, onFinish, staged = false, durationOverride) {
  if ((window.BrowserMotion?.media() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)"))?.matches) return;
  const baseDuration=durationOverride ?? (staged ? state.focusedCorridor === "I25" ? 1350 : 900 : 380);
  const hold=staged && state.focusedCorridor === "I25" && state.mapExpanded ? 400 : 0;
  const duration=baseDuration+hold;
  const phases={graphEnd:baseDuration*.55/duration,mapStart:(baseDuration*.55+hold)/duration,
    traceStart:baseDuration*.08/duration,traceEnd:baseDuration*.5/duration};
  const moves = before.map(entry => ({...entry, before: entry.bounds, after: entry.node.getBoundingClientRect(),
    controlAfter:entry.controlBounds ? document.getElementById("zoneMapExpand").getBoundingClientRect() : null}));
  if (incidentFold) moves.push({node:incidentFold.ghost,before:incidentFold.bounds,after:incidentFold.bounds,foldGhost:true});
  for (const {node, before: first, after: last, shield, visible, follower, surface, linkedIncident, linkedKey, controlBounds, controlAfter, trace, foldGhost} of moves) {
    if (node.hidden || !(first.width > 0 && last.width > 0)) continue;
    const targetX = shield && zoneMapInlineActive() ? -last.width : 0;
    const x = first.left - (last.left - targetX), y = first.top - last.top, scale = first.width / last.width;
    const scaleY = first.height > 0 && last.height > 0 ? first.height / last.height : 1;
    const linkedFollower=mapViewChanging && state.mapExpanded && ['system-health','under-the-hood'].includes(node.id);
    if (!foldGhost && !linkedFollower && Math.abs(x - targetX) < 1 && Math.abs(y) < 1 && Math.abs(scale - 1) < 0.001
        && Math.abs(scaleY - 1) < 0.001) continue;
    node.classList.add("zone-layout-moving");
    // Offscreen destinations use a short rise/exit rather than a cross-page flight.
    const viewportHeight = window.innerHeight || Infinity;
    const entering = !staged && node.id === "corridorMapPanel" && first.top >= viewportHeight && last.top < viewportHeight;
    const leaving = !staged && node.id === "corridorMapPanel" && last.top >= viewportHeight && first.top < viewportHeight;
    let keyframes = [
      {transform: entering ? "translate(0, 150px) scaleX(1)" : `translate(${x}px, ${y}px) scaleX(${scale})${scaleY === 1 ? "" : ` scaleY(${scaleY})`}`,
        opacity: entering || (shield && !visible) ? 0 : 1, transformOrigin: "top left"},
      {transform: leaving ? `translate(${x}px, ${y + 150}px) scaleX(${scale})` : `translate(${targetX}px, 0) scaleX(1)`,
        opacity: leaving || (shield && zoneMapInlineActive()) ? 0 : 1, transformOrigin: "top left"}
    ];
    if (linkedFollower)
      keyframes=linkedModeFollowerFrames(moves,first,last);
    if (incidentFold?.node === node || foldGhost) keyframes=incidentFoldFrames(moves,first,last,foldGhost);
    // Clip the stationary incident shell, not its independently moving children.
    if (surface) keyframes = [
      {clipPath:`inset(-100vmax -100vmax ${last.bottom-first.bottom}px -100vmax)`},
      {clipPath:"inset(-100vmax -100vmax 0px -100vmax)"}
    ];
    if (staged) {
      const mapFamily = node.id === "corridorMapPanel" || follower || surface;
      const early = state.mapExpanded ? !mapFamily : mapFamily;
      const start = {...keyframes[0],opacity:1}, finish = {...keyframes[1],opacity:1};
      keyframes = [
        {...start,offset:0,easing:"cubic-bezier(.4,0,.2,1)"},
        {...(early ? finish : start),offset:early ? phases.graphEnd : phases.mapStart,easing:"cubic-bezier(.4,0,.2,1)"},
        {...finish,offset:1}
      ];
      if (linkedIncident || linkedKey) {
        // The header/row join follows the graph; their right edge and the row bottom follow the map.
        const upper=state.mapExpanded ? last : first;
        const incident=linkedKey ? moves.find(move=>move.linkedIncident) : null;
        const lower=state.mapExpanded ? incident?.before || first : incident?.after || last;
        const bottom=lower.top+lower.height;
        const height=linkedKey ? upper.height : Math.max(1,bottom-upper.top);
        const middle={...start,easing:"cubic-bezier(.4,0,.2,1)",
          transform:`translate(${lower.left-last.left}px, ${upper.top-last.top}px) scaleX(${lower.width/last.width}) scaleY(${height/last.height})`};
        keyframes=[keyframes[0],{...middle,offset:phases.graphEnd},
          ...(hold ? [{...middle,offset:phases.mapStart}] : []),{...finish,offset:1}];
      }
    }
    const timing = {duration,easing:staged ? "linear" : "cubic-bezier(0.22, 1, 0.36, 1)"};
    if (trace) keyframes=keyframes.map(frame=>({...frame,transform:"none"}));
    const owner=!staged && node.id==='corridorMapPanel'
      ? moves.find(move=>move.node.id==='recent-incidents' && move.node.contains(node)) : null;
    const controlFrames=owner ? [{transform:`scale(${scale},${scaleY})`},{transform:'none'}] : keyframes;
    if (owner) keyframes=nestedMapFrames(first,last,owner);
    const animation = node.animate(keyframes, timing);
    if (controlBounds) animateMapControl(controlAfter,animation,controlFrames);
    if (trace) {
      const data=chartRouteData("I25"),frame=chartPaintFrame("I25",data),colors=chartColors();
      i25TraceMotion=window.DashboardTraceHandoff.start({...trace,to:trace.canvas.getBoundingClientRect(),animation,phases,map:document.getElementById("corridorMapPanel"),
        expanding:state.mapExpanded,color:colors["--gold-data"],gridColor:colors.grid,
        rangeColors:{green:colors.forest,rose:colors["--rose"]},
        paint:(canvas,dimensions)=>{frame.layoutDimensions=dimensions;return chartPainter.drawCorridorChart(canvas,"I25",data,frame);}});
    }
    const motion = {node, animation};
    zoneLayoutAnimations.push(motion);
    animation.onfinish = () => {
      if (!zoneLayoutAnimations.includes(motion)) return;
      if(controlBounds)clearMapControlMotion();
      if (trace) { i25TraceMotion?.clear();i25TraceMotion=null; }
      node.classList.remove("zone-layout-moving");
      zoneLayoutAnimations = zoneLayoutAnimations.filter(item => item !== motion);
      if (!zoneLayoutAnimations.length && incidentFold) clearIncidentFold();
      if (!zoneLayoutAnimations.length) onFinish?.();
      finishMapViewMotion();
    };
  }
  if (!zoneLayoutAnimations.length) onFinish?.();
}

function overallMapExpanded() {
  return state.mapExpanded && state.chartView === "overall" && state.focusedCorridor !== "ALL"
    && !window.matchMedia?.("(max-width: 64rem)")?.matches;
}

function speedZoneIncidentsVisible() {
  return speedZoneViewActive() && state.mapExpanded && !zoneFinderActive()
    && !window.matchMedia?.('(max-width: 64rem)')?.matches;
}

function updateZoneMapLayout() {
  const available = speedZoneViewActive();
  const zones = zoneFinderActive();
  const expanded = available && state.mapExpanded;
  const inline = zoneMapInlineActive();
  const overall = overallMapExpanded();
  if (!available) {
    if (zoneMapSizeMotion) { zoneMapSizeMotion.cancel(); zoneMapSizeMotion = null; window.CorridorMapPanel?.resize(); }
  }
  elements.chartViewControl.dataset.finderAvailable = String(available);
  elements.chartViewControl.querySelector('button[data-chart-view="zones"]').setAttribute("aria-expanded", String(available));
  elements.zoneFinderReveal.inert = !available;
  elements.zoneFinderReveal.setAttribute("aria-hidden", String(!available));
  elements.zoneFinderToggle.disabled = !available;
  elements.zoneFinderToggle.setAttribute("aria-pressed", String(zones));
  document.body.dataset.zoneFinder = zones ? "enabled" : "disabled";
  document.body.dataset.zoneMapExpanded = String(expanded);
  const comparison = document.getElementById("comparisonPanel");
  if (!expanded) {
    comparison?.style.removeProperty?.("--zone-chart-height");
    comparison?.style.removeProperty?.("--zone-panel-height");
    comparison?.style.removeProperty?.("scroll-margin-top");
  }
  comparison?.classList?.toggle("zone-map-expanded", expanded);
  comparison?.classList?.toggle("overall-map-expanded", overall);
  const zoneIncidents = speedZoneIncidentsVisible();
  comparison?.classList?.toggle('speed-zone-incidents',zoneIncidents);
  const incidents = document.getElementById("recent-incidents");
  if ((overall || zoneIncidents) && incidents?.parentElement !== comparison) comparison?.appendChild?.(incidents);
  else if (!overall && !zoneIncidents && incidents?.parentElement === comparison) comparison.after(incidents);
  const expand = document.getElementById("zoneMapExpand");
  if (expand) {
    expand.hidden = state.focusedCorridor === "ALL";
    const mapExpanded = overall || expanded;
    const label = mapExpanded ? "Restore map" : "Enlarge map";
    expand.setAttribute("aria-label", label);
    expand.title = label;
    expand.setAttribute("aria-pressed", String(mapExpanded));
  }
  const panel = document.getElementById("corridorMapPanel");
  const destination = inline || overall ? comparison : document.getElementById("incidentRouteGrid");
  comparison?.classList?.toggle("zone-reference-active", inline);
  if (destination?.appendChild && panel?.parentElement !== destination) destination.appendChild(panel);
}

function updateExpandedZoneMapSize() {
  if (overallMapExpanded()) {
    const comparison = document.getElementById("comparisonPanel");
    const navigation = document.querySelector(".site-header").getBoundingClientRect().height;
    comparison.style.setProperty("--overall-panel-height",`${Math.max(560,window.innerHeight-navigation-16)}px`);
    comparison.style.scrollMarginTop = `${navigation+8}px`;
    return;
  }
  if (!speedZoneViewActive() || !state.mapExpanded || window.matchMedia?.("(max-width: 64rem)")?.matches) return;
  const comparison = document.getElementById("comparisonPanel");
  const navigation = document.querySelector(".site-header")?.getBoundingClientRect().height || 0;
  const height = Math.max(320,window.innerHeight-navigation-16);
  comparison.style.setProperty("--zone-panel-height",`${height}px`);
  const heading = comparison.querySelector(".comparison-header").getBoundingClientRect().height;
  const chartHeight = Math.max(0,speedZoneIncidentsVisible()
    ? document.getElementById(CORRIDOR_CONFIG[state.focusedCorridor].chartId).closest('.chart-lane').getBoundingClientRect().height
    : comparison.getBoundingClientRect().height-heading-2);
  comparison.style.setProperty("--zone-chart-height",`${chartHeight}px`);
  const canvas = document.getElementById(CORRIDOR_CONFIG[state.focusedCorridor].chartId);
  canvas.closest(".chart-lane").classList.toggle("zone-rows-overflow",
    chartPainter.zoneChartHeight(canvas,visibleSpeedZoneGroups(state.focusedCorridor).length)>chartHeight+1);
  comparison.style.scrollMarginTop = `${navigation+8}px`;
}

function toggleZoneMapSize() {
  if (mapPositioning) { mapPositioning.cancel(); return; }
  if (state.focusedCorridor === "ALL") return;
  const comparison = document.getElementById("comparisonPanel");
  const navigation = document.querySelector(".site-header").getBoundingClientRect().height;
  const start = window.scrollY;
  const target = Math.max(0,Math.min(start+comparison.getBoundingClientRect().top-navigation-8,
    document.documentElement.scrollHeight-window.innerHeight));
  const reduced = (window.BrowserMotion?.media() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)"))?.matches;
  if (reduced || Math.abs(target-start)<2) {
    window.scrollTo({top:target,behavior:"instant"});
    resizeZoneMap();
    return;
  }
  stopZoneLayoutMotion();
  const button = document.getElementById("zoneMapExpand");
  button.setAttribute("aria-busy","true");
  let frame, started;
  const cancel = () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("wheel",cancel);
    window.removeEventListener("touchstart",cancel);
    window.removeEventListener("keydown",onKey);
    button.removeAttribute("aria-busy");
    mapPositioning = null;
  };
  const onKey = event => { if (["Escape","ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "].includes(event.key)) cancel(); };
  mapPositioning = {cancel};
  window.addEventListener("wheel",cancel,{passive:true});
  window.addEventListener("touchstart",cancel,{passive:true});
  window.addEventListener("keydown",onKey);
  const step = time => {
    started ??= time;
    const progress = Math.min(1,(time-started)/420);
    const eased = progress*progress*(3-2*progress);
    window.scrollTo({top:start+(target-start)*eased,behavior:"instant"});
    if (progress<1) frame = window.requestAnimationFrame(step);
    else { cancel(); resizeZoneMap(); }
  };
  frame = window.requestAnimationFrame(step);
}

function resizeZoneMap() {
  if (state.chartView === "overall" && state.focusedCorridor !== "ALL") {
    const reduced = (window.BrowserMotion?.media() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)"))?.matches;
    const scrollBefore = window.scrollY;
    const canvas = document.getElementById(CORRIDOR_CONFIG[state.focusedCorridor].chartId);
    const incidents = state.focusedCorridor === "I25" ? document.querySelector('.route-incidents[data-corridor="I25"]')
      : document.getElementById("recent-incidents");
    const incidentKey=state.focusedCorridor === "I25" ? document.querySelector("#recent-incidents > .incident-key") : null;
    const trace = !reduced && state.focusedCorridor === "I25" && window.DashboardTraceHandoff
      && !(window.ContinuousHistory?.active && chartHistory.endTime !== null) ? {
      canvas,from:i25TraceMotion?.bounds() || canvas.getBoundingClientRect(),shield:canvas.closest(".chart-lane").querySelector(".lane-label"),
      fromShield:canvas.closest(".chart-lane").querySelector(".lane-label").getBoundingClientRect()} : null;
    const before = [canvas.closest(".chart-lane"),document.getElementById("corridorMapPanel"),incidents,
      incidentKey,
      state.focusedCorridor === "I25" ? document.getElementById("recent-incidents") : null,
      document.getElementById("system-health"),document.getElementById("under-the-hood")]
      .filter(node=>node?.animate).map(node=>{
        const surface=state.focusedCorridor === "I25" && node.id === "recent-incidents";
        const rect=node.getBoundingClientRect(),inset=surface ? parseFloat(getComputedStyle(node).clipPath.split(" ")[2])||0 : 0;
        const bounds={left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom-inset,width:rect.width,height:rect.height-inset};
        return {node,bounds,visible:true,shield:false,surface,
          linkedIncident:state.focusedCorridor === "I25" && node === incidents,
          linkedKey:node === incidentKey,
          trace:node === canvas.closest(".chart-lane") ? trace : null,
          controlBounds:node.id === "corridorMapPanel" ? document.getElementById("zoneMapExpand").getBoundingClientRect() : null,
          follower:["system-health","under-the-hood"].includes(node.id)};
      });
    const wrapping = !reduced && state.focusedCorridor === "I70";
    const outgoing = state.mapExpanded ? document.getElementById("recent-incidents")
      : document.querySelector('.route-incidents[data-corridor="I70"]');
    const outgoingBounds = wrapping ? outgoing.getBoundingClientRect() : null;
    stopZoneLayoutMotion();
    const ghost = wrapping ? createMapLayoutGhost(outgoing,outgoingBounds) : null;
    state.mapExpanded = !state.mapExpanded;
    updateZoneMapLayout(); updateExpandedZoneMapSize(); drawAllCharts();
    window.CorridorMapPanel?.resize();
    window.scrollTo({top:scrollBefore,behavior:"instant"});
    // Reparenting a focused control can move the page before its scroll event runs.
    const scrollShift = scrollBefore-window.scrollY;
    for (const entry of before) {
      const bounds = entry.bounds;
      entry.bounds = {left:bounds.left,right:bounds.right,width:bounds.width,height:bounds.height,
        top:bounds.top+scrollShift,bottom:bounds.bottom+scrollShift};
      if (entry.controlBounds) {
        const control = entry.controlBounds;
        entry.controlBounds = {left:control.left,top:control.top+scrollShift,width:control.width,height:control.height};
      }
    }
    mapLayoutGhost?.followScroll();
    if (ghost) animateI70MapWrap(before,ghost,state.mapExpanded);
    else if (!reduced) animateZoneLayout(before,undefined,true);
    return;
  }
  if (!speedZoneViewActive()) return;
  const comparison = document.getElementById("comparisonPanel");
  const scrollBefore = window.scrollY;
  const movingLayout = !zoneFinderActive() ? captureZoneMapTransition() : null;
  const before = comparison.getBoundingClientRect();
  stopZoneLayoutMotion();
  const reduced = (window.BrowserMotion?.media() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)"))?.matches;
  mapViewChanging=!reduced && Boolean(movingLayout?.length);
  comparison.classList.toggle('map-view-changing',mapViewChanging);
  if (!reduced) window.CorridorMapPanel?.beginResize();
  state.mapExpanded = !state.mapExpanded;
  updateZoneMapLayout();
  updateExpandedZoneMapSize();
  drawAllCharts();
  const after = comparison.getBoundingClientRect();
  if (movingLayout) {
    window.scrollTo({top:scrollBefore,behavior:'instant'});
    if (!reduced) window.CorridorMapPanel?.beginResize();
    animateZoneLayout(movingLayout,undefined,false,640);
    finishMapViewMotion();
    if (reduced) window.CorridorMapPanel?.resize();
    return;
  }
  if (!reduced && typeof comparison.animate === "function") {
    // Keep the settled chart bitmap while the native grid resizes; repaint once at its final size.
    mapViewChanging = true;
    comparison.classList.add('zone-map-sizing');
    const animation = comparison.animate([{height:`${before.height}px`},{height:`${after.height}px`}],
      {duration:640,easing:"cubic-bezier(.4,0,.2,1)"});
    zoneMapSizeMotion = animation;
    animation.onfinish = () => {
      if (zoneMapSizeMotion !== animation) return;
      zoneMapSizeMotion = null; mapViewChanging = false;
      comparison.classList.remove('zone-map-sizing');
      updateExpandedZoneMapSize(); drawAllCharts(); window.CorridorMapPanel?.resize();
    };
  } else window.CorridorMapPanel?.resize();
  updateExpandedZoneMapSize();
  window.scrollTo({top:scrollBefore,behavior:"instant"});
  window.requestAnimationFrame(drawAllCharts);
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
  if (!options.cacheFollowup) state.cacheRefreshRetries = 0;
  window.clearTimeout(state.cacheRefreshTimer); state.cacheRefreshTimer = null;
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
      if (![...snapshots.values()].some(snapshot => snapshot.refreshing)) state.lastSyncedAt = new Date();
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
    scheduleCacheRefresh();
    if (state.refreshPending) {
      state.refreshPending = false;
      if (!document.hidden) void refreshDashboard({ queueIfBusy: false });
    }
  }
}

function scheduleCacheRefresh() {
  const pending = [...state.snapshots.values()].some(snapshot => snapshot.refreshing);
  if (!pending) { state.cacheRefreshRetries = 0; return; }
  if (document.hidden || HISTORICAL_MODE || REPLAY_MODE || state.cacheRefreshRetries >= 2) return;
  state.cacheRefreshRetries++;
  state.cacheRefreshTimer = window.setTimeout(() => {
    state.cacheRefreshTimer = null;
    void refreshDashboard({queueIfBusy:false,cacheFollowup:true});
  }, state.cacheRefreshRetries * 1000);
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
  const retained = Number.isFinite(dashboardData.refreshingSince)
    ? `Showing data fetched at ${formatSyncTime(new Date(dashboardData.refreshingSince))}` : "Showing previously loaded data";
  const successStatus = dashboardData.refreshing
    ? `${retained} · Refreshing in the background`
    : HISTORICAL_MODE
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
      "speed-zone baseline": options.deferZoneBaselines ? Promise.resolve(null) : requestJson(dashboardApi(`/traffic/zones/baselines?corridor=${corridor}${asOfParam}`)),
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
    route.zoneBaselineDeferred = options.deferZoneBaselines === true;
    route.dailyZones = value("daily travel zones")?.points || [];
    route.variableSpeedSigns = value("variable speed signs");
    route.currentFlowCells = value("current flow cells");
    route.flowCells = value(selectedHours > 24 ? "slowdown frequency" : "current flow cells");
    route.syncAvailability = {
      summary: available("summary"),
      trend: available("speed history"),
      incidents: available("incidents"),
      zones: available("speed zones"),
      zoneBaseline: !options.deferZoneBaselines && available("speed-zone baseline"),
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
  renderSystemHealth();
  updateReferenceBandControl();
  renderFocusedCorridorMap();
  window.requestAnimationFrame(drawAllCharts);
}

function renderFocusedCorridorMap() {
  const variableSpeedSummary = renderVariableSpeedNotice();
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
    variableSpeedSummary,
    openLimitDetails: state.limitDetailsPending,
    onLimitDetailsOpened: () => { state.limitDetailsPending = false; },
    variableSpeedSignsConfirmed: state.routeData.get("I70")?.syncAvailability?.variableSpeedSigns !== false,
    theme: document.documentElement.dataset.theme
  });
}

function refreshVariableSpeedContext() {
  const historical = HISTORICAL_MODE || REPLAY_MODE || chartHistory.endTime !== null;
  if (historical === state.variableSpeedHistoricalView) return;
  state.variableSpeedHistoricalView = historical;
  renderFocusedCorridorMap();
}

function currentVariableSpeedSigns() {
  if (HISTORICAL_MODE || REPLAY_MODE || chartHistory.endTime !== null) return null;
  return state.routeData.get("I70")?.variableSpeedSigns || null;
}

function renderVariableSpeedNotice() {
  const snapshot = currentVariableSpeedSigns();
  const confirmed = state.routeData.get("I70")?.syncAvailability?.variableSpeedSigns !== false;
  const summary = window.VariableSpeedSigns?.summary(snapshot, confirmed);
  const badge = document.getElementById("i70VariableLimitBadge");
  if (!badge) return summary;
  const hasChanges = snapshot && summary?.changed.length > 0;
  badge.hidden = !hasChanges;
  if (!hasChanges) {
    badge.textContent = "";
    badge.removeAttribute("title");
    return summary;
  }
  const count = summary.changed.length;
  const reported = summary.changed.flatMap(group => group.signs.filter(sign => sign.differentFromRegular))
    .map(sign => sign.reportedLimitMph);
  const minimum = Math.min(...reported), maximum = Math.max(...reported);
  const limitLabel = minimum === maximum ? `${minimum} mph` : `${minimum}–${maximum} mph`;
  badge.textContent = summary.reduced.length ? "Speed Limits Reduced" : "Speed Limits Changed";
  badge.title = `${limitLabel} at ${count} sign ${count === 1 ? "location" : "locations"}. Show details on the I-70 map.`;
  return summary;
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
      ? "Average estimated drive time through the corridor during this period."
      : "Estimated drive time through the corridor at current traffic speeds.";
  }
  if (travelRange) {
    travelRange.title = periodView
      ? "Fastest and slowest estimated corridor drive times during this period."
      : "Fastest and slowest estimated corridor drive times since midnight in Colorado.";
  }
  if (worstLabel) {
    worstLabel.title = periodView
      ? "Speed zone with the lowest average speed during this period."
      : "Slowest stretch in the latest available traffic readings.";
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

function renderChartIncidentLinks(canvas, corridor) {
  const wrap = canvas.closest?.('.chart-canvas-wrap');
  if (!wrap) return;
  let layer = wrap.querySelector('.chart-incident-links');
  const targets = chartPainter.getIncidentTargets(canvas);
  if (!layer && !targets.length) return;
  if (!layer) {
    layer = document.createElement('div'); layer.className = 'chart-incident-links';
    layer.setAttribute('role','group'); layer.setAttribute('aria-label',`${corridor.replace('I','I-')} graph incidents`);
    wrap.appendChild(layer);
  }
  layer.inert = Boolean(window.ContinuousHistory?.moving);
  const offsetLeft=canvas.offsetLeft,offsetTop=canvas.offsetTop;
  targets.forEach((target,index) => {
    let button = layer.children[index];
    if (!button) {
      button = document.createElement('button'); button.type = 'button';
      button.addEventListener('click',()=>showChartIncidents(corridor,button.chartIncidents));
      layer.appendChild(button);
    }
    button.chartIncidents = target.incidents;
    button.setAttribute('aria-label',`Show ${target.label} in incident panel`);
    button.title = 'Open incident details';
    button.style.left = `${offsetLeft+target.left}px`;
    button.style.top = `${offsetTop+target.top}px`;
    button.style.width = `${target.right-target.left}px`;
    button.style.height = `${target.bottom-target.top}px`;
  });
  while (layer.children.length > targets.length) layer.lastElementChild.remove();
}

function showChartIncidents(corridor, incidents) {
  if (!incidents?.length) return;
  state.chartIncidentSelection = {corridor,incidents,context:chartIncidentContext()};
  if (state.focusedCorridor === 'ALL') for (const route of CORRIDOR_IDS) state.expandedIncidents.add(route);
  for (const route of CORRIDOR_IDS) renderIncidentTable(route,state.routeData.get(route)?.incidentThreads || [],route===corridor);
  window.requestAnimationFrame(()=>{
    const row=document.getElementById(CORRIDOR_CONFIG[corridor].incidentRowsId).querySelector('[data-chart-match="true"]');
    if (!row) return;
    const reduced=(window.BrowserMotion?.media() ?? window.matchMedia?.('(prefers-reduced-motion: reduce)'))?.matches;
    row.tabIndex=-1;
    const target=row.querySelector('.incident-details > summary') || row;
    target.focus({preventScroll:true});
    target.scrollIntoView({block:target.closest('#comparisonPanel')?'nearest':'center',inline:'nearest',behavior:reduced?'instant':'smooth'});
  });
}

function chartIncidentContext() {
  return `${state.focusedCorridor}|${state.chartView}|${state.selectedHours}|${chartHistory.endTime}`;
}

function renderIncidentTable(corridor, incidentThreads, reveal = false) {
  const selection = state.chartIncidentSelection?.corridor === corridor ? state.chartIncidentSelection.incidents : [];
  const selectedKeys = selection.map(incident=>incident.key);
  const liveKeys = new Set(incidentThreads.map(incident=>incident.key));
  const chartOnly = selection.filter(incident=>!liveKeys.has(incident.key));
  const entries = [...incidentThreads,...chartOnly];
  const filtered = state.incidentTypeFilters.size > 0;
  incidentTable.render(corridor, filtered ? entries.filter(incident=>state.incidentTypeFilters.has(incident.type)||selectedKeys.includes(incident.key)) : entries, {
    rowsId: CORRIDOR_CONFIG[corridor].incidentRowsId,
    combinedView: state.focusedCorridor === "ALL",
    expanded: state.expandedIncidents.has(corridor),
    filtered,
    selectedKeys, revealKeys:reveal?selectedKeys:[], chartOnlyKeys:chartOnly.map(incident=>incident.key),
    incidentsAvailable: state.routeData.has(corridor) && state.routeData.get(corridor)?.incidentsAvailable !== false
  });
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
  elements.routesServiceStatus.title = "Checks whether the corridor maps are available.";
  setServiceStatus(elements.ingestServiceStatus, retainedDataMode ? "Off for replay" : ingestHealthy ? "Feeds current" : "Unconfirmed", !retainedDataMode && ingestHealthy);
  elements.ingestServiceStatus.title = "Checks whether traffic and incident reports are arriving.";
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

document.addEventListener("visibilitychange", () => {
  if (document.hidden) liveTransition?.reset();
  else window.requestAnimationFrame(drawAllCharts);
});

function drawAllCharts(animationOnly = false) {
  if (zoneMapSizeMotion) return;
  const selection=state.chartIncidentSelection;
  if (selection && selection.context !== chartIncidentContext()) {
    state.chartIncidentSelection=null;
    renderIncidentTable(selection.corridor,state.routeData.get(selection.corridor)?.incidentThreads || []);
  }
  const animationFrame = animationOnly === true;
  const summaries = [];
  if (!animationFrame) {
    if (zoneFinderActive()) {
      const groups=visibleSpeedZoneGroups(state.focusedCorridor);
      window.CorridorMapPanel?.setZones?.(groups, state.selectedZoneKey, selectSpeedZone);
      document.querySelector(`[data-legend-corridor="${state.focusedCorridor}"] .legend-line`)
        ?.style.setProperty('--zone-colors',`linear-gradient(90deg,${groups.map(group=>group.referenceColor).join(',')})`);
    }
  }
  const visibleCorridors = state.focusedCorridor === "ALL" ? CORRIDOR_IDS : [state.focusedCorridor];
  for (const corridor of visibleCorridors) {
    const routeData = chartRouteData(corridor);
    const canvas = document.getElementById(CORRIDOR_CONFIG[corridor].chartId);
    const bounds = canvas?.getBoundingClientRect?.();
    const reduced = (window.BrowserMotion?.media() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)"))?.matches;
    liveTransition?.observe({
      key:`${state.focusedCorridor}|${state.chartView}|${state.selectedHours}|${state.referenceSigma}|${state.mapExpanded}|${zoneFinderActive()}|${chartHistory.endTime !== null}|${window.innerWidth}|${window.innerHeight}`,
      corridor,end:chartEndTime(routeData),latest:latestChartObservation(routeData),
      animate:hasLiveChartEdge(routeData) && !reduced && !document.hidden && bounds?.width > 0
        && bounds.bottom > 0 && bounds.top < window.innerHeight
    });
    const liveLabel = document.getElementById(`${corridor.toLowerCase()}LiveDot`);
    if (liveLabel) liveLabel.hidden = !hasLiveChartEdge(routeData);
    if (window.ContinuousHistory?.active && chartHistory.endTime !== null
        && window.ContinuousHistory.paint(canvas, corridor)) {
      renderChartIncidentLinks(canvas,corridor);
      summaries.push(`${CORRIDOR_CONFIG[corridor].label}: retained observations. ${elements.historyWindow.textContent}.`);
      continue;
    }
    if (state.chartView === "zones" && state.focusedCorridor === corridor) {
      chartPainter.drawZoneChart(canvas, corridor, routeData, chartPaintFrame(corridor, routeData));
    } else {
      canvas.closest?.(".chart-lane")?.style.removeProperty("--chart-height");
      chartPainter.drawCorridorChart(canvas, corridor, routeData, chartPaintFrame(corridor, routeData));
    }
    renderChartIncidentLinks(canvas,corridor);
    if (animationFrame) continue;
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
        if (routeData.zoneBaselineDeferred) summaries.push("Zone comparisons are loading.");
        if (routeData.zoneBaselineError) summaries.push(routeData.zoneBaselineError);
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
  if (animationFrame) return;
  const summary = summaries.join(" ");
  if (elements.chartSummary.textContent !== summary) elements.chartSummary.textContent = summary;
  renderPipelineViewSamples();
}

function latestChartObservation(route) {
  if (!route || typeof route !== "object") return 0;
  const view = state.chartView === "zones" ? "zones" : state.selectedHours <= 24 ? "detail" : "trend";
  let cached = latestChartObservations.get(route);
  if (!cached) { cached = {}; latestChartObservations.set(route,cached); }
  if (cached[view] !== undefined) return cached[view];
  const rows = view === "zones" ? route.zones : view === "detail" ? route.history?.samples : route.trend?.buckets;
  let latest = 0;
  for (const point of rows || []) {
    const at = dateMillis(point.polledAt || point.bucketStart || point.timestamp);
    if (Number.isFinite(finiteNumber(point.avgCurrentSpeed ?? point.speed)) && at <= Date.now()+1000) latest = Math.max(latest,at);
  }
  return cached[view] = latest;
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

function chartPaintFrame(corridor, routeData, { end = chartEndTime(routeData), hours = state.selectedHours, strip = false } = {}) {
  // Cached strips span beyond the viewport; display policy follows the selected range.
  const rangeHours = state.selectedHours;
  const emptyMessage = state.chartView === "zones"
    ? "No retained speed-zone observations in this time window." : "No retained speed data in this time window.";
  const arrival = !strip && chartHistory.endTime === null && !HISTORICAL_MODE && !REPLAY_MODE ? liveTransition?.frame(corridor) : null;
  return {
    end:arrival?.end ?? end, incoming:arrival?.incoming, hours, rangeHours, strip,
    currentDayAnchor: chartHistory.endTime === null && !HISTORICAL_MODE && !REPLAY_MODE ? Date.now() : null,
    referenceSigma: state.referenceSigma,
    zoneFinder: zoneFinderActive(),
    selectedZoneKey: state.selectedZoneKey,
    liveEdge: !strip && hasLiveChartEdge(routeData),
    pendingHistory: !strip && chartHistory.endTime !== null && chartHistory.dataKey !== historyWindowKey(),
    zoneSpeedLabel: chartHistory.endTime !== null || HISTORICAL_MODE || REPLAY_MODE || rangeHours > 24 ? "Observed:" : "Live:",
    emptyMessage: chartHistoryEmptyMessage(emptyMessage, corridor)
  };
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
    const item = document.createElement("button");
    item.type = "button";
    item.dataset.incidentType = type;
    item.appendChild(window.IncidentTypes.svg(document, type));
    const label = document.createElement("span");
    label.textContent = definition.label;
    item.appendChild(label);
    items.appendChild(item);
  });
  updateIncidentTypeFilterButtons();
  setIncidentLegendExpanded(state.incidentLegendExpanded);
}

function updateIncidentTypeFilterButtons() {
  for (const item of document.getElementById("incidentLegendItems")?.children || []) {
    const selected = state.incidentTypeFilters.has(item.dataset.incidentType);
    item.setAttribute("aria-pressed",String(selected));
    item.title = `${selected ? "Remove" : "Filter by"} ${window.IncidentTypes.icon(item.dataset.incidentType).label}${selected ? " filter" : ""}`;
  }
}

function setIncidentLegendExpanded(expanded) {
  state.incidentLegendExpanded = expanded;
  const items = document.getElementById("incidentLegendItems");
  if (items) Array.from(items.children).forEach((item, index) => {
    item.hidden = !expanded && index >= 8 && !state.incidentTypeFilters.has(item.dataset.incidentType);
  });
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
    providerLabel: "Demo",
    locationLabel,
    firstSeenAt: new Date(now.getTime() - firstMinutesAgo * 60_000),
    lastSeenAt: new Date(now.getTime() - lastMinutesAgo * 60_000),
    archived: !ongoing,
    normalizedStatus: ongoing ? "active" : "cleared",
    sourceUpdatedAt: new Date(now.getTime() - lastMinutesAgo * 60_000),
    ongoing
  };
}
