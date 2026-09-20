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
    label: "I-70 Mountain Corridor",
    distanceMiles: 53,
    currentColorVariable: "--rose",
    summaryPrefix: "i70",
    chartId: "i70Chart",
    incidentRowsId: "i70IncidentRows"
  }
};

const AUTO_REFRESH_MS = 60_000;
const REPLAY_REFRESH_MS = 5_000;
const RECENT_INCIDENT_WINDOW_MINUTES = 1_440;
const ONGOING_INCIDENT_WINDOW_MINUTES = 45;
const SIGMA_COVERAGE = { 1: "68.3%", 2: "95.4%", 3: "99.7%" };
const QUERY_PARAMS = new URLSearchParams(window.location.search);
const DEMO_MODE = QUERY_PARAMS.get("demo") === "1";
const HISTORICAL_MODE = !DEMO_MODE && QUERY_PARAMS.get("historical") === "1";
const REPLAY_MODE = !DEMO_MODE && !HISTORICAL_MODE && QUERY_PARAMS.get("replay") === "1";
const REPLAY_CONFIG = buildReplayConfig(QUERY_PARAMS);

const state = {
  selectedHours: 24,
  referenceSigma: 2,
  focusedCorridor: "ALL",
  chartView: "overall",
  replayStartedAt: Date.now(),
  followsDeviceTheme: true,
  deviceThemeQuery: null,
  routeData: new Map(),
  health: null,
  refreshing: false,
  refreshPending: false,
  expandedIncidents: new Set(),
  refreshTimer: null,
  resizeTimer: null
};

const elements = {
  corridorSelect: document.getElementById("corridorSelect"),
  refreshButton: document.getElementById("refreshButton"),
  statusText: document.getElementById("statusText"),
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  rangeControl: document.getElementById("rangeControl"),
  chartViewControl: document.getElementById("chartViewControl"),
  comparisonTitle: document.getElementById("comparisonTitle"),
  sigmaControl: document.getElementById("sigmaControl"),
  sigmaValue: document.getElementById("sigmaValue"),
  sigmaCoverage: document.getElementById("sigmaCoverage"),
  sigmaDecrease: document.getElementById("sigmaDecrease"),
  sigmaIncrease: document.getElementById("sigmaIncrease"),
  chartSummary: document.getElementById("chartSummary"),
  systemWarning: document.getElementById("systemWarning"),
  systemWarningTitle: document.getElementById("systemWarningTitle"),
  systemWarningMessage: document.getElementById("systemWarningMessage"),
  systemHeadline: document.getElementById("systemHeadline"),
  routesServiceStatus: document.getElementById("routesServiceStatus"),
  ingestServiceStatus: document.getElementById("ingestServiceStatus"),
  apiServiceStatus: document.getElementById("apiServiceStatus"),
  databaseStatus: document.getElementById("databaseStatus"),
  pipelineStatus: document.getElementById("pipelineStatus"),
  lastIngest: document.getElementById("lastIngest"),
  i25SampleCount: document.getElementById("i25SampleCount"),
  i70SampleCount: document.getElementById("i70SampleCount")
};

initializeDashboard();

function initializeDashboard() {
  initializeTheme();
  initializeCorridorFocus();
  initializeControls();
  void refreshDashboard();
  if (!HISTORICAL_MODE) {
    state.refreshTimer = window.setInterval(
      () => void refreshDashboard(),
      REPLAY_MODE ? REPLAY_REFRESH_MS : AUTO_REFRESH_MS
    );
  }
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
  if (state.routeData.size > 0) {
    window.requestAnimationFrame(drawAllCharts);
  }
}

function initializeCorridorFocus() {
  const requestedCorridor = String(new URLSearchParams(window.location.search).get("corridor") || "ALL").toUpperCase();
  const initialFocus = CORRIDOR_IDS.includes(requestedCorridor) ? requestedCorridor : "ALL";
  elements.corridorSelect.value = initialFocus;
  applyCorridorFocus(initialFocus, false);
}

function initializeControls() {
  updateReferenceBandControl();
  elements.corridorSelect.addEventListener("change", () => {
    applyCorridorFocus(elements.corridorSelect.value, true);
  });

  elements.refreshButton.addEventListener("click", () => void refreshDashboard());

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

  elements.sigmaControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-sigma-step]");
    if (!button) return;
    setReferenceSigma(state.referenceSigma + Number(button.dataset.sigmaStep));
  });

  for (const link of document.querySelectorAll("[data-incident-toggle]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const corridor = link.dataset.incidentToggle;
      if (state.expandedIncidents.has(corridor)) state.expandedIncidents.delete(corridor);
      else state.expandedIncidents.add(corridor);
      renderIncidentTable(corridor, state.routeData.get(corridor)?.incidentThreads || []);
    });
  }

  elements.rangeControl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-hours]");
    if (!button) return;
    const requestedHours = Number(button.dataset.hours);
    if (!Number.isFinite(requestedHours) || requestedHours === state.selectedHours) return;
    state.selectedHours = requestedHours;
    for (const rangeButton of elements.rangeControl.querySelectorAll("button[data-hours]")) {
      const active = Number(rangeButton.dataset.hours) === requestedHours;
      rangeButton.classList.toggle("active", active);
      rangeButton.setAttribute("aria-pressed", String(active));
    }
    void refreshDashboard();
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(drawAllCharts, 120);
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
    const routeData = state.routeData.get(corridor);
    if (!routeData) continue;
    const endTime = routeEndTime(routeData);
    const startTime = endTime - state.selectedHours * 3_600_000;
    const series = buildBaselineSeries(
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
  const normalized = CORRIDOR_IDS.includes(corridor) ? corridor : "ALL";
  state.focusedCorridor = normalized;
  document.body.dataset.focus = normalized === "ALL" ? "" : normalized;
  elements.corridorSelect.value = normalized;
  const zoneButton = elements.chartViewControl.querySelector('button[data-chart-view="zones"]');
  zoneButton.disabled = normalized === "ALL";
  if (normalized === "ALL") setChartView("overall");
  else updateChartCopy();
  updateReferenceBandControl();
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
  state.chartView = view;
  document.body.dataset.chartView = view;
  for (const button of elements.chartViewControl.querySelectorAll("button[data-chart-view]")) {
    const active = button.dataset.chartView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  updateChartCopy();
  window.requestAnimationFrame(drawAllCharts);
}

function updateChartCopy() {
  const label = CORRIDOR_CONFIG[state.focusedCorridor]?.label;
  elements.comparisonTitle.textContent = state.chartView === "zones"
    ? `${label || "Corridor"} Speed Zones`
    : `${label || "Corridor"} Speed vs 3-Month Baseline`;
}

async function refreshDashboard() {
  if (state.refreshing) { state.refreshPending = true; return; }
  state.refreshing = true;
  const requestedHours = state.selectedHours;
  elements.refreshButton.setAttribute("aria-busy", "true");
  setStatus(DEMO_MODE ? "Refreshing the local design preview…"
    : HISTORICAL_MODE ? "Loading retained corridor data…"
      : REPLAY_MODE ? "Advancing the retained-data replay…" : "Refreshing live corridor data…");

  try {
    const dashboardData = DEMO_MODE ? buildDemoDashboardData() : await loadLiveDashboardData(requestedHours);
    if (requestedHours !== state.selectedHours) return;
    state.routeData = dashboardData.routeData;
    state.health = dashboardData.health;
    renderDashboard();
    const failures = dashboardData.health?.failures || [];
    const historicalTime = latestRouteTime(dashboardData.routeData);
    const successStatus = HISTORICAL_MODE
      ? `Historical snapshot · ${formatShortDateTime(historicalTime)} · Ingestion off`
      : REPLAY_MODE
        ? `Replay live · ${formatShortDateTime(historicalTime)} · ${formatReplayRate(REPLAY_CONFIG.rate)} · Ingestion off`
        : `${DEMO_MODE ? "Demo preview · Sample data" : "Data"} updated at ${formatClockTime(new Date())} · Auto-refresh every 60 seconds`;
    setStatus(failures.length ? `Some data is unavailable: ${failures.join("; ")}` : successStatus, failures.length > 0);
  } catch (error) {
    state.routeData = new Map();
    state.health = null;
    renderDashboard();
    setStatus(error instanceof Error ? error.message : "Dashboard data is unavailable.", true);
  } finally {
    state.refreshing = false;
    elements.refreshButton.removeAttribute("aria-busy");
    if (state.refreshPending || requestedHours !== state.selectedHours) {
      state.refreshPending = false;
      void refreshDashboard();
    }
  }
}

async function loadLiveDashboardData(selectedHours) {
  const replayAnchor = REPLAY_MODE ? replayAsOf() : null;
  const trendWindowHours = selectedHours + 169;
  const trendLimit = trendWindowHours + 1;
  const incidentWindowMinutes = Math.max(RECENT_INCIDENT_WINDOW_MINUTES, selectedHours * 60);
  const historicalIncidentWindowMinutes = Math.min(43_200, selectedHours * 60);
  const failures = [];
  const healthPromise = Promise.allSettled([
    fetchJson("/actuator/health"),
    fetchJson("/dashboard-api/traffic/map/corridors"),
    fetchJson("/dashboard-api/system/operational-status")
  ]);

  const routeResults = await Promise.allSettled(CORRIDOR_IDS.map(async (corridor) => {
    const replayAsOfParam = replayAnchor ? `&asOf=${encodeURIComponent(replayAnchor.toISOString())}` : "";
    const summaryPath = REPLAY_MODE
      ? `/dashboard-api/traffic/history?corridor=${corridor}&windowMinutes=60&limit=1&preferUsable=true&includeIncidents=true${replayAsOfParam}`
      : `/dashboard-api/traffic/summary?corridor=${corridor}&windowHours=168&recentIncidentWindowMinutes=${RECENT_INCIDENT_WINDOW_MINUTES}&preferUsable=true`;
    const summaryResult = await Promise.allSettled([fetchJson(summaryPath)]).then(([result]) => result);
    const summary = summaryResult.status === "fulfilled"
      ? (REPLAY_MODE ? buildReplaySummary(summaryResult.value, replayAnchor) : summaryResult.value)
      : null;
    const rawDataAnchor = summary?.latest?.polledAt;
    const dataAnchor = REPLAY_MODE && replayAnchor
      ? replayAnchor.toISOString()
      : HISTORICAL_MODE && parseDate(rawDataAnchor) ? String(rawDataAnchor) : null;
    const asOfParam = dataAnchor ? `&asOf=${encodeURIComponent(dataAnchor)}` : "";
    const detailWindowMinutes = Math.min(selectedHours * 60, 10_080);
    const detailSampleLimit = detailedSpeedSampleLimit(detailWindowMinutes);
    const otherResults = await Promise.allSettled([
      fetchJson(`/dashboard-api/traffic/analytics/trends?corridor=${corridor}&windowHours=${trendWindowHours}&limit=${trendLimit}&preferUsable=true${asOfParam}`),
      HISTORICAL_MODE || REPLAY_MODE
        ? fetchJson(`/dashboard-api/traffic/map/incidents/timeline?corridor=${corridor}&windowMinutes=${historicalIncidentWindowMinutes}&limit=1000${asOfParam}`)
        : fetchJson(`/dashboard-api/traffic/map/incidents/recent?corridor=${corridor}&windowMinutes=${incidentWindowMinutes}&limit=1000`),
      fetchJson(`/dashboard-api/traffic/zones/history?corridor=${corridor}&windowMinutes=${detailWindowMinutes}&limit=1000${asOfParam}`),
      selectedHours <= 24
        ? fetchJson(`/dashboard-api/traffic/history?corridor=${corridor}&windowMinutes=${detailWindowMinutes}&limit=${detailSampleLimit}&preferUsable=true&includeIncidents=false${asOfParam}`)
        : Promise.resolve({ samples: [] }),
      fetchJson(`/dashboard-api/traffic/analytics/baselines?corridor=${corridor}${asOfParam}`)
    ]);
    const results = [summaryResult, ...otherResults];
    const names = ["summary", "speed history", "incidents", "speed zones", "detailed speeds", "baseline profile"];
    results.forEach((result, index) => {
      if (result.status === "rejected") failures.push(`${corridor} ${names[index]}`);
    });
    const [, trend, incidents, zones, history, baseline] = results.map(result => result.status === "fulfilled" ? result.value : null);
    if (results.every(result => result.status === "rejected")) throw new Error("Unavailable");
    const route = buildRouteData(corridor, summary, trend, incidents, dataAnchor, history, baseline);
    route.incidentsAvailable = incidents !== null;
    route.incidentsTruncated = (incidents?.features?.length || 0) >= 1000;
    route.zones = zones?.samples || [];
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

  return {
    routeData,
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
    ? legacySnapshotIncidentFeatures(summary?.latest) : incidentFeatures;
  const incidentThreads = aggregateIncidentThreads(resolvedIncidentFeatures, dataAnchor);
  return {
    corridor,
    summary: summary || {},
    trend: trend || { buckets: [] },
    history: history || { samples: [] },
    baseline: baseline || { profiles: [] },
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

async function fetchJson(path) {
  const response = await window.fetch(path, {
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

function renderDashboard() {
  for (const corridor of CORRIDOR_IDS) {
    const routeData = state.routeData.get(corridor);
    renderCorridorSummary(corridor, routeData);
    renderIncidentTable(corridor, routeData?.incidentThreads || []);
  }
  renderWarning();
  renderSystemHealth();
  updateReferenceBandControl();
  window.requestAnimationFrame(drawAllCharts);
}

function renderCorridorSummary(corridor, routeData) {
  const config = CORRIDOR_CONFIG[corridor];
  const summary = routeData?.summary || {};
  const latest = summary.latest || {};
  const speed = finiteNumber(latest.avgCurrentSpeed);
  const delayMinutes = estimateDelayMinutes(config.distanceMiles, speed, finiteNumber(latest.avgFreeflowSpeed));
  const activeIncidents = (routeData?.incidentThreads || []).filter((thread) => thread.ongoing).length;
  const worst = slowestCurrentZone(routeData?.zones || [], latest.polledAt);
  const worstMileMarkers = formatZoneMileMarkerRange(worst);
  const minimumSpeed = finiteNumber(worst?.avgCurrentSpeed);

  setText(`${config.summaryPrefix}AverageSpeed`, formatMetricNumber(speed, 0));
  setText(`${config.summaryPrefix}AverageDelay`, formatMetricNumber(delayMinutes, 0));
  setText(`${config.summaryPrefix}ActiveIncidents`, routeData?.incidentsAvailable === false || !routeData ? "—" : `${activeIncidents}${routeData.incidentsTruncated ? "+" : ""}`);
  setText(`${config.summaryPrefix}WorstMileMarker`, worstMileMarkers || "MM unavailable");
  setText(`${config.summaryPrefix}WorstSpeed`, Number.isFinite(minimumSpeed) ? `${Math.round(minimumSpeed)} mph` : "");
}

function estimateDelayMinutes(distanceMiles, currentSpeed, freeflowSpeed) {
  if (!Number.isFinite(currentSpeed) || currentSpeed <= 0 || !Number.isFinite(freeflowSpeed) || freeflowSpeed <= 0) return Number.NaN;
  const delay = ((distanceMiles / currentSpeed) - (distanceMiles / freeflowSpeed)) * 60;
  return Math.max(0, delay);
}

function slowestCurrentZone(zones, sampleTime) {
  const time = dateMillis(sampleTime);
  if (!time || (!(HISTORICAL_MODE || REPLAY_MODE) && Date.now() - time > 60 * 60_000)) return null;
  return zones.filter(zone => dateMillis(zone.polledAt) === time && Number.isFinite(finiteNumber(zone.avgCurrentSpeed)))
    .sort((a, b) => a.avgCurrentSpeed - b.avgCurrentSpeed)[0] || null;
}

function legacySnapshotIncidentFeatures(latest) {
  if (!latest?.incidentsJson || !latest.polledAt) return [];
  try {
    const payload = typeof latest.incidentsJson === "string" ? JSON.parse(latest.incidentsJson) : latest.incidentsJson;
    if (!Array.isArray(payload?.incidents)) return [];
    return payload.incidents.filter((incident) => isActionableLegacyIncident(incident?.properties)).map((incident) => {
      const properties = incident?.properties || {};
      const typeLabel = legacyIncidentTypeLabel(properties.iconCategory, properties.description);
      const marker = Number.isFinite(finiteNumber(properties.closestMileMarker))
        ? finiteNumber(properties.closestMileMarker).toFixed(1) : "unknown";
      const identity = [properties.travelDirection || "?", typeLabel, marker].join("|");
      return {
        id: `snapshot-${latest.corridor || "corridor"}-${identity}`,
        geometry: incident?.geometry || null,
        properties: {
          ...properties,
          corridor: latest.corridor,
          incidentProvider: latest.incidentProvider || "snapshot",
          providerEventId: `snapshot-${identity}`,
          incidentTypeLabel: typeLabel,
          firstSeenAt: latest.polledAt,
          lastSeenAt: latest.polledAt,
          polledAt: latest.polledAt,
          active: true
        }
      };
    });
  } catch {
    return [];
  }
}

function isActionableLegacyIncident(properties) {
  const category = Number(properties?.iconCategory);
  return [1, 7, 8, 9, 14].includes(category);
}

function legacyIncidentTypeLabel(iconCategory, description) {
  const labels = {
    1: "Accident", 7: "Lane closed", 8: "Road closed", 9: "Road works",
    13: "Incident cluster", 14: "Broken down vehicle"
  };
  return String(description || labels[Number(iconCategory)] || `Incident type ${iconCategory ?? "unknown"}`);
}

function aggregateIncidentThreads(features, referenceTime = null) {
  const groups = new Map();
  for (const feature of features) {
    const properties = feature?.properties || {};
    const key = incidentThreadKey(feature);
    const firstSeenAt = parseDate(properties.firstSeenAt || properties.polledAt || properties.sourceUpdatedAt);
    const lastSeenAt = parseDate(properties.lastSeenAt || properties.polledAt || properties.sourceUpdatedAt);
    const existing = groups.get(key);
    const type = normalizeIncidentType(properties.normalizedCategory || properties.incidentTypeLabel || properties.iconCategory);
    const locationLabel = buildIncidentLocation(properties);
    if (!existing) {
      groups.set(key, {
        key,
        type,
        locationLabel,
        firstSeenAt,
        lastSeenAt,
        active: properties.active,
        archived: Boolean(properties.archived),
        normalizedStatus: String(properties.normalizedStatus || ""),
        sourceUpdatedAt: parseDate(properties.sourceUpdatedAt)
      });
      continue;
    }
    if (firstSeenAt && (!existing.firstSeenAt || firstSeenAt < existing.firstSeenAt)) existing.firstSeenAt = firstSeenAt;
    if (lastSeenAt && (!existing.lastSeenAt || lastSeenAt >= existing.lastSeenAt)) {
      existing.lastSeenAt = lastSeenAt;
      existing.active = properties.active;
      existing.normalizedStatus = String(properties.normalizedStatus || "");
    }
    const sourceUpdatedAt = parseDate(properties.sourceUpdatedAt);
    if (sourceUpdatedAt && (!existing.sourceUpdatedAt || sourceUpdatedAt > existing.sourceUpdatedAt)) {
      existing.sourceUpdatedAt = sourceUpdatedAt;
    }
    existing.archived = existing.archived && Boolean(properties.archived);
    if (existing.type === "Other" && type !== "Other") existing.type = type;
    if (existing.locationLabel === "Location unavailable" && locationLabel !== "Location unavailable") {
      existing.locationLabel = locationLabel;
    }
  }

  const now = parseDate(referenceTime) || new Date();
  return [...groups.values()]
    .map((thread) => ({ ...thread, ongoing: incidentIsOngoing(thread, now) }))
    .sort((left, right) => {
      if (left.ongoing !== right.ongoing) return left.ongoing ? -1 : 1;
      return dateMillis(right.lastSeenAt) - dateMillis(left.lastSeenAt);
    });
}

function incidentThreadKey(feature) {
  const properties = feature?.properties || {};
  return `${properties.incidentProvider || "unknown"}|${properties.corridor || ""}|${String(properties.providerEventId
    || properties.referenceKey
    || properties.incidentRefId
    || feature?.id
    || `${properties.locationLabel}|${properties.iconCategory}`)}`;
}

function buildIncidentLocation(properties) {
  const marker = finiteNumber(properties.closestMileMarker);
  const markerLabel = Number.isFinite(marker) ? `MP ${formatMileMarker(marker)}` : "";
  const location = String(properties.locationLabel || properties.referenceLabel || "").trim();
  const markerValue = Number.isFinite(marker) ? formatMileMarker(marker).toLowerCase() : "";
  const locationIncludesMarker = markerValue && ["mp", "mm"]
    .some(prefix => location.toLowerCase().includes(`${prefix} ${markerValue}`));
  if (markerLabel && location && !locationIncludesMarker) {
    return `${markerLabel} · ${location}`;
  }
  return location || markerLabel || "Location unavailable";
}

function incidentIsOngoing(thread, now) {
  if (typeof thread.active === "boolean") return thread.active;
  const status = String(thread.normalizedStatus || "").toLowerCase();
  const ended = thread.archived || ["cleared", "closed", "ended", "inactive", "resolved"].some((value) => status.includes(value));
  if (ended || !thread.lastSeenAt) return false;
  const ageMinutes = Math.max(0, (now.getTime() - thread.lastSeenAt.getTime()) / 60_000);
  return ageMinutes <= ONGOING_INCIDENT_WINDOW_MINUTES;
}

function renderIncidentTable(corridor, incidentThreads) {
  const config = CORRIDOR_CONFIG[corridor];
  const tableBody = document.getElementById(config.incidentRowsId);
  tableBody.replaceChildren();
  const expanded = state.expandedIncidents.has(corridor);
  const rows = expanded ? incidentThreads : incidentThreads.slice(0, 3);
  const link = document.querySelector(`[data-incident-toggle="${corridor}"]`);
  if (link) {
    link.textContent = expanded ? "Show fewer ↑" : `See all ${corridor.replace("I", "I-")} incidents (${incidentThreads.length}) →`;
    link.setAttribute("aria-expanded", String(expanded));
  }
  if (rows.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = !state.routeData.has(corridor) || state.routeData.get(corridor)?.incidentsAvailable === false
      ? "Incident feed unavailable. Try refreshing." : "No recent incidents in the selected window.";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  for (const incident of rows) {
    const row = document.createElement("tr");
    row.appendChild(buildIncidentNameCell(incident));
    row.appendChild(buildTextCell(incident.locationLabel));
    row.appendChild(buildTextCell(formatShortDateTime(incident.firstSeenAt)));
    row.appendChild(buildLastSeenCell(incident));
    tableBody.appendChild(row);
  }
}

function buildIncidentNameCell(incident) {
  const cell = document.createElement("td");
  const wrapper = document.createElement("span");
  wrapper.className = "incident-name";
  const symbol = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  symbol.setAttribute("class", `incident-symbol ${incidentSymbolClass(incident.type)}`);
  symbol.setAttribute("aria-hidden", "true");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "use");
  icon.setAttribute("href", incidentIconHref(incident.type));
  symbol.appendChild(icon);
  const label = document.createElement("span");
  label.textContent = incident.type;
  wrapper.append(symbol, label);
  cell.appendChild(wrapper);
  return cell;
}

function buildTextCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  cell.title = value || "";
  return cell;
}

function buildLastSeenCell(incident) {
  const cell = document.createElement("td");
  const timestamp = document.createElement("span");
  timestamp.textContent = formatShortDateTime(incident.lastSeenAt);
  cell.appendChild(timestamp);
  if (incident.ongoing) {
    const status = document.createElement("span");
    status.className = "ongoing-pill";
    status.textContent = "Ongoing";
    cell.appendChild(status);
  }
  return cell;
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
  const routeEntries = [...state.routeData.values()];
  const apiHealthy = state.health?.apiUp === true;
  const routesHealthy = state.health?.routesUp === true;
  const databaseHealthy = state.health?.databaseUp === true;
  const ingestHealthy = state.health?.operational?.status === "HEALTHY";
  const retainedDataMode = HISTORICAL_MODE || REPLAY_MODE;
  const allHealthy = !retainedDataMode && apiHealthy && routesHealthy && databaseHealthy && ingestHealthy && !state.health?.partial;

  setServiceStatus(elements.routesServiceStatus, routesHealthy ? "Catalog ready" : "Unavailable", routesHealthy);
  elements.routesServiceStatus.title = "Stored route catalog availability; not a routes-service liveness probe.";
  setServiceStatus(elements.ingestServiceStatus, retainedDataMode ? "Off for replay" : ingestHealthy ? "Feeds current" : "Unconfirmed", !retainedDataMode && ingestHealthy);
  elements.ingestServiceStatus.title = "Flow, incident and provider checks from the operational status API.";
  setServiceStatus(elements.apiServiceStatus, apiHealthy ? "Healthy" : "Unavailable", apiHealthy);
  setServiceStatus(elements.databaseStatus, databaseHealthy ? "Connected" : "Unconfirmed", databaseHealthy);
  setServiceStatus(elements.systemHeadline, REPLAY_MODE ? "Historical Live Replay" : HISTORICAL_MODE ? "Historical Data Replay" : allHealthy ? "All Data Checks Passing" : "Some Data Checks Unavailable", allHealthy);
  setServiceStatus(elements.pipelineStatus, REPLAY_MODE ? "Replaying" : HISTORICAL_MODE ? "Historical" : ingestHealthy ? "Live" : "Unconfirmed", !retainedDataMode && ingestHealthy);

  const latestIngest = routeEntries
    .map((entry) => parseDate(entry.summary?.latest?.polledAt))
    .filter(Boolean)
    .sort((left, right) => right - left)[0] || null;
  elements.lastIngest.textContent = latestIngest
    ? (retainedDataMode ? formatShortDateTime(latestIngest) : formatRelativeTime(latestIngest)) : "—";
  for (const corridor of CORRIDOR_IDS) {
    const routeData = state.routeData.get(corridor);
    const buckets = routeData?.trend?.buckets;
    const count = buckets ? trendSampleCount(selectDisplayBuckets(buckets, state.selectedHours, routeEndTime(routeData))) : Number.NaN;
    elements[`${corridor.toLowerCase()}SampleCount`].textContent = formatInteger(count);
  }
}

function setServiceStatus(element, label, healthy) {
  element.textContent = label;
  element.style.color = healthy ? "var(--forest-soft)" : "var(--gold-data)";
}

function trendSampleCount(buckets) {
  return (Array.isArray(buckets) ? buckets : []).reduce((total, bucket) => {
    const count = finiteNumber(bucket?.sampleCount);
    return total + (Number.isFinite(count) ? count : 0);
  }, 0);
}

function drawAllCharts() {
  const summaries = [];
  for (const corridor of CORRIDOR_IDS) {
    const routeData = state.routeData.get(corridor);
    const canvas = document.getElementById(CORRIDOR_CONFIG[corridor].chartId);
    if (state.chartView === "zones" && state.focusedCorridor === corridor) {
      drawZoneChart(canvas, corridor, routeData);
    } else {
      canvas.closest?.(".chart-lane")?.style.removeProperty("--chart-height");
      drawCorridorChart(canvas, corridor, routeData);
    }
    if (routeData) {
      const latestSpeed = finiteNumber(routeData.summary?.latest?.avgCurrentSpeed);
      summaries.push(`${CORRIDOR_CONFIG[corridor].label} is ${formatMetricNumber(latestSpeed, 0)} miles per hour with ${routeData.incidentThreads.filter((thread) => thread.ongoing).length} active incidents.`);
    }
  }
  elements.chartSummary.textContent = summaries.join(" ");
}

function drawCorridorChart(canvas, corridor, routeData) {
  const dimensions = sizeCanvas(canvas);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  const endTime = routeEndTime(routeData);
  const startTime = endTime - state.selectedHours * 3_600_000;
  const detailedSamples = state.selectedHours <= 24 ? routeData?.history?.samples || [] : [];
  const samples = buildCurrentSpeedSeries(routeData?.trend?.buckets || [], detailedSamples, state.selectedHours, endTime);
  const trendSamples = buildSmoothedSpeedSeries(samples, state.selectedHours);
  const baselineSeries = buildBaselineSeries(
    routeData?.trend?.buckets || [],
    startTime,
    endTime,
    routeData?.baseline?.profiles || []
  );
  if (samples.length === 0 && baselineSeries.length === 0) {
    drawEmptyChart(context, dimensions, "No retained speed data in this time window.");
    return;
  }

  const colors = chartColors();
  const padding = { top: 34, right: 18, bottom: 30, left: 50 };
  const plotWidth = dimensions.width - padding.left - padding.right;
  const plotHeight = dimensions.height - padding.top - padding.bottom;
  const timeSpan = Math.max(1, endTime - startTime);
  const domain = calculateCorridorSpeedDomain(samples, baselineSeries);
  const toPoint = point => ({
    ...point,
    horizontalPosition: padding.left + ((point.timestamp - startTime) / timeSpan) * plotWidth,
    verticalPosition: speedToVertical(point.speed, padding.top, plotHeight, domain)
  });
  const currentPoints = samples.map(toPoint);
  const trendPoints = trendSamples.map(toPoint);
  const baselinePoints = baselineSeries.map(toPoint);
  const axisTicks = buildTimeAxisTicks(startTime, endTime, plotWidth);

  drawGrid(context, padding, plotWidth, plotHeight, colors, domain);
  drawNormalBand(context, baselinePoints, padding.top, plotHeight, colors, domain);
  drawTimeGuides(context, axisTicks, padding.left, padding.top, dimensions.height - padding.bottom, colors);
  drawSmoothLine(context, baselinePoints, colors.ink, 2, [6, 6]);
  drawSmoothLine(context, trendPoints, colors[CORRIDOR_CONFIG[corridor].currentColorVariable], 2.8, []);
  drawPointMarkers(context, baselinePoints, colors.ink, true, 0.78);
  drawPointMarkers(context, currentPoints, colors[CORRIDOR_CONFIG[corridor].currentColorVariable], false);
  drawXAxis(context, axisTicks, dimensions, padding, colors);
  drawIncidentFlags(context, corridor, routeData?.incidentThreads || [], currentPoints, startTime, endTime, padding, colors);
}

function drawZoneChart(canvas, corridor, routeData) {
  const groups = groupZoneSeries(routeData?.zones || [], state.selectedHours, routeEndTime(routeData));
  const lane = canvas.closest?.(".chart-lane");
  lane?.style.setProperty("--chart-height", `${Math.max(240, groups.length * 86 + 36)}px`);
  const dimensions = sizeCanvas(canvas);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, dimensions.width, dimensions.height);
  if (groups.length === 0) {
    drawEmptyChart(context, dimensions, "No retained speed-zone observations in this time window.");
    return;
  }

  const colors = chartColors();
  const endTime = routeEndTime(routeData);
  const startTime = endTime - state.selectedHours * 3_600_000;
  const padding = { top: 6, right: 18, bottom: 30, left: 112 };
  const plotWidth = dimensions.width - padding.left - padding.right;
  const contentHeight = dimensions.height - padding.top - padding.bottom;
  const rowHeight = contentHeight / groups.length;
  const allSpeeds = groups.flatMap(group => group.samples.map(sample => sample.speed));
  const domain = calculateSpeedDomain(allSpeeds);
  const color = colors[CORRIDOR_CONFIG[corridor].currentColorVariable];
  const axisTicks = buildTimeAxisTicks(startTime, endTime, plotWidth);

  drawTimeGuides(context, axisTicks, padding.left, padding.top, dimensions.height - padding.bottom, colors);
  groups.forEach((group, index) => {
    const rowTop = padding.top + index * rowHeight;
    const plotTop = rowTop + 12;
    const plotHeight = Math.max(24, rowHeight - 24);
    const points = group.samples.map(sample => ({
      ...sample,
      horizontalPosition: padding.left + ((sample.timestamp - startTime) / Math.max(1, endTime - startTime)) * plotWidth,
      verticalPosition: speedToVertical(sample.speed, plotTop, plotHeight, domain)
    }));
    const trendPoints = buildSmoothedSpeedSeries(group.samples, state.selectedHours).map(sample => ({
      ...sample,
      horizontalPosition: padding.left + ((sample.timestamp - startTime) / Math.max(1, endTime - startTime)) * plotWidth,
      verticalPosition: speedToVertical(sample.speed, plotTop, plotHeight, domain)
    }));
    drawZoneRowGrid(context, padding.left, plotWidth, plotTop, plotHeight, colors, domain);
    drawSmoothLine(context, trendPoints, color, 2.2, []);
    drawPointMarkers(context, points, color, false);
    context.save();
    context.fillStyle = colors.ink;
    context.font = "600 10px Archivo, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(group.marker, 8, rowTop + rowHeight / 2 - 7);
    context.fillStyle = colors.muted;
    context.font = "9px IBM Plex Mono, monospace";
    context.fillText(`${formatMetricNumber(group.latestSpeed, 0)} mph`, 8, rowTop + rowHeight / 2 + 8);
    if (index < groups.length - 1) {
      context.strokeStyle = colors.grid;
      context.setLineDash([]);
      context.beginPath();
      context.moveTo(0, rowTop + rowHeight);
      context.lineTo(dimensions.width, rowTop + rowHeight);
      context.stroke();
    }
    context.restore();
  });
  drawXAxis(context, axisTicks, dimensions, padding, colors);
}

function sizeCanvas(canvas) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
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

function selectDisplayBuckets(sourceBuckets, hours, endTime = Date.now()) {
  const buckets = (Array.isArray(sourceBuckets) ? sourceBuckets : [])
    .filter((bucket) => parseDate(bucket?.bucketStart) && Number.isFinite(finiteNumber(bucket?.avgCurrentSpeed)))
    .sort((left, right) => parseDate(left.bucketStart) - parseDate(right.bucketStart));
  if (buckets.length === 0) return [];
  const cutoff = endTime - hours * 3_600_000;
  return buckets.filter((bucket) => dateMillis(bucket.bucketStart) >= cutoff && dateMillis(bucket.bucketStart) <= endTime);
}

function selectDisplaySamples(sourceSamples, hours, endTime = Date.now()) {
  const cutoff = endTime - hours * 3_600_000;
  return normalizeSpeedSamples(sourceSamples)
    .filter(sample => sample.timestamp >= cutoff && sample.timestamp <= endTime);
}

function normalizeSpeedSamples(sourceSamples) {
  const samplesByTimestamp = new Map();
  for (const sample of Array.isArray(sourceSamples) ? sourceSamples : []) {
    const timestamp = dateMillis(sample.timestamp || sample.polledAt || sample.bucketStart);
    const speed = finiteNumber(sample.speed ?? sample.avgCurrentSpeed);
    if (!timestamp || !Number.isFinite(speed)) continue;
    const repeatEligible = sample.repeatEligible ?? Boolean(sample.polledAt);
    samplesByTimestamp.set(timestamp, {
      timestamp,
      speed,
      repeatEligible,
      signature: String(sample.signature || (repeatEligible ? speedObservationSignature(sample) : "")),
      isCarryForward: Boolean(sample.isCarryForward),
      isBoundary: Boolean(sample.isBoundary)
    });
  }
  let previousSignature = "";
  return [...samplesByTimestamp.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((sample) => {
      const isCarryForward = sample.isCarryForward
        || (!sample.isBoundary && sample.repeatEligible && Boolean(previousSignature) && sample.signature === previousSignature);
      if (!sample.isBoundary && sample.repeatEligible) previousSignature = sample.signature;
      else if (!sample.isBoundary) previousSignature = "";
      return { ...sample, isCarryForward };
    });
}

function speedObservationSignature(sample) {
  if (sample.speedStateSignature) return `state:${sample.speedStateSignature}`;
  const fields = [
    sample.sourceMode,
    sample.avgCurrentSpeed ?? sample.speed,
    sample.avgFreeflowSpeed,
    sample.minCurrentSpeed,
    sample.confidence,
    sample.speedSampleCount,
    sample.p10Speed,
    sample.p50Speed,
    sample.p90Speed,
    sample.incidentCount
  ];
  return fields.map(signatureField).join("|");
}

function signatureField(value) {
  const number = finiteNumber(value);
  if (Number.isFinite(number)) return number.toFixed(3);
  return value == null ? "" : String(value);
}

function buildCurrentSpeedSeries(trendBuckets, detailedSamples, hours, endTime = Date.now()) {
  const hourly = normalizeSpeedSamples(trendBuckets);
  const detailed = normalizeSpeedSamples(detailedSamples);
  const firstDetailedTimestamp = detailed[0]?.timestamp;
  const combined = detailed.length
    ? [...hourly.filter(point => point.timestamp < firstDetailedTimestamp), ...detailed]
    : hourly;
  return clipSpeedSeriesToWindow(combined, endTime - hours * 3_600_000, endTime);
}

function clipSpeedSeriesToWindow(sourceSamples, startTime, endTime) {
  const samples = normalizeSpeedSamples(sourceSamples);
  if (!samples.length) return [];
  const visible = samples.filter(sample => sample.timestamp >= startTime && sample.timestamp <= endTime);
  const startBoundary = speedBoundaryPoint(samples, startTime);
  const endBoundary = speedBoundaryPoint(samples, endTime);
  if (startBoundary && visible[0]?.timestamp !== startTime) visible.unshift(startBoundary);
  if (endBoundary && visible.at(-1)?.timestamp !== endTime) visible.push(endBoundary);
  return visible;
}

function buildSmoothedSpeedSeries(sourceSamples, hours) {
  const samples = normalizeSpeedSamples(sourceSamples);
  const halfWindow = trendSmoothingHalfWindow(hours);
  const pointInterval = trendPointInterval(hours);
  return splitSpeedSeries(samples).flatMap((segment) => segment.length < 3
    ? []
    : smoothedTrendSegment(segment, halfWindow, pointInterval));
}

function smoothedTrendSegment(segment, halfWindow, pointInterval) {
  let firstNearby = 0;
  let afterNearby = 0;
  return trendAnchorTimes(segment, pointInterval).map((timestamp) => {
    while (firstNearby < segment.length && segment[firstNearby].timestamp < timestamp - halfWindow) firstNearby += 1;
    while (afterNearby < segment.length && segment[afterNearby].timestamp <= timestamp + halfWindow) afterNearby += 1;
    return fitLocalLinearTrend(segment.slice(firstNearby, afterNearby), timestamp, halfWindow);
  }).filter(Boolean);
}

function trendAnchorTimes(segment, interval) {
  const first = segment[0].timestamp;
  const last = segment.at(-1).timestamp;
  const timestamps = [first];
  for (let timestamp = first + interval; timestamp < last; timestamp += interval) timestamps.push(timestamp);
  if (last !== first) timestamps.push(last);
  return timestamps;
}

function fitLocalLinearTrend(nearby, timestamp, halfWindow) {
  const fresh = nearby.filter(sample => !sample.isCarryForward);
  const evidence = fresh.length >= 3 ? fresh : nearby;
  if (evidence.length < 2) return null;

  const initialModel = weightedLinearModel(evidence, timestamp, halfWindow);
  const residuals = evidence.map(sample => {
    const horizontal = (sample.timestamp - timestamp) / halfWindow;
    return Math.abs(sample.speed - (initialModel.intercept + initialModel.slope * horizontal));
  });
  const residualScale = Math.max(0.75, 1.4826 * medianNumber(residuals));
  const robustWeights = residuals.map(residual => {
    const ratio = residual / (6 * residualScale);
    return ratio >= 1 ? 0 : Math.pow(1 - ratio * ratio, 2);
  });
  const model = weightedLinearModel(evidence, timestamp, halfWindow, robustWeights) || initialModel;
  const minimumSpeed = Math.min(...evidence.map(sample => sample.speed));
  const maximumSpeed = Math.max(...evidence.map(sample => sample.speed));
  return { timestamp, speed: Math.max(minimumSpeed, Math.min(maximumSpeed, model.intercept)) };
}

function weightedLinearModel(samples, targetTimestamp, halfWindow, robustWeights = []) {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let t0 = 0;
  let t1 = 0;
  samples.forEach((sample, index) => {
    const horizontal = (sample.timestamp - targetTimestamp) / halfWindow;
    const distanceWeight = Math.exp(-2 * horizontal * horizontal);
    const weight = distanceWeight * (robustWeights[index] ?? 1);
    s0 += weight;
    s1 += weight * horizontal;
    s2 += weight * horizontal * horizontal;
    t0 += weight * sample.speed;
    t1 += weight * horizontal * sample.speed;
  });

  if (s0 <= Number.EPSILON) return null;
  const determinant = s0 * s2 - s1 * s1;
  if (Math.abs(determinant) <= 1e-9) return { intercept: t0 / s0, slope: 0 };
  return {
    intercept: (t0 * s2 - t1 * s1) / determinant,
    slope: (s0 * t1 - s1 * t0) / determinant
  };
}

function medianNumber(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function trendSmoothingHalfWindow(hours) {
  if (hours <= 2) return 20 * 60_000;
  if (hours <= 6) return 40 * 60_000;
  if (hours <= 24) return 90 * 60_000;
  return 3 * 3_600_000;
}

function trendPointInterval(hours) {
  if (hours <= 2) return 8 * 60_000;
  if (hours <= 6) return 15 * 60_000;
  if (hours <= 24) return 45 * 60_000;
  if (hours <= 168) return 60 * 60_000;
  return 60 * 60_000;
}

function splitSpeedSeries(samples) {
  const segments = [];
  let current = [];
  for (const sample of samples) {
    if (current.length && sample.timestamp - current.at(-1).timestamp > 90 * 60_000) {
      segments.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length) segments.push(current);
  return segments;
}

function speedBoundaryPoint(samples, timestamp) {
  const exact = samples.find(point => point.timestamp === timestamp);
  if (exact) return { ...exact };
  const previous = [...samples].reverse().find(point => point.timestamp < timestamp);
  const next = samples.find(point => point.timestamp > timestamp);
  const maximumGap = 90 * 60_000;
  if (previous && next && next.timestamp - previous.timestamp <= maximumGap) {
    const fraction = (timestamp - previous.timestamp) / (next.timestamp - previous.timestamp);
    return { timestamp, speed: previous.speed + (next.speed - previous.speed) * fraction, isBoundary: true };
  }
  if (previous && !next && timestamp - previous.timestamp <= maximumGap) {
    return { timestamp, speed: previous.speed, isBoundary: true };
  }
  return null;
}

function buildBaselineSeries(sourceBuckets, startTime, endTime, profiles = []) {
  const timestamps = baselineTimestamps(startTime, endTime);
  const profileMap = new Map((Array.isArray(profiles) ? profiles : [])
    .map(profile => {
      const day = finiteNumber(profile?.dayOfWeek);
      const hour = finiteNumber(profile?.hourOfDay);
      const speed = finiteNumber(profile?.meanSpeed);
      const standardDeviation = finiteNumber(profile?.standardDeviation);
      if (!Number.isInteger(day) || day < 1 || day > 7 || !Number.isInteger(hour)
        || hour < 0 || hour > 23 || !Number.isFinite(speed) || !Number.isFinite(standardDeviation)) return null;
      return [`${day}|${hour}`, profile];
    })
    .filter(Boolean));
  const legacyByTimestamp = new Map(buildLegacyBaselineSeries(sourceBuckets, timestamps)
    .map(point => [point.timestamp, point]));
  return timestamps.map(timestamp => {
    const profile = profileMap.get(denverProfileKey(timestamp));
    if (!profile) return legacyByTimestamp.get(timestamp) || null;
    return {
      timestamp,
      speed: finiteNumber(profile.meanSpeed),
      standardDeviation: finiteNumber(profile.standardDeviation),
      effectiveSampleSize: finiteNumber(profile.effectiveSampleSize),
      sampleCount: finiteNumber(profile.sampleCount),
      sourceProfile: profile.sourceProfile,
      coverageOneSigma: finiteNumber(profile.coverageOneSigma),
      coverageTwoSigma: finiteNumber(profile.coverageTwoSigma),
      coverageThreeSigma: finiteNumber(profile.coverageThreeSigma)
    };
  }).filter(Boolean);
}

function baselineTimestamps(startTime, endTime) {
  const hour = 3_600_000;
  const firstHour = Math.ceil(startTime / hour) * hour;
  const timestamps = [startTime];
  for (let timestamp = firstHour; timestamp < endTime; timestamp += hour) {
    if (timestamp > startTime) timestamps.push(timestamp);
  }
  if (endTime > startTime) timestamps.push(endTime);
  return timestamps;
}

function buildLegacyBaselineSeries(sourceBuckets, timestamps) {
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", hourCycle: "h23", timeZone: "America/Denver"
  });
  const source = (Array.isArray(sourceBuckets) ? sourceBuckets : [])
    .map(bucket => ({ timestamp: dateMillis(bucket.bucketStart), speed: finiteNumber(bucket.avgCurrentSpeed) }))
    .filter(point => point.timestamp && Number.isFinite(point.speed))
    .sort((left, right) => left.timestamp - right.timestamp);
  const hour = 3_600_000;
  const series = [];
  for (const timestamp of timestamps) {
    const localHour = hourFormatter.format(new Date(timestamp));
    const prior = source.filter(point => point.timestamp >= timestamp - 168 * hour
      && point.timestamp < timestamp
      && hourFormatter.format(new Date(point.timestamp)) === localHour);
    if (prior.length) {
      const speed = prior.reduce((sum, point) => sum + point.speed, 0) / prior.length;
      const variance = prior.reduce((sum, point) => sum + (point.speed - speed) ** 2, 0) / prior.length;
      series.push({
        timestamp,
        speed,
        standardDeviation: Math.sqrt(variance)
      });
    }
  }
  return series;
}

function denverProfileKey(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "numeric", hourCycle: "h23", timeZone: "America/Denver"
  }).formatToParts(new Date(timestamp));
  const weekday = parts.find(part => part.type === "weekday")?.value;
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  const day = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekday];
  return `${day}|${hour}`;
}

function groupZoneSeries(sourceRows, hours, endTime = Date.now()) {
  const cutoff = endTime - hours * 3_600_000;
  const groups = new Map();
  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const timestamp = dateMillis(row.polledAt);
    const speed = finiteNumber(row.avgCurrentSpeed);
    if (!timestamp || timestamp < cutoff || timestamp > endTime || !Number.isFinite(speed)) continue;
    const key = String(row.zoneKey || `${row.startMileMarker}-${row.endMileMarker}`);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        order: finiteNumber(row.zoneOrder),
        marker: formatZoneMileMarkerRange(row) || String(row.zoneLabel || "Speed zone"),
        samples: []
      });
    }
    groups.get(key).samples.push({
      timestamp,
      speed,
      repeatEligible: true,
      signature: speedObservationSignature(row)
    });
  }
  return [...groups.values()]
    .map(group => {
      group.samples = normalizeSpeedSamples(group.samples);
      group.latestSpeed = group.samples.at(-1)?.speed;
      return group;
    })
    .sort((left, right) => (Number.isFinite(left.order) ? left.order : 999) - (Number.isFinite(right.order) ? right.order : 999));
}

function calculateSpeedDomain(values) {
  const speeds = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  if (!speeds.length) return { min: 0, max: 100, step: 20 };
  const observedMin = Math.max(0, Math.min(...speeds));
  const observedMax = Math.min(100, Math.max(...speeds));
  const observedSpan = Math.max(0, observedMax - observedMin);
  const desiredSpan = Math.max(8, observedSpan * 1.1);
  const step = niceSpeedStep(desiredSpan / 6);
  const headroom = observedSpan > 0 ? observedSpan * 0.05 : step;
  let min = Math.max(0, Math.floor((observedMin - headroom) / step) * step);
  let max = Math.min(100, Math.ceil((observedMax + headroom) / step) * step);
  while (max - min < 8) {
    const lowerHeadroom = observedMin - min;
    const upperHeadroom = max - observedMax;
    if (max <= 100 - step && (min < step || upperHeadroom <= lowerHeadroom)) max += step;
    else if (min >= step) min -= step;
    else break;
  }
  return { min, max, step };
}

function calculateCorridorSpeedDomain(samples, baselineSeries) {
  return calculateSpeedDomain([
    ...(Array.isArray(samples) ? samples : []).map(point => point.speed),
    ...(Array.isArray(baselineSeries) ? baselineSeries : []).map(point => point.speed)
  ]);
}

function niceSpeedStep(idealStep) {
  return [1, 2, 5, 10, 20].find(step => step >= idealStep) || 20;
}

function referenceBandLimits(point) {
  const standardDeviation = finiteNumber(point?.standardDeviation);
  const radius = Number.isFinite(standardDeviation) ? standardDeviation * state.referenceSigma : 0;
  return {
    lower: point.speed - radius,
    upper: point.speed + radius
  };
}

function buildRollingBaselines(buckets) {
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", hourCycle: "h23", timeZone: "America/Denver"
  });
  const groups = new Map();
  const baselines = new Map();
  const points = (Array.isArray(buckets) ? buckets : [])
    .filter(point => parseDate(point.bucketStart) && Number.isFinite(finiteNumber(point.avgCurrentSpeed)))
    .slice().sort((a, b) => dateMillis(a.bucketStart) - dateMillis(b.bucketStart));
  for (const point of points) {
    const time = dateMillis(point.bucketStart);
    const hour = hourFormatter.format(new Date(time));
    const prior = (groups.get(hour) || []).filter(row => row.time >= time - 168 * 3_600_000);
    const earlier = prior.filter(row => row.time < time);
    // Each preceding Denver hour contributes equally. Missing hours stay absent.
    baselines.set(time, earlier.length
      ? earlier.reduce((sum, row) => sum + row.speed, 0) / earlier.length : Number.NaN);
    prior.push({ time, speed: Number(point.avgCurrentSpeed) });
    groups.set(hour, prior);
  }
  return baselines;
}

function drawGrid(context, padding, plotWidth, plotHeight, colors, domain) {
  context.save();
  context.font = "10px IBM Plex Mono, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillStyle = colors.muted;
  context.fillText("mph", padding.left - 8, padding.top - 12);
  for (let speed = domain.min; speed <= domain.max + 0.01; speed += domain.step) {
    const verticalPosition = speedToVertical(speed, padding.top, plotHeight, domain);
    const major = speed % 10 === 0;
    context.strokeStyle = major ? colors.gridStrong : colors.grid;
    context.lineWidth = major ? 1.1 : 1;
    context.setLineDash(major ? [] : [3, 3]);
    context.beginPath();
    context.moveTo(padding.left, verticalPosition);
    context.lineTo(padding.left + plotWidth, verticalPosition);
    context.stroke();
    context.fillStyle = colors.muted;
    context.fillText(String(speed), padding.left - 8, verticalPosition);
  }
  context.restore();
}

function drawZoneRowGrid(context, plotLeft, plotWidth, plotTop, plotHeight, colors, domain) {
  context.save();
  for (let speed = domain.min; speed <= domain.max + 0.01; speed += domain.step) {
    const verticalPosition = speedToVertical(speed, plotTop, plotHeight, domain);
    context.strokeStyle = speed % 10 === 0 ? colors.gridStrong : colors.grid;
    context.lineWidth = 1;
    context.setLineDash([2, 4]);
    context.beginPath();
    context.moveTo(plotLeft, verticalPosition);
    context.lineTo(plotLeft + plotWidth, verticalPosition);
    context.stroke();
  }
  context.restore();
}

function drawNormalBand(context, baselinePoints, plotTop, plotHeight, colors, domain) {
  for (const segment of chartSegments(baselinePoints)) drawBandSegment(context, segment, plotTop, plotHeight, colors, domain);
}

function chartSegments(points) {
  const segments = [];
  let current = [];
  for (const point of points) {
    if (!Number.isFinite(point.verticalPosition) || (current.length && point.timestamp - current[current.length - 1].timestamp > 90 * 60_000)) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (Number.isFinite(point.verticalPosition)) current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

function drawBandSegment(context, baselinePoints, plotTop, plotHeight, colors, domain) {
  if (baselinePoints.length < 2) return;
  context.save();
  context.fillStyle = colors.band;
  context.beginPath();
  baselinePoints.forEach((point, pointIndex) => {
    const verticalPosition = speedToVertical(referenceBandLimits(point).upper, plotTop, plotHeight, domain);
    if (pointIndex === 0) context.moveTo(point.horizontalPosition, verticalPosition);
    else context.lineTo(point.horizontalPosition, verticalPosition);
  });
  [...baselinePoints].reverse().forEach((point) => {
    context.lineTo(point.horizontalPosition, speedToVertical(referenceBandLimits(point).lower, plotTop, plotHeight, domain));
  });
  context.closePath();
  context.fill();
  context.restore();
}

function drawSmoothLine(context, points, color, lineWidth, dash) {
  for (const segment of chartSegments(points)) drawLineSegment(context, segment, color, lineWidth, dash);
}

function drawPointMarkers(context, points, color, hollow, scale = 1) {
  const radius = pointMarkerRadius(points.length) * scale;
  const panelColor = chartColors().panel;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = Math.max(1.15, radius * 0.52);
  for (const point of points) {
    if (point.isBoundary || !Number.isFinite(point.horizontalPosition) || !Number.isFinite(point.verticalPosition)) continue;
    const isHollow = hollow || point.isCarryForward;
    context.beginPath();
    context.arc(point.horizontalPosition, point.verticalPosition, radius, 0, Math.PI * 2);
    context.fillStyle = isHollow ? panelColor : color;
    context.globalAlpha = isHollow ? 1 : 0.34;
    context.fill();
    context.globalAlpha = 1;
    context.stroke();
  }
  context.restore();
}

function pointMarkerRadius(pointCount) {
  if (pointCount > 400) return 2.1;
  if (pointCount > 160) return 2.5;
  return 3.2;
}

function drawLineSegment(context, points, color, lineWidth, dash) {
  if (points.length === 1) {
    context.save();
    context.fillStyle = color;
    context.beginPath();
    context.arc(points[0].horizontalPosition, points[0].verticalPosition, 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash(dash);
  context.beginPath();
  context.moveTo(points[0].horizontalPosition, points[0].verticalPosition);
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const previous = points[pointIndex - 1];
    const current = points[pointIndex];
    const midpoint = (previous.horizontalPosition + current.horizontalPosition) / 2;
    context.quadraticCurveTo(previous.horizontalPosition, previous.verticalPosition, midpoint, (previous.verticalPosition + current.verticalPosition) / 2);
  }
  const lastPoint = points[points.length - 1];
  context.lineTo(lastPoint.horizontalPosition, lastPoint.verticalPosition);
  context.stroke();
  context.restore();
}

function buildTimeAxisTicks(startTime, endTime, plotWidth) {
  const selectedHours = Math.max(1, (endTime - startTime) / 3_600_000);
  const desiredLabels = Math.max(2, Math.floor(plotWidth / 90));
  const ticks = new Map();
  const addTick = (timestamp, level, label = "", guide = false) => {
    ticks.set(timestamp, {
      timestamp,
      horizontalPosition: plotWidth * (timestamp - startTime) / Math.max(1, endTime - startTime),
      level,
      label,
      guide
    });
  };

  if (selectedHours <= 24) {
    const minorMinutes = selectedHours <= 6
      ? plotWidth / (selectedHours * 4) >= 8 ? 15 : 30
      : plotWidth / (selectedHours * 2) >= 10 ? 30 : 60;
    const mediumMinutes = selectedHours <= 6 ? 30 : 60;
    const labelMinutes = selectedHours <= 2 ? 30 * Math.ceil(4 / desiredLabels)
      : 60 * chooseTimeStep(selectedHours / desiredLabels, 1);
    const minorMs = minorMinutes * 60_000;
    for (let timestamp = Math.ceil(startTime / minorMs) * minorMs; timestamp <= endTime; timestamp += minorMs) {
      const major = timestamp % (labelMinutes * 60_000) === 0;
      const medium = timestamp % (mediumMinutes * 60_000) === 0;
      addTick(timestamp, major ? "major" : medium ? "medium" : "minor",
        major ? formatChartTime(timestamp, selectedHours) : "", major);
    }
  } else {
    if (selectedHours <= 168) {
      const tickHours = [6, 12, 24].find(hours => plotWidth / (selectedHours / hours) >= 9) || 24;
      const tickMs = tickHours * 3_600_000;
      for (let timestamp = Math.ceil(startTime / tickMs) * tickMs; timestamp <= endTime; timestamp += tickMs) {
        addTick(timestamp, "minor");
      }
    }
    const days = denverDayTransitions(startTime, endTime);
    const dailyTickEvery = selectedHours <= 168 ? 1 : Math.max(1, Math.ceil(8 * days.length / plotWidth));
    const labelEvery = Math.max(1, Math.ceil(days.length / desiredLabels / dailyTickEvery) * dailyTickEvery);
    days.forEach((timestamp, index) => {
      const major = index % labelEvery === 0;
      const label = selectedHours <= 168
        ? new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone: "America/Denver" }).format(new Date(timestamp))
        : formatChartTime(timestamp, selectedHours);
      if (selectedHours <= 168 || index % dailyTickEvery === 0 || major) {
        addTick(timestamp, selectedHours <= 168 || major ? "major" : "medium",
          major ? label : "", selectedHours <= 168 || major);
      }
    });
  }
  return [...ticks.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function denverDayTransitions(startTime, endTime) {
  const hourMs = 3_600_000;
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric", hourCycle: "h23", timeZone: "America/Denver"
  });
  const days = [];
  for (let timestamp = Math.ceil(startTime / hourMs) * hourMs; timestamp <= endTime; timestamp += hourMs) {
    if (Number(hourFormatter.format(new Date(timestamp))) === 0) days.push(timestamp);
  }
  return days;
}

function drawTimeGuides(context, ticks, plotLeft, plotTop, axisY, colors) {
  context.save();
  context.strokeStyle = colors.muted;
  context.globalAlpha = state.selectedHours === 168 ? 0.42 : 0.18;
  context.lineWidth = 1;
  context.setLineDash([3, 5]);
  for (const tick of ticks.filter(tick => tick.guide)) {
    const x = plotLeft + tick.horizontalPosition;
    context.beginPath();
    context.moveTo(x, plotTop);
    context.lineTo(x, axisY);
    context.stroke();
  }
  context.restore();
}

function drawXAxis(context, ticks, dimensions, padding, colors) {
  const axisY = dimensions.height - padding.bottom;
  const plotLeft = padding.left;
  context.save();
  context.fillStyle = colors.ink;
  context.font = "10px IBM Plex Mono, monospace";
  context.textBaseline = "top";
  for (const tick of ticks) {
    const horizontalPosition = plotLeft + tick.horizontalPosition;
    const tickLength = tick.level === "major" ? 9 : tick.level === "medium" ? 7 : 4;
    context.strokeStyle = colors.muted;
    context.globalAlpha = tick.level === "major" ? 0.95 : tick.level === "medium" ? 0.75 : 0.5;
    context.lineWidth = tick.level === "major" ? 1.5 : 1;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(horizontalPosition, axisY);
    context.lineTo(horizontalPosition, axisY + tickLength);
    context.stroke();
    if (tick.label) {
      context.globalAlpha = 1;
      context.textAlign = horizontalPosition < padding.left + 35 ? "left"
        : horizontalPosition > dimensions.width - padding.right - 35 ? "right" : "center";
      context.fillText(tick.label, horizontalPosition, axisY + 11);
    }
  }
  context.restore();
}

function chooseTimeStep(idealHours, minimumHours) {
  const steps = [1, 2, 3, 4, 6, 12, 24, 48, 72, 168];
  return steps.find(step => step >= idealHours && step >= minimumHours) || Math.ceil(idealHours / 168) * 168;
}

function drawIncidentFlags(context, corridor, incidentThreads, currentPoints, startTime, endTime, padding, colors) {
  const visibleIncidents = buildIncidentChartGroups(incidentThreads, startTime, endTime, padding.left,
    context.canvas.clientWidth - padding.right).slice(0, 4);
  const occupied = [[], []];
  const plotRight = context.canvas.clientWidth - padding.right;
  for (const incidentGroup of visibleIncidents) {
    const incident = incidentGroup.incident;
    const timestamp = incidentGroup.timestamp;
    const nearest = currentPoints.reduce((best, point) =>
      !best || Math.abs(point.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? point : best, null);
    // Do not imply a speed measurement during a gap in collection.
    if (!nearest || Math.abs(nearest.timestamp - timestamp) > 60 * 60_000) continue;
    const x = padding.left + (timestamp - startTime) / (endTime - startTime) * (plotRight - padding.left);
    const color = incidentGroup.count > 1 ? colors["--rose"] : incidentColor(incident.type, colors);
    context.save();
    context.font = "9px Archivo, sans-serif";
    const label = (incidentGroup.count > 1 ? `${incidentGroup.count} incidents` : chartIncidentLabel(incident))
      + (dateMillis(incident.firstSeenAt) < startTime ? " · last seen" : "");
    const width = context.measureText(label).width;
    const alignRight = x + width + 12 > plotRight;
    const left = alignRight ? x - width - 10 : x - 8;
    const right = alignRight ? x + 8 : x + width + 10;
    const lane = occupied.findIndex(ranges => ranges.every(range => right + 6 < range.left || left > range.right + 6));
    if (lane < 0) { context.restore(); continue; }
    occupied[lane].push({left, right});
    const y = lane === 0 ? 12 : 27;
    context.strokeStyle = color;
    context.lineWidth = 1.2;
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(x, y + 9);
    context.lineTo(x, nearest.verticalPosition);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = colors.panel;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, nearest.verticalPosition, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    drawIncidentGlyph(context, x, y, incidentGroup.count > 1 ? "Cluster" : incident.type, color, incidentGroup.count);
    context.fillStyle = colors.ink;
    context.textBaseline = "middle";
    context.textAlign = alignRight ? "right" : "left";
    context.fillText(label, x + (alignRight ? -10 : 10), y);
    context.restore();
  }
}

function buildIncidentChartGroups(incidentThreads, startTime, endTime, plotLeft, plotRight) {
  const candidates = (Array.isArray(incidentThreads) ? incidentThreads : [])
    .map(incident => {
      const timestamp = incidentChartTimestamp(incident, startTime, endTime);
      return {
        incident,
        timestamp,
        label: chartIncidentLabel(incident),
        x: plotLeft + (timestamp - startTime) / Math.max(1, endTime - startTime) * (plotRight - plotLeft)
      };
    })
    .filter(candidate => candidate.timestamp >= startTime && candidate.timestamp <= endTime)
    .sort((left, right) => left.timestamp - right.timestamp);
  const groups = [];
  for (const candidate of candidates) {
    const existing = groups.find(group => Math.abs(group.x - candidate.x) <= 8);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.push({ ...candidate, count: 1 });
  }
  return groups;
}

function incidentChartTimestamp(incident, startTime, endTime) {
  const firstSeenAt = dateMillis(incident.firstSeenAt);
  if (firstSeenAt >= startTime && firstSeenAt <= endTime) return firstSeenAt;
  const lastSeenAt = dateMillis(incident.lastSeenAt);
  // A lifecycle that spans the whole visible range has no transition to mark.
  // Omitting it prevents long-running incidents from forming an artificial pile
  // at the replay cursor; the active count and incident table still show it.
  if (!incident.ongoing && lastSeenAt >= startTime && lastSeenAt <= endTime) return lastSeenAt;
  return 0;
}

function drawIncidentGlyph(context, horizontalPosition, verticalPosition, type, color, count = 1) {
  context.save();
  context.translate(horizontalPosition, verticalPosition);
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (type === "Cluster") {
    context.beginPath();
    context.arc(0, 0, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fff";
    context.font = "bold 9px Archivo, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(count), 0, 0);
  } else if (type === "Crash") {
    context.beginPath();
    context.moveTo(0, -7);
    context.lineTo(7, 6);
    context.lineTo(-7, 6);
    context.closePath();
    context.fill();
    context.fillStyle = "#fff";
    context.font = "bold 9px Archivo, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("!", 0, 2);
  } else if (type === "Construction") {
    context.rotate(Math.PI / 4);
    context.fillRect(-6, -6, 12, 12);
  } else if (type === "Closure") {
    context.beginPath();
    context.arc(0, 0, 6, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(-4, 0);
    context.lineTo(4, 0);
    context.stroke();
  } else if (type === "Disabled Vehicle") {
    context.beginPath();
    context.arc(0, 0, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fff";
    context.fillRect(-4, -2, 8, 4);
  } else {
    context.beginPath();
    context.arc(0, 0, 6, 0, Math.PI * 2);
    context.stroke();
    context.font = "bold 9px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("?", 0, 0);
  }
  context.restore();
}

function chartIncidentLabel(incident) {
  const markerMatch = incident.locationLabel.match(/MP\s+[0-9.]+/i);
  return markerMatch ? `${incident.type} · ${markerMatch[0].toUpperCase()}` : incident.type;
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

function speedToVertical(speed, plotTop, plotHeight, domain = { min: 0, max: 100 }) {
  const normalized = (Math.max(domain.min, Math.min(domain.max, speed)) - domain.min) / Math.max(1, domain.max - domain.min);
  return plotTop + plotHeight - normalized * plotHeight;
}

function chartColors() {
  const styles = window.getComputedStyle(document.documentElement);
  return {
    "--gold": styles.getPropertyValue("--gold").trim() || "#d5a021",
    "--gold-data": styles.getPropertyValue("--gold-data").trim() || "#ba8500",
    "--rose": styles.getPropertyValue("--rose").trim() || "#764248",
    forest: styles.getPropertyValue("--forest-soft").trim() || "#0f5a34",
    ink: styles.getPropertyValue("--ink").trim() || "#0b2413",
    muted: styles.getPropertyValue("--muted").trim() || "#526056",
    panel: styles.getPropertyValue("--panel").trim() || "#fffef7",
    grid: document.documentElement.dataset.theme === "dark" ? "rgba(211,193,195,.20)" : "rgba(118,66,72,.22)",
    gridStrong: document.documentElement.dataset.theme === "dark" ? "rgba(224,173,53,.34)" : "rgba(118,66,72,.34)",
    band: document.documentElement.dataset.theme === "dark" ? "rgba(118,66,72,.28)" : "rgba(211,193,195,.34)"
  };
}

function incidentColor(type, colors) {
  if (type === "Construction") return colors["--gold-data"];
  if (type === "Disabled Vehicle") return colors.forest;
  return colors["--rose"];
}

function normalizeIncidentType(value) {
  const normalized = String(value || "").toLowerCase().replaceAll("_", " ");
  if (normalized.includes("crash") || normalized.includes("accident")) return "Crash";
  if (normalized.includes("construction") || normalized.includes("road work") || normalized.includes("roadwork")) return "Construction";
  if (normalized.includes("closure") || normalized.includes("closed")) return "Closure";
  if (normalized.includes("disabled") || normalized.includes("stalled") || normalized.includes("vehicle")) return "Disabled Vehicle";
  return "Other";
}

function incidentSymbolClass(type) {
  if (type === "Crash") return "crash-symbol";
  if (type === "Construction") return "construction-symbol";
  if (type === "Closure") return "closure-symbol";
  return type === "Disabled Vehicle" ? "vehicle-symbol" : "other-symbol";
}

function incidentIconHref(type) {
  if (type === "Crash") return "#icon-alert";
  if (type === "Construction") return "#icon-construction";
  if (type === "Closure") return "#icon-closure";
  return type === "Disabled Vehicle" ? "#icon-vehicle" : "#icon-other";
}

function formatChartTime(timestamp, selectedHours) {
  const date = new Date(timestamp);
  if (selectedHours <= 24) {
    if (selectedHours <= 2 && timestamp % 3_600_000 !== 0) {
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: "America/Denver"
      }).format(date);
    }
    const localHour = Number(new Intl.DateTimeFormat("en-US", {
      hour: "numeric", hourCycle: "h23", timeZone: "America/Denver"
    }).format(date));
    if (localHour === 0) {
      return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" }).format(date);
    }
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "America/Denver" }).format(date);
  }
  if (selectedHours <= 168) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", timeZone: "America/Denver" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Denver" }).format(date);
}

function formatShortDateTime(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Denver"
  }).format(date);
}

function formatClockTime(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Denver"
  }).format(date);
}

function formatRelativeTime(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function formatMetricNumber(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatInteger(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—";
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

function buildDemoDashboardData() {
  const now = new Date();
  const routeData = new Map();
  routeData.set("I25", buildDemoRouteData("I25", now));
  routeData.set("I70", buildDemoRouteData("I70", now));
  return {
    routeData,
    health: { apiUp: true, routesUp: true, databaseUp: true, operational: { status: "HEALTHY" }, partial: false, failures: [] }
  };
}

function buildDemoRouteData(corridor, now) {
  const config = corridor === "I25"
    ? { current: 61, minimum: 38, baseline: 66, hotspot: "Northglenn—Thornton", startMileMarker: 221, endMileMarker: 225 }
    : { current: 54, minimum: 31, baseline: 62, hotspot: "Floyd Hill—Idaho Springs", startMileMarker: 241, endMileMarker: 248 };
  const totalHours = state.selectedHours + 169;
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
    zones: [{ zoneDescription: config.hotspot, startMileMarker: config.startMileMarker, endMileMarker: config.endMileMarker,
      avgCurrentSpeed: config.minimum, polledAt: new Date(now.getTime() - 38_000).toISOString() }],
    incidentsAvailable: true,
    incidentThreads
  };
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
