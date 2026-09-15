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
const DEMO_MODE = new URLSearchParams(window.location.search).get("demo") === "1";

const state = {
  selectedHours: 24,
  routeData: new Map(),
  health: null,
  refreshing: false,
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
  state.refreshTimer = window.setInterval(() => void refreshDashboard(), AUTO_REFRESH_MS);
}

function initializeTheme() {
  const storedTheme = window.localStorage.getItem("ctt-dashboard-theme");
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
    window.localStorage.setItem("ctt-dashboard-theme", nextTheme);
    applyTheme(nextTheme);
  });

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
  if (state.refreshing) return;
  state.refreshing = true;
  elements.refreshButton.setAttribute("aria-busy", "true");
  setStatus(DEMO_MODE ? "Refreshing the local design preview…" : "Refreshing live corridor data…");

  try {
    const dashboardData = DEMO_MODE ? buildDemoDashboardData() : await loadLiveDashboardData();
    state.routeData = dashboardData.routeData;
    state.health = dashboardData.health;
    renderDashboard();
    const updatedAt = formatClockTime(new Date());
    setStatus(`${DEMO_MODE ? "Demo preview" : "Live data"} updated at ${updatedAt} · Auto-refresh every 60 seconds`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Dashboard data is unavailable.", true);
    renderSystemHealth();
  } finally {
    state.refreshing = false;
    elements.refreshButton.removeAttribute("aria-busy");
  }
}

async function loadLiveDashboardData() {
  const trendWindowHours = Math.max(168, state.selectedHours);
  const trendLimit = Math.min(1_000, Math.max(168, trendWindowHours));
  const incidentWindowMinutes = Math.min(10_080, Math.max(RECENT_INCIDENT_WINDOW_MINUTES, state.selectedHours * 60));

  const routeResults = await Promise.allSettled(CORRIDOR_IDS.map(async (corridor) => {
    const [summary, trend, incidents] = await Promise.all([
      fetchJson(`/dashboard-api/traffic/summary?corridor=${corridor}&windowHours=168&recentIncidentWindowMinutes=${RECENT_INCIDENT_WINDOW_MINUTES}&preferUsable=true`),
      fetchJson(`/dashboard-api/traffic/analytics/trends?corridor=${corridor}&windowHours=${trendWindowHours}&limit=${trendLimit}&preferUsable=true`),
      fetchJson(`/dashboard-api/traffic/map/incidents?corridor=${corridor}&windowMinutes=${incidentWindowMinutes}&limit=200`)
    ]);
    return buildRouteData(corridor, summary, trend, incidents);
  }));

  const routeData = new Map();
  const failures = [];
  routeResults.forEach((result, resultIndex) => {
    const corridor = CORRIDOR_IDS[resultIndex];
    if (result.status === "fulfilled") {
      routeData.set(corridor, result.value);
    } else {
      failures.push(`${corridor}: ${result.reason instanceof Error ? result.reason.message : "unavailable"}`);
    }
  });

  if (routeData.size === 0) {
    throw new Error(`Both corridor feeds are unavailable. ${failures.join(" | ")}`);
  }

  const [healthResult, routesResult] = await Promise.allSettled([
    fetchJson("/actuator/health"),
    fetchJson("/dashboard-api/traffic/map/corridors")
  ]);

  return {
    routeData,
    health: {
      apiUp: healthResult.status === "fulfilled" && String(healthResult.value?.status || "UP").toUpperCase() === "UP",
      routesUp: routesResult.status === "fulfilled",
      partial: failures.length > 0,
      failures
    }
  };
}

function buildRouteData(corridor, summary, trend, incidents) {
  const incidentThreads = aggregateIncidentThreads(Array.isArray(incidents?.features) ? incidents.features : []);
  return {
    corridor,
    summary: summary || {},
    trend: trend || { buckets: [] },
    incidentThreads
  };
}

async function fetchJson(path) {
  const response = await window.fetch(path, {
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
  const minimumSpeed = finiteNumber(latest.minCurrentSpeed);
  const baselineSpeed = routeData ? averageTrendSpeed(routeData.trend?.buckets) : Number.NaN;
  const delayMinutes = estimateDelayMinutes(config.distanceMiles, speed, baselineSpeed, finiteNumber(latest.avgFreeflowSpeed));
  const activeIncidents = (routeData?.incidentThreads || []).filter((thread) => thread.ongoing).length;
  const worstSegment = summary.topHotspot?.referenceLabel
    || routeData?.incidentThreads?.[0]?.locationLabel
    || "No current hotspot";

  setText(`${config.summaryPrefix}AverageSpeed`, formatMetricNumber(speed, 0));
  setText(`${config.summaryPrefix}AverageDelay`, formatMetricNumber(delayMinutes, 0));
  setText(`${config.summaryPrefix}ActiveIncidents`, String(activeIncidents));
  setText(`${config.summaryPrefix}WorstSegment`, compactLocation(worstSegment));
  setText(`${config.summaryPrefix}WorstSpeed`, Number.isFinite(minimumSpeed) ? `· ${Math.round(minimumSpeed)} mph` : "");
}

function estimateDelayMinutes(distanceMiles, currentSpeed, baselineSpeed, freeflowSpeed) {
  if (!Number.isFinite(currentSpeed) || currentSpeed <= 0) return Number.NaN;
  const comparisonSpeed = Number.isFinite(baselineSpeed) && baselineSpeed > currentSpeed
    ? baselineSpeed
    : Number.isFinite(freeflowSpeed) && freeflowSpeed > currentSpeed
      ? freeflowSpeed
      : currentSpeed;
  const delay = ((distanceMiles / currentSpeed) - (distanceMiles / comparisonSpeed)) * 60;
  return Math.max(0, delay);
}

function averageTrendSpeed(buckets) {
  const speeds = (Array.isArray(buckets) ? buckets : [])
    .map((bucket) => finiteNumber(bucket?.avgCurrentSpeed))
    .filter(Number.isFinite);
  if (speeds.length === 0) return Number.NaN;
  return speeds.reduce((total, speed) => total + speed, 0) / speeds.length;
}

function aggregateIncidentThreads(features) {
  const groups = new Map();
  for (const feature of features) {
    const properties = feature?.properties || {};
    const key = incidentThreadKey(feature);
    const observedAt = parseDate(properties.polledAt || properties.sourceUpdatedAt);
    const existing = groups.get(key);
    const type = normalizeIncidentType(properties.incidentTypeLabel || properties.iconCategory || properties.normalizedCategory);
    const locationLabel = buildIncidentLocation(properties);
    if (!existing) {
      groups.set(key, {
        key,
        type,
        locationLabel,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        archived: Boolean(properties.archived),
        normalizedStatus: String(properties.normalizedStatus || ""),
        sourceUpdatedAt: parseDate(properties.sourceUpdatedAt)
      });
      continue;
    }
    if (observedAt && (!existing.firstSeenAt || observedAt < existing.firstSeenAt)) existing.firstSeenAt = observedAt;
    if (observedAt && (!existing.lastSeenAt || observedAt > existing.lastSeenAt)) existing.lastSeenAt = observedAt;
    const sourceUpdatedAt = parseDate(properties.sourceUpdatedAt);
    if (sourceUpdatedAt && (!existing.sourceUpdatedAt || sourceUpdatedAt > existing.sourceUpdatedAt)) {
      existing.sourceUpdatedAt = sourceUpdatedAt;
    }
    existing.archived = existing.archived && Boolean(properties.archived);
    if (properties.normalizedStatus) existing.normalizedStatus = String(properties.normalizedStatus);
    if (existing.type === "Other" && type !== "Other") existing.type = type;
    if (existing.locationLabel === "Location unavailable" && locationLabel !== "Location unavailable") {
      existing.locationLabel = locationLabel;
    }
  }

  const now = new Date();
  return [...groups.values()]
    .map((thread) => ({ ...thread, ongoing: incidentIsOngoing(thread, now) }))
    .sort((left, right) => {
      if (left.ongoing !== right.ongoing) return left.ongoing ? -1 : 1;
      return dateMillis(right.lastSeenAt) - dateMillis(left.lastSeenAt);
    });
}

function incidentThreadKey(feature) {
  const properties = feature?.properties || {};
  return String(properties.providerEventId
    || properties.referenceKey
    || properties.incidentRefId
    || feature?.id
    || `${properties.corridor}|${properties.locationLabel}|${properties.iconCategory}`);
}

function buildIncidentLocation(properties) {
  const marker = finiteNumber(properties.closestMileMarker);
  const markerLabel = Number.isFinite(marker) ? `MP ${formatMileMarker(marker)}` : "";
  const location = String(properties.locationLabel || properties.referenceLabel || "").trim();
  if (markerLabel && location && !location.toLowerCase().includes(markerLabel.toLowerCase())) {
    return `${markerLabel} · ${location}`;
  }
  return markerLabel || location || "Location unavailable";
}

function incidentIsOngoing(thread, now) {
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
  const rows = incidentThreads.slice(0, 3);
  if (rows.length === 0) {
    const row = document.createElement("tr");
    row.className = "empty-row";
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No recent incidents in the selected window.";
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
  const symbol = document.createElement("i");
  symbol.className = `incident-symbol ${incidentSymbolClass(incident.type)}`;
  symbol.setAttribute("aria-hidden", "true");
  symbol.textContent = incidentSymbolText(incident.type);
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
  const warningStatuses = CORRIDOR_IDS
    .map((corridor) => state.routeData.get(corridor)?.summary?.providerStatus)
    .filter((status) => status?.halted || status?.stale);

  if (warningStatuses.length === 0) {
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
  const providers = routeEntries.map((entry) => entry.summary?.providerStatus).filter(Boolean);
  const apiHealthy = Boolean(state.health?.apiUp || routeEntries.length > 0);
  const routesHealthy = Boolean(state.health?.routesUp || routeEntries.length === CORRIDOR_IDS.length);
  const databaseHealthy = routeEntries.length > 0;
  const ingestHealthy = providers.length > 0 && providers.every((provider) => !provider.halted && !provider.stale);
  const allHealthy = apiHealthy && routesHealthy && databaseHealthy && ingestHealthy && routeEntries.length === CORRIDOR_IDS.length;

  setServiceStatus(elements.routesServiceStatus, routesHealthy ? "Healthy" : "Checking", routesHealthy);
  setServiceStatus(elements.ingestServiceStatus, ingestHealthy ? "Healthy" : "Monitoring", ingestHealthy);
  setServiceStatus(elements.apiServiceStatus, apiHealthy ? "Healthy" : "Checking", apiHealthy);
  setServiceStatus(elements.databaseStatus, databaseHealthy ? "Healthy" : "Checking", databaseHealthy);
  elements.systemHeadline.textContent = allHealthy ? "All Systems Operational" : "Live Services Connected";
  elements.pipelineStatus.textContent = ingestHealthy ? "Live" : "Monitoring";

  const latestIngest = routeEntries
    .map((entry) => parseDate(entry.summary?.latest?.polledAt))
    .filter(Boolean)
    .sort((left, right) => right - left)[0] || null;
  elements.lastIngest.textContent = latestIngest ? formatRelativeTime(latestIngest) : "—";
  elements.i25SampleCount.textContent = formatInteger(trendSampleCount(state.routeData.get("I25")?.trend?.buckets));
  elements.i70SampleCount.textContent = formatInteger(trendSampleCount(state.routeData.get("I70")?.trend?.buckets));
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
  const buckets = selectDisplayBuckets(routeData?.trend?.buckets || [], state.selectedHours);
  if (buckets.length < 2) {
    drawEmptyChart(context, dimensions, "Waiting for enough hourly samples to draw this corridor.");
    return;
  }

  const colors = chartColors();
  const padding = { top: 34, right: 18, bottom: 27, left: 43 };
  const plotWidth = dimensions.width - padding.left - padding.right;
  const plotHeight = dimensions.height - padding.top - padding.bottom;
  const startTime = parseDate(buckets[0].bucketStart)?.getTime() || Date.now() - state.selectedHours * 3_600_000;
  const endTime = parseDate(buckets[buckets.length - 1].bucketStart)?.getTime() || Date.now();
  const timeSpan = Math.max(1, endTime - startTime);
  const baselineByHour = buildBaselineByHour(routeData?.trend?.buckets || []);
  const currentPoints = [];
  const baselinePoints = [];

  for (const bucket of buckets) {
    const timestamp = parseDate(bucket.bucketStart)?.getTime();
    const speed = finiteNumber(bucket.avgCurrentSpeed);
    if (!Number.isFinite(timestamp) || !Number.isFinite(speed)) continue;
    const baseline = baselineForBucket(bucket, baselineByHour);
    const horizontalPosition = padding.left + ((timestamp - startTime) / timeSpan) * plotWidth;
    currentPoints.push({ horizontalPosition, verticalPosition: speedToVertical(speed, padding.top, plotHeight), speed, timestamp });
    baselinePoints.push({ horizontalPosition, verticalPosition: speedToVertical(baseline, padding.top, plotHeight), speed: baseline, timestamp });
  }

  drawGrid(context, dimensions, padding, plotWidth, plotHeight, colors);
  drawNormalBand(context, baselinePoints, padding.top, plotHeight, colors);
  drawSmoothLine(context, baselinePoints, colors.forest, 2, [6, 6]);
  drawSmoothLine(context, currentPoints, colors[CORRIDOR_CONFIG[corridor].currentColorVariable], 2.4, []);
  drawXAxis(context, startTime, endTime, dimensions, padding, colors);
  drawIncidentFlags(context, corridor, routeData?.incidentThreads || [], currentPoints, startTime, endTime, padding, colors);
}

function sizeCanvas(canvas) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(bounds.width));
  const height = Math.max(150, Math.round(bounds.height));
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

function selectDisplayBuckets(sourceBuckets, hours) {
  const buckets = (Array.isArray(sourceBuckets) ? sourceBuckets : [])
    .filter((bucket) => parseDate(bucket?.bucketStart) && Number.isFinite(finiteNumber(bucket?.avgCurrentSpeed)))
    .sort((left, right) => parseDate(left.bucketStart) - parseDate(right.bucketStart));
  if (buckets.length === 0) return [];
  const latestTime = parseDate(buckets[buckets.length - 1].bucketStart).getTime();
  const cutoff = latestTime - hours * 3_600_000;
  return buckets.filter((bucket) => parseDate(bucket.bucketStart).getTime() >= cutoff);
}

function buildBaselineByHour(buckets) {
  const groups = new Map();
  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    const timestamp = parseDate(bucket?.bucketStart);
    const speed = finiteNumber(bucket?.avgCurrentSpeed);
    if (!timestamp || !Number.isFinite(speed)) continue;
    const hour = Number(new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Denver"
    }).format(timestamp));
    const values = groups.get(hour) || [];
    values.push(speed);
    groups.set(hour, values);
  }
  return new Map([...groups.entries()].map(([hour, values]) => [
    hour,
    values.reduce((total, value) => total + value, 0) / values.length
  ]));
}

function baselineForBucket(bucket, baselineByHour) {
  const timestamp = parseDate(bucket.bucketStart);
  const hour = timestamp ? Number(new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/Denver"
  }).format(timestamp)) : Number.NaN;
  const hourlyBaseline = baselineByHour.get(hour);
  const freeflow = finiteNumber(bucket.avgFreeflowSpeed);
  const current = finiteNumber(bucket.avgCurrentSpeed);
  if (Number.isFinite(hourlyBaseline)) return hourlyBaseline;
  if (Number.isFinite(freeflow)) return freeflow;
  return current;
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
  if (points.length < 2) return;
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
  const visibleIncidents = incidentThreads
    .filter((thread) => {
      const markerTime = incidentChartTimestamp(thread, startTime, endTime);
      return markerTime >= startTime && markerTime <= endTime;
    })
    .slice(0, 3)
    .sort((left, right) => incidentChartTimestamp(left, startTime, endTime) - incidentChartTimestamp(right, startTime, endTime));

  visibleIncidents.forEach((incident, incidentIndex) => {
    const timestamp = incidentChartTimestamp(incident, startTime, endTime);
    const nearestPoint = currentPoints.reduce((nearest, point) => {
      if (!nearest) return point;
      return Math.abs(point.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? point : nearest;
    }, null);
    if (!nearestPoint) return;
    const color = incidentColor(incident.type, colors);
    const labelVertical = incidentIndex % 2 === 0 ? 12 : 26;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 1.2;
    context.setLineDash([4, 3]);
    context.beginPath();
    context.moveTo(nearestPoint.horizontalPosition, labelVertical + 9);
    context.lineTo(nearestPoint.horizontalPosition, nearestPoint.verticalPosition);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = colors.panel;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(nearestPoint.horizontalPosition, nearestPoint.verticalPosition, 4, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    drawIncidentGlyph(context, nearestPoint.horizontalPosition, labelVertical, incident.type, color);
    const label = chartIncidentLabel(incident);
    const alignRight = nearestPoint.horizontalPosition > context.canvas.clientWidth - 200;
    context.font = "9px Archivo, sans-serif";
    context.fillStyle = colors.ink;
    context.textBaseline = "middle";
    context.textAlign = alignRight ? "right" : "left";
    context.fillText(label, nearestPoint.horizontalPosition + (alignRight ? -10 : 10), labelVertical);
    context.restore();
  });
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
  } else {
    context.beginPath();
    context.arc(0, 0, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fff";
    context.fillRect(-4, -2, 8, 4);
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
    forest: styles.getPropertyValue("--forest").trim() || "#003c00",
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
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("crash") || normalized.includes("accident")) return "Crash";
  if (normalized.includes("construction") || normalized.includes("road work")) return "Construction";
  if (normalized.includes("closure") || normalized.includes("closed")) return "Closure";
  if (normalized.includes("disabled") || normalized.includes("stalled") || normalized.includes("vehicle")) return "Disabled Vehicle";
  return "Other";
}

function incidentSymbolClass(type) {
  if (type === "Crash") return "crash-symbol";
  if (type === "Construction") return "construction-symbol";
  if (type === "Closure") return "closure-symbol";
  return "vehicle-symbol";
}

function incidentSymbolText(type) {
  if (type === "Crash") return "!";
  if (type === "Construction") return "↕";
  if (type === "Closure") return "—";
  return "▰";
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

function compactLocation(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > 42 ? `${normalized.slice(0, 39)}…` : normalized;
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

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setStatus(message, error = false) {
  elements.statusText.textContent = message;
  elements.statusText.style.color = error ? "var(--rose)" : "var(--muted)";
}

function buildDemoDashboardData() {
  const now = new Date();
  const routeData = new Map();
  routeData.set("I25", buildDemoRouteData("I25", now));
  routeData.set("I70", buildDemoRouteData("I70", now));
  return {
    routeData,
    health: { apiUp: true, routesUp: true, partial: false, failures: [] }
  };
}

function buildDemoRouteData(corridor, now) {
  const config = corridor === "I25"
    ? { current: 61, minimum: 38, baseline: 66, hotspot: "Castle Rock—Monument" }
    : { current: 54, minimum: 31, baseline: 62, hotspot: "Floyd Hill—Idaho Springs" };
  const totalHours = Math.max(168, state.selectedHours);
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
      demoIncident("Crash", "MP 161 · Near Monument", now, 230, 12, true),
      demoIncident("Disabled Vehicle", "MP 178 · Near Plum Creek Pkwy", now, 205, 6, true),
      demoIncident("Construction", "MP 185 · Near Plum Creek Pkwy", now, 720, 4, true)
    ]
    : [
      demoIncident("Disabled Vehicle", "MP 216 · Near Evergreen Pkwy", now, 320, 290, false),
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
