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
const RECENT_INCIDENT_WINDOW_MINUTES = 1_440;
const ONGOING_INCIDENT_WINDOW_MINUTES = 45;
const QUERY_PARAMS = new URLSearchParams(window.location.search);
const DEMO_MODE = QUERY_PARAMS.get("demo") === "1";
const HISTORICAL_MODE = !DEMO_MODE && QUERY_PARAMS.get("historical") === "1";

const state = {
  selectedHours: 24,
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
  rangeControl: document.getElementById("rangeControl"),
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
    state.refreshTimer = window.setInterval(() => void refreshDashboard(), AUTO_REFRESH_MS);
  }
}

function initializeTheme() {
  let storedTheme;
  try { storedTheme = window.localStorage.getItem("ctt-dashboard-theme"); } catch { /* Storage can be disabled. */ }
  applyTheme(storedTheme === "dark" ? "dark" : "light");
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const darkMode = theme === "dark";
  elements.themeToggle.setAttribute("aria-pressed", String(darkMode));
  elements.themeToggle.setAttribute("aria-label", darkMode ? "Switch to light mode" : "Switch to dark mode");
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
  elements.corridorSelect.addEventListener("change", () => {
    applyCorridorFocus(elements.corridorSelect.value, true);
  });

  elements.refreshButton.addEventListener("click", () => void refreshDashboard());

  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { window.localStorage.setItem("ctt-dashboard-theme", nextTheme); } catch { /* Theme still works for this visit. */ }
    applyTheme(nextTheme);
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

function applyCorridorFocus(corridor, updateUrl) {
  const normalized = CORRIDOR_IDS.includes(corridor) ? corridor : "ALL";
  document.body.dataset.focus = normalized === "ALL" ? "" : normalized;
  elements.corridorSelect.value = normalized;
  if (!updateUrl) return;
  const url = new URL(window.location.href);
  if (normalized === "ALL") {
    url.searchParams.delete("corridor");
  } else {
    url.searchParams.set("corridor", normalized);
  }
  window.history.replaceState(null, "", url);
}

async function refreshDashboard() {
  if (state.refreshing) { state.refreshPending = true; return; }
  state.refreshing = true;
  const requestedHours = state.selectedHours;
  elements.refreshButton.setAttribute("aria-busy", "true");
  setStatus(DEMO_MODE ? "Refreshing the local design preview…"
    : HISTORICAL_MODE ? "Loading retained corridor data…" : "Refreshing live corridor data…");

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
  const trendWindowHours = selectedHours + 169;
  const trendLimit = trendWindowHours + 1;
  const incidentWindowMinutes = Math.max(RECENT_INCIDENT_WINDOW_MINUTES, selectedHours * 60);
  const failures = [];
  const healthPromise = Promise.allSettled([
    fetchJson("/actuator/health"),
    fetchJson("/dashboard-api/traffic/map/corridors"),
    fetchJson("/dashboard-api/system/operational-status")
  ]);

  const routeResults = await Promise.allSettled(CORRIDOR_IDS.map(async (corridor) => {
    const summaryPath = `/dashboard-api/traffic/summary?corridor=${corridor}&windowHours=168&recentIncidentWindowMinutes=${RECENT_INCIDENT_WINDOW_MINUTES}&preferUsable=true`;
    const summaryResult = await Promise.allSettled([fetchJson(summaryPath)]).then(([result]) => result);
    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const rawDataAnchor = summary?.latest?.polledAt;
    const dataAnchor = HISTORICAL_MODE && parseDate(rawDataAnchor) ? String(rawDataAnchor) : null;
    const asOfParam = dataAnchor ? `&asOf=${encodeURIComponent(dataAnchor)}` : "";
    const otherResults = await Promise.allSettled([
      fetchJson(`/dashboard-api/traffic/analytics/trends?corridor=${corridor}&windowHours=${trendWindowHours}&limit=${trendLimit}&preferUsable=true${asOfParam}`),
      fetchJson(`/dashboard-api/traffic/map/incidents/recent?corridor=${corridor}&windowMinutes=${incidentWindowMinutes}&limit=1000`),
      fetchJson(`/dashboard-api/traffic/zones/history?corridor=${corridor}&windowMinutes=60&limit=1000${asOfParam}`)
    ]);
    const results = [summaryResult, ...otherResults];
    const names = ["summary", "speed history", "incidents", "speed zones"];
    results.forEach((result, index) => {
      if (result.status === "rejected") failures.push(`${corridor} ${names[index]}`);
    });
    const [, trend, incidents, zones] = results.map(result => result.status === "fulfilled" ? result.value : null);
    if (results.every(result => result.status === "rejected")) throw new Error("Unavailable");
    const route = buildRouteData(corridor, summary, trend, incidents, dataAnchor);
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

function buildRouteData(corridor, summary, trend, incidents, dataAnchor = null) {
  const incidentFeatures = Array.isArray(incidents?.features) ? incidents.features : [];
  const resolvedIncidentFeatures = HISTORICAL_MODE && incidentFeatures.length === 0
    ? legacySnapshotIncidentFeatures(summary?.latest) : incidentFeatures;
  const incidentThreads = aggregateIncidentThreads(resolvedIncidentFeatures, dataAnchor);
  return {
    corridor,
    summary: summary || {},
    trend: trend || { buckets: [] },
    incidentThreads,
    dataAnchor
  };
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
  if (!time || (!HISTORICAL_MODE && Date.now() - time > 60 * 60_000)) return null;
  return zones.filter(zone => dateMillis(zone.polledAt) === time && Number.isFinite(finiteNumber(zone.avgCurrentSpeed)))
    .sort((a, b) => a.avgCurrentSpeed - b.avgCurrentSpeed)[0] || null;
}

function legacySnapshotIncidentFeatures(latest) {
  if (!latest?.incidentsJson || !latest.polledAt) return [];
  try {
    const payload = typeof latest.incidentsJson === "string" ? JSON.parse(latest.incidentsJson) : latest.incidentsJson;
    if (!Array.isArray(payload?.incidents)) return [];
    return payload.incidents.map((incident, index) => {
      const properties = incident?.properties || {};
      const typeLabel = legacyIncidentTypeLabel(properties.iconCategory, properties.description);
      return {
        id: `snapshot-${latest.corridor || "corridor"}-${index}`,
        geometry: incident?.geometry || null,
        properties: {
          ...properties,
          corridor: latest.corridor,
          incidentProvider: latest.incidentProvider || "snapshot",
          providerEventId: `snapshot-${index}-${properties.closestMileMarker ?? "unknown"}`,
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
  if (HISTORICAL_MODE) {
    const snapshotTime = latestRouteTime(state.routeData);
    elements.systemWarningTitle.textContent = "Historical snapshot mode.";
    elements.systemWarningMessage.textContent = `Showing retained data from ${formatShortDateTime(snapshotTime)}. Ingestion is off; no TomTom requests are being made.`;
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
  const allHealthy = !HISTORICAL_MODE && apiHealthy && routesHealthy && databaseHealthy && ingestHealthy && !state.health?.partial;

  setServiceStatus(elements.routesServiceStatus, routesHealthy ? "Catalog ready" : "Unavailable", routesHealthy);
  elements.routesServiceStatus.title = "Stored route catalog availability; not a routes-service liveness probe.";
  setServiceStatus(elements.ingestServiceStatus, HISTORICAL_MODE ? "Off for replay" : ingestHealthy ? "Feeds current" : "Unconfirmed", !HISTORICAL_MODE && ingestHealthy);
  elements.ingestServiceStatus.title = "Flow, incident and provider checks from the operational status API.";
  setServiceStatus(elements.apiServiceStatus, apiHealthy ? "Healthy" : "Unavailable", apiHealthy);
  setServiceStatus(elements.databaseStatus, databaseHealthy ? "Connected" : "Unconfirmed", databaseHealthy);
  setServiceStatus(elements.systemHeadline, HISTORICAL_MODE ? "Historical Data Replay" : allHealthy ? "All Data Checks Passing" : "Some Data Checks Unavailable", allHealthy);
  setServiceStatus(elements.pipelineStatus, HISTORICAL_MODE ? "Historical" : ingestHealthy ? "Live" : "Unconfirmed", !HISTORICAL_MODE && ingestHealthy);

  const latestIngest = routeEntries
    .map((entry) => parseDate(entry.summary?.latest?.polledAt))
    .filter(Boolean)
    .sort((left, right) => right - left)[0] || null;
  elements.lastIngest.textContent = latestIngest
    ? (HISTORICAL_MODE ? formatShortDateTime(latestIngest) : formatRelativeTime(latestIngest)) : "—";
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
    drawCorridorChart(canvas, corridor, routeData);
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
  const buckets = selectDisplayBuckets(routeData?.trend?.buckets || [], state.selectedHours, endTime);
  if (buckets.length === 0) {
    drawEmptyChart(context, dimensions, "No hourly speed data in this time window.");
    return;
  }

  const colors = chartColors();
  const padding = { top: 34, right: 18, bottom: 27, left: 43 };
  const plotWidth = dimensions.width - padding.left - padding.right;
  const plotHeight = dimensions.height - padding.top - padding.bottom;
  const startTime = endTime - state.selectedHours * 3_600_000;
  const timeSpan = Math.max(1, endTime - startTime);
  const currentPoints = [];
  const baselinePoints = [];
  const baselines = buildRollingBaselines(routeData?.trend?.buckets || []);

  for (const bucket of buckets) {
    const timestamp = parseDate(bucket.bucketStart)?.getTime();
    const speed = finiteNumber(bucket.avgCurrentSpeed);
    if (!Number.isFinite(timestamp) || !Number.isFinite(speed)) continue;
    const baseline = baselines.get(timestamp);
    const horizontalPosition = padding.left + ((timestamp - startTime) / timeSpan) * plotWidth;
    currentPoints.push({ horizontalPosition, verticalPosition: speedToVertical(speed, padding.top, plotHeight), speed, timestamp });
    baselinePoints.push({ horizontalPosition, verticalPosition: Number.isFinite(baseline) ? speedToVertical(baseline, padding.top, plotHeight) : Number.NaN, speed: baseline, timestamp });
  }

  drawGrid(context, dimensions, padding, plotWidth, plotHeight, colors);
  drawNormalBand(context, baselinePoints, padding.top, plotHeight, colors);
  drawSmoothLine(context, baselinePoints, colors.ink, 2, [6, 6]);
  drawSmoothLine(context, currentPoints, colors[CORRIDOR_CONFIG[corridor].currentColorVariable], 2.4, []);
  drawXAxis(context, startTime, endTime, dimensions, padding, colors);
  drawIncidentFlags(context, corridor, routeData?.incidentThreads || [], currentPoints, startTime, endTime, padding, colors);
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

function drawGrid(context, dimensions, padding, plotWidth, plotHeight, colors) {
  context.save();
  context.font = "10px IBM Plex Mono, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (const speed of [0, 20, 40, 60, 80, 100]) {
    const verticalPosition = speedToVertical(speed, padding.top, plotHeight);
    context.strokeStyle = colors.grid;
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(padding.left, verticalPosition);
    context.lineTo(padding.left + plotWidth, verticalPosition);
    context.stroke();
    context.fillStyle = colors.muted;
    context.fillText(String(speed), padding.left - 8, verticalPosition);
  }
  context.restore();
}

function drawNormalBand(context, baselinePoints, plotTop, plotHeight, colors) {
  for (const segment of chartSegments(baselinePoints)) drawBandSegment(context, segment, plotTop, plotHeight, colors);
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

function drawBandSegment(context, baselinePoints, plotTop, plotHeight, colors) {
  if (baselinePoints.length < 2) return;
  context.save();
  context.fillStyle = colors.band;
  context.beginPath();
  baselinePoints.forEach((point, pointIndex) => {
    const verticalPosition = speedToVertical(Math.min(100, point.speed + 10), plotTop, plotHeight);
    if (pointIndex === 0) context.moveTo(point.horizontalPosition, verticalPosition);
    else context.lineTo(point.horizontalPosition, verticalPosition);
  });
  [...baselinePoints].reverse().forEach((point) => {
    context.lineTo(point.horizontalPosition, speedToVertical(Math.max(0, point.speed - 10), plotTop, plotHeight));
  });
  context.closePath();
  context.fill();
  context.restore();
}

function drawSmoothLine(context, points, color, lineWidth, dash) {
  for (const segment of chartSegments(points)) drawLineSegment(context, segment, color, lineWidth, dash);
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

function drawXAxis(context, startTime, endTime, dimensions, padding, colors) {
  const labelCount = dimensions.width < 700 ? 4 : 7;
  context.save();
  context.fillStyle = colors.ink;
  context.font = "10px IBM Plex Mono, monospace";
  context.textBaseline = "bottom";
  for (let labelIndex = 0; labelIndex < labelCount; labelIndex += 1) {
    const fraction = labelIndex / (labelCount - 1);
    const timestamp = startTime + (endTime - startTime) * fraction;
    const horizontalPosition = padding.left + (dimensions.width - padding.left - padding.right) * fraction;
    context.textAlign = labelIndex === 0 ? "left" : labelIndex === labelCount - 1 ? "right" : "center";
    context.fillText(formatChartTime(timestamp, state.selectedHours), horizontalPosition, dimensions.height - 3);
  }
  context.restore();
}

function drawIncidentFlags(context, corridor, incidentThreads, currentPoints, startTime, endTime, padding, colors) {
  const visibleIncidents = incidentThreads.filter(thread => {
    const time = incidentChartTimestamp(thread, startTime, endTime);
    return time >= startTime && time <= endTime;
  }).slice(0, 3).sort((a, b) => incidentChartTimestamp(a, startTime, endTime) - incidentChartTimestamp(b, startTime, endTime));
  const occupied = [[], []];
  const plotRight = context.canvas.clientWidth - padding.right;
  for (const incident of visibleIncidents) {
    const timestamp = incidentChartTimestamp(incident, startTime, endTime);
    const nearest = currentPoints.reduce((best, point) =>
      !best || Math.abs(point.timestamp - timestamp) < Math.abs(best.timestamp - timestamp) ? point : best, null);
    // Do not imply a speed measurement during a gap in collection.
    if (!nearest || Math.abs(nearest.timestamp - timestamp) > 60 * 60_000) continue;
    const x = padding.left + (timestamp - startTime) / (endTime - startTime) * (plotRight - padding.left);
    const color = incidentColor(incident.type, colors);
    context.save();
    context.font = "9px Archivo, sans-serif";
    const label = chartIncidentLabel(incident) + (dateMillis(incident.firstSeenAt) < startTime ? " · last seen" : "");
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
    drawIncidentGlyph(context, x, y, incident.type, color);
    context.fillStyle = colors.ink;
    context.textBaseline = "middle";
    context.textAlign = alignRight ? "right" : "left";
    context.fillText(label, x + (alignRight ? -10 : 10), y);
    context.restore();
  }
}

function incidentChartTimestamp(incident, startTime, endTime) {
  const firstSeenAt = dateMillis(incident.firstSeenAt);
  if (firstSeenAt >= startTime && firstSeenAt <= endTime) return firstSeenAt;
  return dateMillis(incident.lastSeenAt);
}

function drawIncidentGlyph(context, horizontalPosition, verticalPosition, type, color) {
  context.save();
  context.translate(horizontalPosition, verticalPosition);
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  if (type === "Crash") {
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

function speedToVertical(speed, plotTop, plotHeight) {
  return plotTop + plotHeight - (Math.max(0, Math.min(100, speed)) / 100) * plotHeight;
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
  if (!HISTORICAL_MODE) return Date.now();
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
