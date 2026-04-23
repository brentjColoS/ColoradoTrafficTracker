const corridorSelect = document.getElementById("corridorSelect");
const refreshBtn = document.getElementById("refreshBtn");
const statusText = document.getElementById("statusText");
const systemWarning = document.getElementById("systemWarning");
const systemWarningTitle = document.getElementById("systemWarningTitle");
const systemWarningMessage = document.getElementById("systemWarningMessage");
const systemWarningMeta = document.getElementById("systemWarningMeta");

const metricCurrent = document.getElementById("metricCurrent");
const metricCurrentMeta = document.getElementById("metricCurrentMeta");
const metricSecondaryLabel = document.getElementById("metricSecondaryLabel");
const metricSecondary = document.getElementById("metricSecondary");
const metricSecondaryMeta = document.getElementById("metricSecondaryMeta");
const metricTertiaryLabel = document.getElementById("metricTertiaryLabel");
const metricTertiary = document.getElementById("metricTertiary");
const metricTertiaryMeta = document.getElementById("metricTertiaryMeta");
const metricAnomalies = document.getElementById("metricAnomalies");
const metricIncidentTotal = document.getElementById("metricIncidentTotal");
const metricHotspot = document.getElementById("metricHotspot");

const historyMeta = document.getElementById("historyMeta");
const trendMeta = document.getElementById("trendMeta");
const forecastMeta = document.getElementById("forecastMeta");
const mapMeta = document.getElementById("mapMeta");
const mapLegend = document.getElementById("mapLegend");
const speedLimitContext = document.getElementById("speedLimitContext");
const incidentLegendGrid = document.getElementById("incidentLegendGrid");
const summaryMeta = document.getElementById("summaryMeta");
const hotspotMeta = document.getElementById("hotspotMeta");
const incidentMeta = document.getElementById("incidentMeta");

const summaryStats = document.getElementById("summaryStats");
const anomalyList = document.getElementById("anomalyList");
const hotspotZonePager = document.getElementById("hotspotZonePager");
const incidentList = document.getElementById("incidentList");
const corridorMap = document.getElementById("corridorMap");
const mapTooltip = document.getElementById("mapTooltip");

const HISTORY_WINDOW_MINUTES = 180;
const HISTORY_LIMIT = 120;
const USABLE_HISTORY_WINDOW_MINUTES = 10_080;
const MAP_WINDOW_MINUTES = 720;
const HOTSPOT_WINDOW_HOURS = 168;
const TREND_WINDOW_HOURS = 168;
const TREND_LIMIT = 168;
const FORECAST_HORIZON_MINUTES = 60;
const FORECAST_WINDOW_MINUTES = 720;
const FORECAST_STEP_MINUTES = 15;
const AUTO_REFRESH_MS = 60_000;
const HOTSPOT_ZONE_ROTATION_MS = 60_000;
const STALE_SAMPLE_MINUTES = 180;
const PROVIDER_GUARD_NOTIFICATION_KEY = "cttd-provider-guard-notification";
const INCIDENT_CATEGORY_LEGEND = [
  [0, "Unknown"],
  [1, "Accident"],
  [2, "Fog"],
  [3, "Dangerous conditions"],
  [4, "Rain"],
  [5, "Ice"],
  [6, "Traffic jam"],
  [7, "Lane closed"],
  [8, "Road closed"],
  [9, "Road works"],
  [10, "Wind"],
  [11, "Flooding"],
  [13, "Incident cluster"],
  [14, "Broken down vehicle"]
];
const svgNs = "http://www.w3.org/2000/svg";
let refreshTimer = null;
let refreshInFlight = false;
let hotspotZoneTimer = null;
let hotspotZonePages = [];
let hotspotZonePageIndex = 0;
let hotspotZoneSignature = "";

refreshBtn.addEventListener("click", refreshDashboard);
corridorSelect.addEventListener("change", refreshDashboard);

init();

async function init() {
  setStatus("Loading local traffic data...");
  renderIncidentLegend();
  try {
    const corridors = await fetchJson("/dashboard-api/traffic/corridors");
    populateCorridors(corridors);
    if (!corridorSelect.value) {
      setStatus("No corridors are available yet.", true);
      return;
    }
    startAutoRefresh();
    await refreshDashboard();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function refreshDashboard() {
  if (refreshInFlight) {
    return;
  }

  const corridor = corridorSelect.value;
  if (!corridor) {
    setStatus("No corridor selected.", true);
    return;
  }

  refreshInFlight = true;
  setStatus(`Refreshing ${corridor}...`);
  try {
    const [dashboardSummary, history, usableHistory, anomalies, forecast, mapCorridors, mapIncidents, analyticsTrend, analyticsHotspots] =
      await Promise.all([
        fetchJson(
          `/dashboard-api/traffic/summary?corridor=${encodeURIComponent(corridor)}&windowHours=${HOTSPOT_WINDOW_HOURS}&recentIncidentWindowMinutes=${MAP_WINDOW_MINUTES}&preferUsable=true`
        ),
        fetchJson(
          `/dashboard-api/traffic/history?corridor=${encodeURIComponent(corridor)}&windowMinutes=${HISTORY_WINDOW_MINUTES}&limit=${HISTORY_LIMIT}`
        ),
        fetchJson(
          `/dashboard-api/traffic/history?corridor=${encodeURIComponent(corridor)}&windowMinutes=${USABLE_HISTORY_WINDOW_MINUTES}&limit=${HISTORY_LIMIT}&preferUsable=true`
        ),
        fetchJson(
          `/dashboard-api/traffic/anomalies?corridor=${encodeURIComponent(corridor)}&windowMinutes=180&baselineMinutes=1440&zThreshold=2.0`
        ),
        fetchJson(
          `/dashboard-api/traffic/forecast?corridor=${encodeURIComponent(corridor)}&horizonMinutes=${FORECAST_HORIZON_MINUTES}&windowMinutes=${FORECAST_WINDOW_MINUTES}&stepMinutes=${FORECAST_STEP_MINUTES}`
        ),
        fetchJson("/dashboard-api/traffic/map/corridors"),
        fetchJson(
          `/dashboard-api/traffic/map/incidents?corridor=${encodeURIComponent(corridor)}&windowMinutes=${MAP_WINDOW_MINUTES}&limit=40`
        ),
        fetchJson(
          `/dashboard-api/traffic/analytics/trends?corridor=${encodeURIComponent(corridor)}&windowHours=${TREND_WINDOW_HOURS}&limit=${TREND_LIMIT}&preferUsable=true`
        ),
        fetchJson(
          `/dashboard-api/traffic/analytics/hotspots?corridor=${encodeURIComponent(corridor)}&windowHours=${HOTSPOT_WINDOW_HOURS}&limit=5`
        )
      ]);

    const providerStatus = dashboardSummary?.providerStatus || null;
    const latest = dashboardSummary?.latest || null;
    applyProviderGuardStatus(providerStatus);

    const latestHasSpeedData = renderLatest(dashboardSummary);
    renderHistory(history, usableHistory, forecast);
    renderTrend(analyticsTrend);
    renderAnomalies(anomalies);
    renderForecast(forecast);
    renderSummary(dashboardSummary);
    renderHotspots(
      analyticsHotspots,
      dashboardSummary?.topHotspot || null,
      mapCorridors,
      mapIncidents,
      corridor,
      dashboardSummary,
      history
    );
    renderIncidentReferences(mapIncidents);
    renderMap(mapCorridors, mapIncidents, corridor);

    const refreshedAt = new Date().toLocaleTimeString();
    const latestSampleAt = formatDateTime(latest?.polledAt) || "unknown time";
    const sampleAgeMinutes = numberValue(dashboardSummary?.sampleAgeMinutes, ageMinutes(latest?.polledAt));
    if (providerStatus?.halted) {
      setStatus(providerStatus.message || "Traffic ingestion has been halted by the provider guard.", true);
    } else if (latestHasSpeedData && sampleAgeMinutes <= STALE_SAMPLE_MINUTES) {
      setStatus(`Updated ${corridor} at ${refreshedAt}. Latest sample: ${latestSampleAt}.`);
    } else if (latestHasSpeedData) {
      setStatus(
        `Updated ${corridor} at ${refreshedAt}. Latest usable sample is stale (${formatAgeMinutes(sampleAgeMinutes)}) from ${latestSampleAt}. Recent ingest rows still lack usable speed values.`,
        true
      );
    } else {
      setStatus(
        `Updated ${corridor} at ${refreshedAt}. Latest sample: ${latestSampleAt}. No usable speed values; check ingest health.`,
        true
      );
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    refreshInFlight = false;
  }
}

function startAutoRefresh() {
  if (refreshTimer !== null) {
    return;
  }

  refreshTimer = window.setInterval(() => {
    void refreshDashboard();
  }, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (refreshTimer === null) {
    return;
  }

  window.clearInterval(refreshTimer);
  refreshTimer = null;
}

function setControlsLocked(locked) {
  corridorSelect.disabled = locked;
  refreshBtn.disabled = locked;
}

function applyProviderGuardStatus(status) {
  const state = String(status?.state || "UNKNOWN").toUpperCase();
  const stale = Boolean(status?.stale);
  const halted = Boolean(status?.halted);
  const shouldBlockDashboard = halted || stale;

  if (!shouldBlockDashboard) {
    systemWarning.classList.add("hidden");
    document.body.classList.remove("system-halted");
    setControlsLocked(false);
    if (state !== "DEGRADED") {
      clearProviderGuardNotificationMarker();
    }
    startAutoRefresh();
    if (state === "DEGRADED") {
      maybeSendProviderGuardNotification(status, false);
    }
    return;
  }

  systemWarningTitle.textContent = halted
    ? "Traffic ingestion has been halted."
    : stale
      ? "Provider status is stale."
    : "Traffic provider warning detected.";
  systemWarningMessage.textContent = halted
    ? (status?.message || "Traffic ingestion has been halted by the provider guard.")
    : stale
      ? buildProviderFreshnessMessage(status)
      : (status?.message || "Provider status is degraded.");
  systemWarningMeta.textContent = buildProviderGuardMeta(status);
  systemWarning.classList.remove("hidden");
  document.body.classList.toggle("system-halted", halted);
  setControlsLocked(halted);
  maybeSendProviderGuardNotification(status, halted);
  if (halted) {
    stopAutoRefresh();
  }
}

function buildProviderGuardMeta(status) {
  const details = parseJson(status?.detailsJson);
  const parts = [];
  if (status?.freshnessState) {
    parts.push(`Freshness: ${String(status.freshnessState).toLowerCase()}`);
  }
  if (Number.isFinite(numberValue(status?.statusAgeMinutes))) {
    parts.push(`Status age: ${formatAgeMinutes(numberValue(status.statusAgeMinutes))}`);
  }
  if (status?.failureCode) {
    parts.push(`Code: ${status.failureCode}`);
  }
  if (Number.isFinite(numberValue(details?.usableCorridors)) && Number.isFinite(numberValue(details?.corridorCount))) {
    parts.push(`Usable corridors: ${Math.round(numberValue(details.usableCorridors))}/${Math.round(numberValue(details.corridorCount))}`);
  }
  if (Number.isFinite(numberValue(details?.consecutiveStaleCycles))) {
    const staleThreshold = Number.isFinite(numberValue(details?.threshold))
      ? `/${Math.round(numberValue(details.threshold))}`
      : "";
    parts.push(`Repeated payload cycles: ${Math.max(0, Math.round(numberValue(details.consecutiveStaleCycles)))}${staleThreshold}`);
  }
  if (Number.isFinite(numberValue(details?.nextNullCycleCount)) && Number.isFinite(numberValue(details?.threshold))) {
    parts.push(`Null-cycle count: ${Math.round(numberValue(details.nextNullCycleCount))}/${Math.round(numberValue(details.threshold))}`);
  }
  if (status?.shutdownTriggeredAt) {
    parts.push(`Shutdown triggered ${formatDateTime(status.shutdownTriggeredAt)}`);
  } else if (status?.lastFailureAt) {
    parts.push(`Last failure ${formatDateTime(status.lastFailureAt)}`);
  }
  if (Number.isFinite(numberValue(status?.consecutiveNullCycles))) {
    parts.push(`Null cycles: ${Math.max(0, Math.round(numberValue(status.consecutiveNullCycles, 0)))}`);
  }
  if (status?.lastSuccessAt) {
    parts.push(`Last success ${formatDateTime(status.lastSuccessAt)}`);
  }
  return parts.join(" | ");
}

function maybeSendProviderGuardNotification(status, halted) {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }

  const signature = providerGuardNotificationSignature(status, halted);
  if (!signature) {
    return;
  }
  if (window.localStorage.getItem(PROVIDER_GUARD_NOTIFICATION_KEY) === signature) {
    return;
  }

  window.localStorage.setItem(PROVIDER_GUARD_NOTIFICATION_KEY, signature);
  const title = halted
    ? "Traffic ingestion halted"
    : status?.stale
      ? "Traffic provider status stale"
    : "Traffic provider warning";
  const body = halted
    ? (status?.message || "Provider guard detected an issue with live traffic data.")
    : status?.stale
      ? buildProviderFreshnessMessage(status)
      : (status?.message || "Provider guard detected an issue with live traffic data.");
  new Notification(title, { body });
}

function clearProviderGuardNotificationMarker() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(PROVIDER_GUARD_NOTIFICATION_KEY);
}

function providerGuardNotificationSignature(status, halted) {
  const failureCode = String(status?.failureCode || "");
  const lastFailureAt = String(status?.lastFailureAt || "");
  const shutdownTriggeredAt = String(status?.shutdownTriggeredAt || "");
  const state = String(status?.state || "UNKNOWN").toUpperCase();
  const freshnessState = String(status?.freshnessState || "");
  const statusAgeMinutes = String(status?.statusAgeMinutes || "");
  if (!failureCode && !lastFailureAt && !shutdownTriggeredAt && !freshnessState && state === "UNKNOWN") {
    return "";
  }
  return [
    halted ? "halted" : "warning",
    state,
    failureCode,
    lastFailureAt,
    shutdownTriggeredAt,
    freshnessState,
    statusAgeMinutes
  ].join("|");
}

function buildProviderFreshnessMessage(status) {
  if (Number.isFinite(numberValue(status?.statusAgeMinutes))) {
    return `No fresh provider guard update has been recorded for ${formatAgeMinutes(numberValue(status.statusAgeMinutes))}. Confirm ingest is still polling and writing guard status updates.`;
  }
  return "No fresh provider guard update has been recorded recently. Confirm ingest is still polling and writing guard status updates.";
}

function populateCorridors(corridors) {
  corridorSelect.innerHTML = "";
  if (!Array.isArray(corridors) || corridors.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No corridors";
    corridorSelect.appendChild(empty);
    return;
  }

  for (const corridor of corridors) {
    const option = document.createElement("option");
    option.value = corridor;
    option.textContent = corridor;
    corridorSelect.appendChild(option);
  }
}

function renderLatest(summary) {
  const latest = summary?.latest || {};
  const sourceMode = String(latest?.sourceMode || "").trim().toLowerCase();
  const current = numberValue(latest.avgCurrentSpeed);
  const freeflow = numberValue(latest.avgFreeflowSpeed);
  const minCurrent = numberValue(latest.minCurrentSpeed);
  const confidence = numberValue(latest.confidence);
  const sampleAgeMinutes = numberValue(summary?.sampleAgeMinutes, ageMinutes(latest?.polledAt));
  const speedDeltaFromWindow = numberValue(summary?.speedDeltaFromWindowAverage);
  const hasSpeedData = Number.isFinite(current) || Number.isFinite(numberValue(latest.minCurrentSpeed));

  metricCurrent.textContent = formatSpeed(current);
  metricCurrentMeta.textContent = sourceMode === "point"
    ? "Point-mode corridor average using provider freeflow and confidence."
    : sourceMode === "tile"
      ? "Tile-mode corridor average using sampled route tiles."
      : "Latest usable corridor speed sample.";

  if (sourceMode === "point") {
    metricSecondaryLabel.textContent = "Freeflow Delta";
    metricSecondary.textContent = Number.isFinite(current) && Number.isFinite(freeflow)
      ? `${current - freeflow >= 0 ? "+" : ""}${(current - freeflow).toFixed(1)} mph`
      : "-";
    metricSecondaryMeta.textContent = "Compared with provider-reported freeflow speed.";

    metricTertiaryLabel.textContent = "Confidence";
    metricTertiary.textContent = Number.isFinite(confidence)
      ? `${Math.round(confidence * 100)}%`
      : "-";
    metricTertiaryMeta.textContent = "Provider-reported point-mode observation confidence.";
    return hasSpeedData;
  }

  metricSecondaryLabel.textContent = "Vs 7 Day Avg";
  metricSecondary.textContent = formatSignedSpeedDelta(speedDeltaFromWindow);
  metricSecondaryMeta.textContent = Number.isFinite(speedDeltaFromWindow)
    ? `Compared with the rolling ${numberValue(summary?.summaryWindowHours, HOTSPOT_WINDOW_HOURS)}h corridor average.`
    : "Rolling corridor average is not available yet.";

  metricTertiaryLabel.textContent = "Slowest Segment";
  metricTertiary.textContent = formatSpeed(minCurrent);
  metricTertiaryMeta.textContent = Number.isFinite(minCurrent)
    ? "Lowest sampled route speed within the latest usable tile cycle."
    : latest?.polledAt
      ? `Latest usable sample captured ${formatDateTime(latest.polledAt)} (${formatAgeMinutes(sampleAgeMinutes)}).`
      : "Latest usable sample timestamp is unavailable.";

  return hasSpeedData;
}

function renderHistory(history, usableHistory, forecast) {
  const recentSamples = Array.isArray(history.samples) ? history.samples.slice().reverse() : [];
  const recentSeries = recentSamples
    .filter((sample) => Number.isFinite(numberValue(sample.avgCurrentSpeed)))
    .map((sample) => ({
      y: numberValue(sample.avgCurrentSpeed),
      timestamp: parseTimestampMillis(sample.polledAt),
      xLabel: formatTime(sample.polledAt)
    }))
    .filter((point) => Number.isFinite(point.timestamp));
  const fallbackSamples = Array.isArray(usableHistory.samples) ? usableHistory.samples.slice().reverse() : [];
  const fallbackSeries = fallbackSamples
    .filter((sample) => Number.isFinite(numberValue(sample.avgCurrentSpeed)))
    .map((sample) => ({
      y: numberValue(sample.avgCurrentSpeed),
      timestamp: parseTimestampMillis(sample.polledAt),
      xLabel: formatShortDateTime(sample.polledAt)
    }))
    .filter((point) => Number.isFinite(point.timestamp));
  const series = recentSeries.length >= 2 ? recentSeries : fallbackSeries;
  const predictions = Array.isArray(forecast?.predictions) ? forecast.predictions : [];
  const predictionSeries = predictions
    .filter((point) => Number.isFinite(numberValue(point.predictedSpeed)))
    .map((point) => ({
      y: numberValue(point.predictedSpeed),
      timestamp: parseTimestampMillis(point.timestamp),
      xLabel: formatTime(point.timestamp)
    }))
    .filter((point) => Number.isFinite(point.timestamp));
  const averageSeries = buildRollingAverageSeries(series);

  if (recentSeries.length >= 2) {
    historyMeta.textContent = `${recentSeries.length} usable speed samples (${recentSamples.length} recent total)${predictionSeries.length > 0 ? ` | ${predictionSeries.length} backend projections` : ""}`;
  } else if (fallbackSeries.length >= 2) {
    historyMeta.textContent = `${fallbackSeries.length} usable speed samples (7d fallback; ${recentSamples.length} recent rows lacked speed)${predictionSeries.length > 0 ? ` | ${predictionSeries.length} backend projections` : ""}`;
  } else {
    historyMeta.textContent = `${Math.max(recentSeries.length, fallbackSeries.length)} usable speed samples available${predictionSeries.length > 0 ? ` | ${predictionSeries.length} backend projections` : ""}`;
  }
  drawHistoryScatterTrendChart(document.getElementById("historyCanvas"), series, averageSeries, predictionSeries, { yLabel: "mph" });
}

function renderTrend(trend) {
  const buckets = Array.isArray(trend.buckets) ? trend.buckets : [];
  const speedSeries = buckets
    .filter((bucket) => Number.isFinite(numberValue(bucket.avgCurrentSpeed)))
    .map((bucket) => ({
        y: numberValue(bucket.avgCurrentSpeed),
        xLabel: formatShortDate(bucket.bucketStart)
      }));
  const p90Series = buckets
    .filter((bucket) => Number.isFinite(numberValue(bucket.avgP90Speed)))
    .map((bucket) => ({
      y: numberValue(bucket.avgP90Speed),
      xLabel: formatShortDate(bucket.bucketStart)
    }));

  trendMeta.textContent = speedSeries.length > 0
    ? `${speedSeries.length} usable hourly buckets`
    : "No usable hourly buckets in selected window";
  drawChart(document.getElementById("trendCanvas"), [
    { name: "Avg speed", color: "#285ea8", points: speedSeries },
    { name: "Upper traffic band", color: "#db6c3f", points: p90Series }
  ], { yLabel: "mph" });
}

function renderAnomalies(anomalies) {
  const rows = Array.isArray(anomalies.anomalies) ? anomalies.anomalies : [];
  metricAnomalies.textContent = String(numberValue(anomalies.anomalyCount, 0));

  anomalyList.innerHTML = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.textContent = anomalies.note || "No recent anomalies detected.";
    anomalyList.appendChild(li);
    return;
  }

  for (const row of rows.slice(0, 5)) {
    const li = document.createElement("li");
    li.textContent = `${formatDateTime(row.polledAt)}: observed ${formatSpeed(row.observedSpeed)}, expected minimum ${formatSpeed(row.expectedMinimumSpeed)} (z=${numberValue(row.zScore, 0).toFixed(2)})`;
    anomalyList.appendChild(li);
  }
}

function renderForecast(forecast) {
  const predictions = Array.isArray(forecast.predictions) ? forecast.predictions : [];
  forecastMeta.textContent = predictions.length > 0
    ? `${predictions.length} projected points`
    : (forecast.note || "0 projected points");

  const main = predictions.map((point) => ({
    y: numberValue(point.predictedSpeed),
    xLabel: formatTime(point.timestamp)
  }));
  const lower = predictions.map((point) => ({
    y: numberValue(point.lowerBoundSpeed),
    xLabel: formatTime(point.timestamp)
  }));
  const upper = predictions.map((point) => ({
    y: numberValue(point.upperBoundSpeed),
    xLabel: formatTime(point.timestamp)
  }));

  drawChart(document.getElementById("forecastCanvas"), [
    { name: "Lower", color: "#db6c3f", points: lower },
    { name: "Predicted", color: "#285ea8", points: main },
    { name: "Upper", color: "#0f766e", points: upper }
  ], { yLabel: "mph" });
}

function renderSummary(summary) {
  const current = summary?.corridorSummary || null;
  const latest = summary?.latest || null;
  const resolvedIncidents = Math.max(
    0,
    Math.round(numberValue(summary?.recentIncidentObservationCount, 0) - numberValue(summary?.recentMissingMileMarkerCount, 0))
  );
  const recentObservationCount = Math.max(0, Math.round(numberValue(summary?.recentIncidentObservationCount, 0)));

  if (!current) {
    metricIncidentTotal.textContent = "-";
    summaryMeta.textContent = "No corridor analytics";
    summaryStats.innerHTML = "<div><dt>No summary</dt><dd>Analytics are not available yet</dd></div>";
    return;
  }

  metricIncidentTotal.textContent = formatCount(current.totalIncidentCount);
  summaryMeta.textContent = `${numberValue(summary?.summaryWindowHours, HOTSPOT_WINDOW_HOURS)}h corridor rollup`;

  const items = [
    ["Current Speed", formatSpeed(latest?.avgCurrentSpeed)],
    ["Rolling Avg", formatSpeed(current.avgCurrentSpeed)],
    ["Current Vs Window", formatSignedSpeedDelta(summary?.speedDeltaFromWindowAverage)],
    ["Observed Low", formatSpeed(current.minCurrentSpeed)],
    ["Recent Coverage", recentObservationCount > 0 ? `${resolvedIncidents}/${recentObservationCount} tagged` : "0/0 tagged"],
    ["Buckets", formatCount(current.bucketCount)],
    ["Window", `${formatShortDate(current.firstBucketStart)} to ${formatShortDate(current.lastBucketStart)}`]
  ];

  summaryStats.innerHTML = items.map(([label, value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  ).join("");
}

function renderHotspots(hotspots, topHotspot, corridorsCollection, incidentsCollection, selectedCorridor, summary, history) {
  const rows = Array.isArray(hotspots.hotspots) ? hotspots.hotspots : [];
  const corridorFeatures = Array.isArray(corridorsCollection?.features) ? corridorsCollection.features : [];
  const selectedFeature = corridorFeatures.find((feature) => feature.properties?.corridor === selectedCorridor) || null;
  const incidentFeatures = Array.isArray(incidentsCollection?.features) ? incidentsCollection.features : [];
  const zones = buildHotspotZonePages(selectedFeature, incidentFeatures, rows, summary, history);

  const lead = topHotspot || rows[0] || null;
  const nextSignature = hotspotZoneSetSignature(selectedCorridor, zones);
  const preservePage = nextSignature === hotspotZoneSignature && zones.length > 0;
  hotspotZonePages = zones;
  hotspotZonePageIndex = preservePage ? hotspotZonePageIndex % zones.length : 0;
  hotspotZoneSignature = nextSignature;

  if (zones.length === 0) {
    stopHotspotZoneRotation();
    hotspotMeta.textContent = `${rows.length} windowed hotspot clusters`;
    metricHotspot.textContent = lead?.mileMarkerBand != null
      ? `MM ${lead.mileMarkerBand} ${lead.travelDirection || ""}`.trim()
      : "-";
    hotspotZonePager.innerHTML = '<p class="zone-empty">No posted speed-zone context is available for this corridor yet.</p>';
    return;
  }

  metricHotspot.textContent = lead?.mileMarkerBand != null
    ? `MM ${lead.mileMarkerBand} ${lead.travelDirection || ""}`.trim()
    : `${zones[0].speedLimitMph} mph zone`;
  renderHotspotZonePage();
  startHotspotZoneRotation();
}

function buildHotspotZonePages(selectedFeature, incidentFeatures, hotspotRows, summary, history) {
  const zones = speedLimitSegments(selectedFeature);
  if (zones.length === 0) return [];

  const historyPoints = twoHourHistoryPoints(history);
  const latestSpeed = numberValue(
    selectedFeature?.properties?.latestAvgCurrentSpeed,
    numberValue(summary?.latest?.avgCurrentSpeed)
  );
  return zones.map((zone) => {
    const incidentsInZone = incidentFeatures.filter((feature) =>
      markerInsideSegment(feature?.properties?.closestMileMarker, zone)
    );
    const references = aggregateIncidentReferences(incidentsInZone);
    const hotspotsInZone = hotspotRows.filter((row) =>
      markerInsideSegment(row?.mileMarkerBand, zone)
    );
    const observationCount = hotspotsInZone.reduce((sum, row) => sum + Math.max(0, Math.round(numberValue(row.observationCount, 0))), 0);
    const incidentThreadCount = hotspotsInZone.reduce((sum, row) => sum + Math.max(0, Math.round(numberValue(row.incidentCount, 0))), 0);
    const peakDelay = Math.max(
      0,
      ...hotspotsInZone.map((row) => numberValue(row.maxDelaySeconds, 0)),
      ...references.map((reference) => numberValue(reference.maxDelaySeconds, 0))
    );
    return {
      ...zone,
      latestSpeed,
      speedDelta: Number.isFinite(latestSpeed) ? latestSpeed - zone.speedLimitMph : Number.NaN,
      incidentObservationCount: incidentsInZone.length,
      incidentReferenceCount: references.length,
      hotspotObservationCount: observationCount,
      hotspotIncidentThreadCount: incidentThreadCount,
      peakDelaySeconds: peakDelay,
      leadingReference: references[0] || null,
      leadingHotspot: hotspotsInZone[0] || null,
      historyPoints
    };
  });
}

function renderHotspotZonePage() {
  if (!hotspotZonePager || hotspotZonePages.length === 0) return;

  const page = hotspotZonePages[hotspotZonePageIndex % hotspotZonePages.length];
  hotspotMeta.textContent = `Zone ${hotspotZonePageIndex + 1}/${hotspotZonePages.length} | ${formatMileMarker(page.startMileMarker)}-${formatMileMarker(page.endMileMarker)}`;
  const avgLine = Number.isFinite(page.latestSpeed)
    ? `${formatSpeed(page.latestSpeed)} (${formatSignedSpeedDelta(page.speedDelta)} vs ${Math.round(page.speedLimitMph)} mph posted)`
    : "Current corridor speed unavailable";
  const incidentLine = page.incidentObservationCount > 0
    ? `${formatCount(page.incidentObservationCount)} observations across ${formatCount(page.incidentReferenceCount)} incident threads`
    : "No mapped incidents in this zone window";
  const hotspotLine = page.hotspotObservationCount > 0
    ? `${formatCount(page.hotspotObservationCount)} hotspot observations, peak delay ${formatSeconds(page.peakDelaySeconds)}`
    : "No hotspot cluster centered in this speed zone";
  const historyLine = page.historyPoints.length >= 2
    ? `${page.historyPoints.length} samples against ${Math.round(page.speedLimitMph)} mph posted`
    : "Not enough 2 hour speed samples yet";
  const focusLine = page.leadingReference?.label
    || (page.leadingHotspot ? formatHotspotReferenceLabel(page.leadingHotspot) : hotspotLine || page.description || "No active focus");

  hotspotZonePager.innerHTML = `
    <article class="zone-page">
      <div class="zone-page-head">
        <p class="zone-kicker">${escapeHtml(Math.round(page.speedLimitMph))} MPH Zone</p>
        <strong>${escapeHtml(formatMileMarker(page.startMileMarker))} to ${escapeHtml(formatMileMarker(page.endMileMarker))}</strong>
      </div>
      <dl class="zone-stats">
        <div><dt>Average</dt><dd>${escapeHtml(avgLine)}</dd></div>
        <div><dt>Incidents</dt><dd>${escapeHtml(incidentLine)}</dd></div>
        <div class="zone-history-card">
          <dt>2 Hour History</dt>
          <dd>
            <canvas id="zoneHistoryCanvas" width="420" height="118" aria-label="Two hour corridor speed history"></canvas>
            <span>${escapeHtml(historyLine)}</span>
          </dd>
        </div>
      </dl>
      <p class="zone-note">${escapeHtml(focusLine)}</p>
      <div class="zone-dots" aria-hidden="true">
        ${hotspotZonePages.map((_, index) => `<span class="${index === hotspotZonePageIndex ? "active" : ""}"></span>`).join("")}
      </div>
    </article>
  `;
  drawZoneHistoryGraph(document.getElementById("zoneHistoryCanvas"), page.historyPoints, page.speedLimitMph);
}

function startHotspotZoneRotation() {
  if (hotspotZonePages.length <= 1) {
    stopHotspotZoneRotation();
    return;
  }
  if (hotspotZoneTimer !== null) return;
  hotspotZoneTimer = window.setInterval(() => {
    hotspotZonePageIndex = (hotspotZonePageIndex + 1) % hotspotZonePages.length;
    renderHotspotZonePage();
  }, HOTSPOT_ZONE_ROTATION_MS);
}

function stopHotspotZoneRotation() {
  if (hotspotZoneTimer === null) return;
  window.clearInterval(hotspotZoneTimer);
  hotspotZoneTimer = null;
}

function markerInsideSegment(markerValue, segment) {
  const marker = numberValue(markerValue);
  if (!Number.isFinite(marker)) return false;
  const low = Math.min(segment.startMileMarker, segment.endMileMarker);
  const high = Math.max(segment.startMileMarker, segment.endMileMarker);
  return marker >= low && marker <= high;
}

function hotspotZoneSetSignature(selectedCorridor, zones) {
  return [
    selectedCorridor || "",
    ...zones.map((zone) => [
      zone.startMileMarker,
      zone.endMileMarker,
      zone.speedLimitMph
    ].map((value) => Number.isFinite(numberValue(value)) ? numberValue(value).toFixed(3) : "").join(":"))
  ].join("|");
}

function twoHourHistoryPoints(history) {
  const samples = Array.isArray(history?.samples) ? history.samples : [];
  const points = samples
    .map((sample) => ({
      speed: numberValue(sample.avgCurrentSpeed),
      timestamp: sample.polledAt ? Date.parse(sample.polledAt) : Number.NaN
    }))
    .filter((point) => Number.isFinite(point.speed) && Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length === 0) return [];
  const latestTimestamp = points[points.length - 1].timestamp;
  const cutoff = latestTimestamp - (120 * 60 * 1000);
  return points
    .filter((point) => point.timestamp >= cutoff)
    .slice(-80)
    .map((point) => ({
      y: point.speed,
      timestamp: point.timestamp,
      xLabel: formatTime(new Date(point.timestamp).toISOString())
    }));
}

function drawZoneHistoryGraph(canvas, points, speedLimitMph) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { top: 12, right: 12, bottom: 18, left: 28 };
  const drawWidth = width - pad.left - pad.right;
  const drawHeight = height - pad.top - pad.bottom;
  const speeds = points.map((point) => point.y).filter((value) => Number.isFinite(value));
  const limit = numberValue(speedLimitMph);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.44)";
  ctx.fillRect(0, 0, width, height);

  if (speeds.length === 0) {
    ctx.fillStyle = "#56655f";
    ctx.font = '13px "IBM Plex Mono", monospace';
    ctx.fillText("Waiting for speed samples", 16, 32);
    return;
  }

  let minY = Math.min(...speeds, Number.isFinite(limit) ? limit : speeds[0]);
  let maxY = Math.max(...speeds, Number.isFinite(limit) ? limit : speeds[0]);
  if (Math.abs(maxY - minY) < 1) {
    maxY += 1;
    minY -= 1;
  }
  const span = maxY - minY;
  minY = Math.max(0, minY - span * 0.18);
  maxY += span * 0.18;

  ctx.strokeStyle = "rgba(86, 101, 95, 0.16)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i += 1) {
    const y = pad.top + (drawHeight * i) / 2;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  if (Number.isFinite(limit)) {
    const limitY = pad.top + ((maxY - limit) / (maxY - minY)) * drawHeight;
    ctx.strokeStyle = "rgba(197, 100, 60, 0.72)";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(pad.left, limitY);
    ctx.lineTo(width - pad.right, limitY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8f4b31";
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(`${Math.round(limit)} posted`, pad.left + 4, Math.max(12, limitY - 5));
  }

  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 2.8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = pad.left + (points.length === 1 ? drawWidth / 2 : (drawWidth * index) / (points.length - 1));
    const y = pad.top + ((maxY - point.y) / (maxY - minY)) * drawHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const last = points[points.length - 1];
  const lastX = pad.left + (points.length === 1 ? drawWidth / 2 : drawWidth);
  const lastY = pad.top + ((maxY - last.y) / (maxY - minY)) * drawHeight;
  ctx.fillStyle = "#0a3f39";
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#56655f";
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillText(points[0].xLabel || "", pad.left, height - 5);
  ctx.textAlign = "right";
  ctx.fillText(last.xLabel || "", width - pad.right, height - 5);
  ctx.textAlign = "left";
}

function renderIncidentReferences(incidents) {
  const rows = Array.isArray(incidents.features) ? incidents.features : [];
  const references = aggregateIncidentReferences(rows);
  incidentMeta.textContent = rows.length === references.length
    ? `${rows.length} incidents on map`
    : `${references.length} incident threads from ${rows.length} observations`;
  incidentList.innerHTML = "";

  if (references.length === 0) {
    incidentList.innerHTML = "<li>No mapped incidents in the selected window.</li>";
    return;
  }

  for (const reference of references.slice(0, 6)) {
    const li = document.createElement("li");
    li.textContent = [
      `${reference.label}: ${formatCount(reference.observationCount)} observations`,
      formatPeakDelaySummary(reference.maxDelaySeconds),
      formatObservationTiming(reference.firstSeenAt, reference.lastSeenAt)
    ].join(", ");
    incidentList.appendChild(li);
  }
}

function renderMap(corridorsCollection, incidentsCollection, selectedCorridor) {
  corridorMap.innerHTML = "";
  hideMapTooltip();
  const corridorFeatures = Array.isArray(corridorsCollection.features) ? corridorsCollection.features : [];
  const incidentFeatures = Array.isArray(incidentsCollection.features) ? incidentsCollection.features : [];
  const selectedFeature = corridorFeatures.find((feature) => feature.properties?.corridor === selectedCorridor) || null;
  const focusedCorridors = selectedFeature ? [selectedFeature] : corridorFeatures;

  const bounds = featureBounds(focusedCorridors, incidentFeatures);
  if (!bounds) {
    mapMeta.textContent = "No spatial data";
    mapLegend.textContent = "No corridor or incident geometry is available yet.";
    renderSpeedLimitContext(null);
    renderMapPlaceholder("Map data is not available yet.");
    return;
  }

  mapMeta.textContent = `${focusedCorridors.length} corridor, ${incidentFeatures.length} incidents`;
  mapLegend.textContent = selectedFeature?.properties?.geometrySource === "bbox-derived"
    ? "Corridor extent is approximated from the configured bounding box because routing geometry is unavailable. Incident dots are shown as snapped display points when possible; orange markers are approximate and slate markers had weak corridor confidence."
    : "Highlighted corridor uses configured map geometry. Posted speed-limit changes are shown as mile-marker callouts; incident dots remain snapped to corridor points when possible.";
  renderSpeedLimitContext(selectedFeature);

  drawMapBackground();
  for (const feature of focusedCorridors) {
    drawCorridorFeature(feature, bounds, feature.properties?.corridor === selectedCorridor);
  }
  if (selectedFeature) {
    drawSpeedLimitCallouts(selectedFeature, bounds);
  }
  for (const feature of incidentFeatures) {
    drawIncidentFeature(feature, bounds);
  }
}

function drawMapBackground() {
  const rect = document.createElementNS(svgNs, "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", "900");
  rect.setAttribute("height", "520");
  rect.setAttribute("fill", "#fbfdfb");
  corridorMap.appendChild(rect);
}

function drawCorridorFeature(feature, bounds, selected) {
  if (selected && feature.properties?.geometrySource === "bbox-derived") {
    drawCorridorEnvelope(feature, bounds);
  }

  const points = geometryPoints(feature.geometry);
  if (points.length < 2) return;

  const projectedPoints = points.map((point) => projectPoint(point, bounds).join(",")).join(" ");
  if (selected) {
    const core = document.createElementNS(svgNs, "polyline");
    core.setAttribute("fill", "none");
    core.setAttribute("stroke", "#0f766e");
    core.setAttribute("stroke-width", "10");
    core.setAttribute("stroke-linecap", "round");
    core.setAttribute("stroke-linejoin", "round");
    core.setAttribute("opacity", "0.98");
    core.setAttribute("points", projectedPoints);
    corridorMap.appendChild(core);
  } else {
    const polyline = document.createElementNS(svgNs, "polyline");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "#8fa5a0");
    polyline.setAttribute("stroke-width", "6");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    polyline.setAttribute("opacity", "0.5");
    polyline.setAttribute("points", projectedPoints);
    corridorMap.appendChild(polyline);
  }

}

function drawSpeedLimitCallouts(feature, bounds) {
  const segments = speedLimitSegments(feature);
  const points = geometryPoints(feature.geometry);
  if (segments.length === 0 || points.length < 2) return;

  const markers = speedLimitBoundaryMarkers(segments);
  const startMarker = numberValue(feature.properties?.startMileMarker);
  const endMarker = numberValue(feature.properties?.endMileMarker);
  drawSpeedLimitGuides(feature, bounds, segments, markers, startMarker, endMarker);
}

function drawSpeedLimitGuides(feature, bounds, segments, markers, startMarker, endMarker) {
  const points = geometryPoints(feature.geometry);
  const sortedMarkers = markers.slice().sort((a, b) => a - b);
  const routeStart = numberValue(feature.properties?.startMileMarker);
  const routeEnd = numberValue(feature.properties?.endMileMarker);
  const descending = Number.isFinite(routeStart) && Number.isFinite(routeEnd) && routeStart > routeEnd;
  const labelMarkers = descending ? sortedMarkers.slice().reverse() : sortedMarkers;
  const layoutMode = routeLabelLayoutMode(points, bounds);
  const callouts = [];

  labelMarkers.forEach((marker, index) => {
    const routePoint = pointForMileMarker(points, feature.properties?.startMileMarker, feature.properties?.endMileMarker, marker);
    if (!routePoint) return;

    const [x, y] = projectPoint(routePoint, bounds);
    const isEndpoint = nearlyEqual(marker, startMarker) || nearlyEqual(marker, endMarker);
    drawCrossbar(x, y, isEndpoint, layoutMode === "horizontal" ? "vertical" : "horizontal");

    callouts.push(
      layoutMode === "horizontal"
        ? mileMarkerCalloutHorizontal(marker, index, labelMarkers.length, x, y, isEndpoint)
        : mileMarkerCallout(marker, index, labelMarkers.length, x, y, isEndpoint)
    );
  });

  segments.forEach((segment, index) => {
    const midpoint = (segment.startMileMarker + segment.endMileMarker) / 2;
    const routePoint = pointForMileMarker(points, feature.properties?.startMileMarker, feature.properties?.endMileMarker, midpoint);
    if (!routePoint) return;

    const [x, y] = projectPoint(routePoint, bounds);
    callouts.push(
      layoutMode === "horizontal"
        ? speedSectionCalloutHorizontal(segment, index, x, y)
        : speedSectionCallout(segment, index, x, y, index % 2 === 0 ? "right" : "left")
    );
  });

  const corridorName = feature.properties?.displayName || feature.properties?.corridor || null;
  const mapCorridorLabel = layoutMode === "horizontal"
    ? (feature.properties?.roadNumber || feature.properties?.corridor || corridorName)
    : corridorName;
  const corridorLabelPoint = pointAtRouteFraction(points, layoutMode === "horizontal" ? 0.52 : 0.62);
  if (mapCorridorLabel && corridorLabelPoint) {
    const [x, y] = projectPoint(corridorLabelPoint, bounds);
    callouts.push({
      text: mapCorridorLabel,
      x: layoutMode === "horizontal" ? Math.max(110, x - 8) : Math.min(850, x + 34),
      y: layoutMode === "horizontal" ? Math.min(486, y + 52) : y + 4,
      side: layoutMode === "horizontal" ? "bottom-corridor" : "right",
      flow: layoutMode === "horizontal" ? "horizontal" : "vertical",
      className: "map-annotation",
      anchor: layoutMode === "horizontal" ? "middle" : "start",
      minGap: layoutMode === "horizontal" ? 72 : 26,
      textWidth: estimateCalloutWidth(mapCorridorLabel, "map-annotation")
    });
  }

  for (const callout of resolveCalloutCollisions(callouts)) {
    if (callout.leaderFrom) {
      drawLeaderLine(callout.leaderFrom, callout);
    }
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", String(callout.x));
    label.setAttribute("y", String(callout.y));
    label.setAttribute("class", callout.className);
    label.setAttribute("text-anchor", callout.anchor);
    label.textContent = callout.text;
    corridorMap.appendChild(label);
  }
}

function drawCrossbar(x, y, isEndpoint, orientation = "horizontal") {
  const line = document.createElementNS(svgNs, "line");
  const length = isEndpoint ? 18 : 15;
  if (orientation === "vertical") {
    line.setAttribute("x1", String(x));
    line.setAttribute("y1", String(y - length));
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(y + length));
  } else {
    line.setAttribute("x1", String(x - length));
    line.setAttribute("y1", String(y));
    line.setAttribute("x2", String(x + length));
    line.setAttribute("y2", String(y));
  }
  line.setAttribute("class", isEndpoint ? "mile-marker-crossbar mile-marker-crossbar-end" : "mile-marker-crossbar");
  corridorMap.appendChild(line);
}

function drawLeaderLine(from, callout) {
  const targetX = callout.anchor === "end"
    ? callout.x - 8
    : callout.anchor === "middle"
      ? callout.x
      : callout.x + 8;
  const line = document.createElementNS(svgNs, "polyline");
  line.setAttribute("fill", "none");
  line.setAttribute("points", [
    `${from.x},${from.y}`,
    `${targetX},${callout.y - 5}`
  ].join(" "));
  line.setAttribute("class", "speed-section-leader");
  corridorMap.appendChild(line);
}

function drawCorridorEnvelope(feature, bounds) {
  const bbox = parseBbox(feature.properties?.bbox);
  if (!bbox) return;

  const corners = [
    [bbox.minLon, bbox.maxLat],
    [bbox.maxLon, bbox.maxLat],
    [bbox.maxLon, bbox.minLat],
    [bbox.minLon, bbox.minLat],
    [bbox.minLon, bbox.maxLat]
  ];

  const polygon = document.createElementNS(svgNs, "polygon");
  polygon.setAttribute("points", corners.map((point) => projectPoint(point, bounds).join(",")).join(" "));
  polygon.setAttribute("fill", "rgba(15, 118, 110, 0.08)");
  polygon.setAttribute("stroke", "rgba(15, 118, 110, 0.24)");
  polygon.setAttribute("stroke-width", "2");
  polygon.setAttribute("stroke-dasharray", "8 6");
  corridorMap.appendChild(polygon);
}

function drawIncidentFeature(feature, bounds) {
  const point = featureCenter(feature.geometry);
  if (!point) return;

  const [x, y] = projectPoint(point, bounds);
  const delaySeconds = numberValue(feature.properties?.delaySeconds, 0);
  const radius = Math.max(5, Math.min(16, 5 + (delaySeconds / 240)));
  const isOffCorridor = Boolean(feature.properties?.isOffCorridor);
  const isApproximateLocation = Boolean(feature.properties?.isApproximateLocation);
  const circle = document.createElementNS(svgNs, "circle");
  circle.setAttribute("cx", String(x));
  circle.setAttribute("cy", String(y));
  circle.setAttribute("r", String(radius));
  circle.setAttribute("fill", incidentFillColor(delaySeconds, isApproximateLocation, isOffCorridor));
  circle.setAttribute("fill-opacity", isOffCorridor ? "0.62" : isApproximateLocation ? "0.76" : "0.82");
  circle.setAttribute("stroke", incidentStrokeColor(isApproximateLocation, isOffCorridor));
  circle.setAttribute("stroke-width", "2");
  if (isOffCorridor) {
    circle.setAttribute("stroke-dasharray", "4 3");
  }
  circle.setAttribute("tabindex", "0");
  circle.setAttribute("role", "img");
  circle.setAttribute("aria-label", buildIncidentAriaLabel(feature));

  const title = document.createElementNS(svgNs, "title");
  title.textContent = [
    feature.properties?.incidentDisplayLabel || feature.properties?.referenceLabel || "Incident",
    feature.properties?.incidentTypeLabel || formatIncidentType(feature.properties?.iconCategory),
    formatDelaySummary(feature.properties?.delaySeconds, feature.properties?.delaySeconds),
    feature.properties?.mapSnappedToCorridor ? "snapped to corridor" : isOffCorridor ? "off corridor" : isApproximateLocation ? "approximate location" : "corridor aligned"
  ].join(" | ");
  circle.appendChild(title);
  bindIncidentTooltip(circle, feature, x, y);
  corridorMap.appendChild(circle);
}

function renderMapPlaceholder(message) {
  drawMapBackground();
  const text = document.createElementNS(svgNs, "text");
  text.setAttribute("x", "450");
  text.setAttribute("y", "260");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("class", "map-placeholder");
  text.textContent = message;
  corridorMap.appendChild(text);
}

function featureBounds(corridorFeatures, incidentFeatures) {
  const allPoints = [];
  for (const feature of corridorFeatures) {
    allPoints.push(...geometryPoints(feature.geometry));
  }
  for (const feature of incidentFeatures) {
    const center = featureCenter(feature.geometry);
    if (center) allPoints.push(center);
  }

  if (allPoints.length === 0) return null;

  const lons = allPoints.map((point) => point[0]);
  const lats = allPoints.map((point) => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  return {
    minLon,
    maxLon,
    minLat,
    maxLat
  };
}

function geometryPoints(geometry) {
  if (!geometry || !geometry.type) return [];

  if (geometry.type === "LineString") {
    return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  }
  if (geometry.type === "MultiLineString") {
    return (geometry.coordinates || []).flatMap((line) => line || []);
  }
  if (geometry.type === "Point") {
    return Array.isArray(geometry.coordinates) ? [geometry.coordinates] : [];
  }
  return [];
}

function parseBbox(bbox) {
  if (!bbox || typeof bbox !== "string") return null;
  const parts = bbox.split(",").map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;

  return {
    minLat: Math.min(parts[0], parts[2]),
    minLon: Math.min(parts[1], parts[3]),
    maxLat: Math.max(parts[0], parts[2]),
    maxLon: Math.max(parts[1], parts[3])
  };
}

function featureCenter(geometry) {
  const points = geometryPoints(geometry);
  if (points.length === 0) return null;

  const lon = points.reduce((sum, point) => sum + numberValue(point[0], 0), 0) / points.length;
  const lat = points.reduce((sum, point) => sum + numberValue(point[1], 0), 0) / points.length;
  return [lon, lat];
}

function projectPoint(point, bounds) {
  const width = 900;
  const height = 520;
  const pad = 44;
  const lonSpan = Math.max(0.001, bounds.maxLon - bounds.minLon);
  const latSpan = Math.max(0.001, bounds.maxLat - bounds.minLat);
  const scale = Math.min((width - pad * 2) / lonSpan, (height - pad * 2) / latSpan);

  const contentWidth = lonSpan * scale;
  const contentHeight = latSpan * scale;
  const offsetX = (width - contentWidth) / 2;
  const offsetY = (height - contentHeight) / 2;

  const x = offsetX + (point[0] - bounds.minLon) * scale;
  const y = height - offsetY - (point[1] - bounds.minLat) * scale;
  return [x, y];
}

function renderSpeedLimitContext(feature) {
  if (!speedLimitContext) return;

  const segments = speedLimitSegments(feature);
  if (!feature || segments.length === 0) {
    speedLimitContext.classList.add("hidden");
    speedLimitContext.innerHTML = "";
    return;
  }

  const latestSpeed = numberValue(feature.properties?.latestAvgCurrentSpeed);
  const weightedLimit = weightedPostedSpeedLimit(segments);
  const speedRatio = Number.isFinite(latestSpeed) && Number.isFinite(weightedLimit) && weightedLimit > 0
    ? latestSpeed / weightedLimit
    : Number.NaN;
  const speedDelta = Number.isFinite(latestSpeed) && Number.isFinite(weightedLimit)
    ? latestSpeed - weightedLimit
    : Number.NaN;
  const uniqueLimits = [...new Set(segments.map((segment) => segment.speedLimitMph))]
    .filter((value) => Number.isFinite(numberValue(value)))
    .sort((a, b) => a - b);

  speedLimitContext.classList.remove("hidden");
  speedLimitContext.innerHTML = [
    '<div class="speed-limit-context-head">',
    '<div><p class="speed-limit-eyebrow">Posted Speed Context</p>',
    `<strong>${escapeHtml(feature.properties?.displayName || feature.properties?.corridor || "Corridor")}</strong></div>`,
    `<span>${escapeHtml(uniqueLimits.map((limit) => `${limit} mph`).join(" / "))}</span>`,
    '</div>',
    '<div class="speed-limit-metrics">',
    `<div><dt>Weighted limit</dt><dd>${escapeHtml(formatSpeed(weightedLimit))}</dd></div>`,
    `<div><dt>Current vs posted</dt><dd>${escapeHtml(formatSignedSpeedDelta(speedDelta))}</dd></div>`,
    `<div><dt>Current ratio</dt><dd>${Number.isFinite(speedRatio) ? `${Math.round(speedRatio * 100)}%` : "-"}</dd></div>`,
    '</div>',
    `<p>${escapeHtml(feature.properties?.speedLimitNote || "Baseline posted limits from corridor segment data.")}</p>`,
    '<div class="speed-limit-chips">',
    segments.map((segment) => `
      <span class="speed-limit-chip">
        <i>${escapeHtml(String(Math.round(segment.speedLimitMph)))}</i>
        ${escapeHtml(speedLimitSegmentTitle(segment))}
      </span>
    `).join(""),
    '</div>'
  ].join("");
}

function speedLimitSegments(feature) {
  const segments = feature?.properties?.speedLimitSegments;
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment) => ({
      startMileMarker: numberValue(segment.startMileMarker),
      endMileMarker: numberValue(segment.endMileMarker),
      speedLimitMph: numberValue(segment.speedLimitMph),
      description: String(segment.description || "").trim(),
      label: String(segment.label || "").trim()
    }))
    .filter((segment) =>
      Number.isFinite(segment.startMileMarker)
      && Number.isFinite(segment.endMileMarker)
      && Number.isFinite(segment.speedLimitMph)
    );
}

function weightedPostedSpeedLimit(segments) {
  let weighted = 0;
  let total = 0;
  for (const segment of segments) {
    const length = Math.abs(segment.endMileMarker - segment.startMileMarker);
    if (!Number.isFinite(length) || length <= 0) continue;
    weighted += length * segment.speedLimitMph;
    total += length;
  }
  return total > 0 ? weighted / total : Number.NaN;
}

function speedLimitSegmentTitle(segment) {
  const label = segment.label || `${formatMileMarker(segment.startMileMarker)}-${formatMileMarker(segment.endMileMarker)} | ${segment.speedLimitMph} mph`;
  return segment.description ? `${label} | ${segment.description}` : label;
}

function speedLimitBoundaryMarkers(segments) {
  const markers = new Set();
  for (const segment of segments) {
    markers.add(segment.startMileMarker.toFixed(3));
    markers.add(segment.endMileMarker.toFixed(3));
  }
  return [...markers]
    .map((value) => Number(value))
    .sort((a, b) => a - b);
}

function mileMarkerCallout(marker, index, total, x, y, isEndpoint) {
  const text = formatMileMarker(marker);
  const side = isEndpoint || index % 2 === 0 ? "right" : "left";
  return {
    text,
    x: side === "left" ? Math.max(58, x - 28) : Math.min(842, x + 24),
    y: y + (isEndpoint && index === 0 ? -14 : isEndpoint && index === total - 1 ? 22 : -6),
    side,
    flow: "vertical",
    className: isEndpoint ? "mile-marker-label mile-marker-label-end" : "mile-marker-label",
    anchor: side === "left" ? "end" : "start",
    minGap: isEndpoint ? 30 : 24,
    textWidth: estimateCalloutWidth(text, isEndpoint ? "mile-marker-label mile-marker-label-end" : "mile-marker-label")
  };
}

function mileMarkerCalloutHorizontal(marker, index, total, x, y, isEndpoint) {
  const text = formatMileMarker(marker);
  const lanePattern = ["top-near", "bottom-near", "top-far", "bottom-far"];
  const lane = isEndpoint
    ? (index === 0 ? "bottom-end-left" : "bottom-end-right")
    : lanePattern[index % lanePattern.length];
  const laneOffsets = {
    "top-near": -18,
    "bottom-near": 32,
    "top-far": -42,
    "bottom-far": 56,
    "bottom-end-left": 82,
    "bottom-end-right": 82
  };
  const anchor = isEndpoint ? (index === 0 ? "start" : "end") : "middle";
  return {
    text,
    x: isEndpoint
      ? (index === 0 ? Math.max(78, x + 18) : Math.min(822, x - 18))
      : x,
    y: y + (laneOffsets[lane] ?? -6),
    side: lane,
    collisionLane: lane,
    flow: "horizontal",
    className: isEndpoint ? "mile-marker-label mile-marker-label-end" : "mile-marker-label",
    anchor,
    minGap: isEndpoint ? 72 : 58,
    textWidth: estimateCalloutWidth(text, isEndpoint ? "mile-marker-label mile-marker-label-end" : "mile-marker-label")
  };
}

function speedSectionCallout(segment, index, x, y, side) {
  const text = `${Math.round(segment.speedLimitMph)} mph`;
  return {
    text,
    x: side === "left" ? Math.max(64, x - 74) : Math.min(836, x + 74),
    y: y + (index % 2 === 0 ? -4 : 12),
    side,
    flow: "vertical",
    className: "speed-section-label",
    anchor: side === "left" ? "end" : "start",
    minGap: 22,
    leaderFrom: { x, y },
    textWidth: estimateCalloutWidth(text, "speed-section-label")
  };
}

function speedSectionCalloutHorizontal(segment, index, x, y) {
  const text = `${Math.round(segment.speedLimitMph)} mph`;
  const lower = numberValue(segment.startMileMarker) < 218 || numberValue(segment.endMileMarker) > 242;
  const lane = lower ? (index % 2 === 0 ? "bottom-speed-near" : "bottom-speed-far") : (index % 2 === 0 ? "top-speed-near" : "top-speed-far");
  const laneOffsets = {
    "top-speed-near": -24,
    "top-speed-far": -50,
    "bottom-speed-near": 40,
    "bottom-speed-far": 64
  };
  const collisionLane = lane
    .replace("-speed", "");
  return {
    text,
    x,
    y: y + (laneOffsets[lane] ?? 44),
    side: lane,
    collisionLane,
    flow: "horizontal",
    className: "speed-section-label",
    anchor: "middle",
    minGap: 84,
    leaderFrom: { x, y },
    textWidth: estimateCalloutWidth(text, "speed-section-label")
  };
}

function resolveCalloutCollisions(callouts) {
  const resolved = [];
  const groups = new Map();

  for (const callout of callouts) {
    const flow = callout.flow || "vertical";
    const side = callout.collisionLane || callout.side || (flow === "horizontal" ? "mid" : "right");
    const key = `${flow}:${side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(callout);
  }

  for (const [key, group] of groups.entries()) {
    const [flow] = key.split(":");
    resolved.push(...(
      flow === "horizontal"
        ? spreadCalloutsHorizontally(group)
        : spreadCalloutsVertically(group.sort((a, b) => a.y - b.y))
    ));
  }
  return resolved;
}

function spreadCalloutsVertically(callouts) {
  if (callouts.length === 0) return [];
  const minY = 26;
  const maxY = 500;
  const out = callouts.map((callout) => ({
    ...callout,
    y: Math.max(minY, Math.min(maxY, callout.y))
  }));

  for (let i = 1; i < out.length; i += 1) {
    const gap = Math.max(out[i - 1].minGap || 24, out[i].minGap || 24);
    if (out[i].y - out[i - 1].y < gap) {
      out[i].y = out[i - 1].y + gap;
    }
  }

  const overflow = out[out.length - 1].y - maxY;
  if (overflow > 0) {
    out[out.length - 1].y = maxY;
    for (let i = out.length - 2; i >= 0; i -= 1) {
      const gap = Math.max(out[i].minGap || 24, out[i + 1].minGap || 24);
      out[i].y = Math.min(out[i].y, out[i + 1].y - gap);
    }
  }

  for (const callout of out) {
    callout.y = Math.max(minY, Math.min(maxY, callout.y));
  }
  return out;
}

function spreadCalloutsHorizontally(callouts) {
  if (callouts.length === 0) return [];
  const minX = 52;
  const maxX = 848;
  const out = callouts
    .map((callout) => ({
      ...callout,
      x: clampCalloutX(callout, callout.x, minX, maxX)
    }))
    .sort((a, b) => a.x - b.x);

  for (let i = 1; i < out.length; i += 1) {
    const gap = Math.max(out[i - 1].minGap || 36, out[i].minGap || 36);
    const overlap = (calloutRightEdge(out[i - 1]) + gap) - calloutLeftEdge(out[i]);
    if (overlap > 0) {
      out[i].x = clampCalloutX(out[i], out[i].x + overlap, minX, maxX);
    }
  }

  const overflow = calloutRightEdge(out[out.length - 1]) - maxX;
  if (overflow > 0) {
    out[out.length - 1].x = clampCalloutX(out[out.length - 1], out[out.length - 1].x - overflow, minX, maxX);
    for (let i = out.length - 2; i >= 0; i -= 1) {
      const gap = Math.max(out[i].minGap || 36, out[i + 1].minGap || 36);
      const overlap = (calloutRightEdge(out[i]) + gap) - calloutLeftEdge(out[i + 1]);
      if (overlap > 0) {
        out[i].x = clampCalloutX(out[i], out[i].x - overlap, minX, maxX);
      }
    }
  }

  return out;
}

function routeLabelLayoutMode(points, bounds) {
  if (!Array.isArray(points) || points.length < 2) return "vertical";
  const projected = points.map((point) => projectPoint(point, bounds));
  const xs = projected.map((point) => point[0]);
  const ys = projected.map((point) => point[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  return spanX >= spanY * 1.55 ? "horizontal" : "vertical";
}

function estimateCalloutWidth(text, className) {
  const chars = Math.max(1, String(text || "").length);
  const unit = String(className || "").includes("map-annotation")
    ? 10.8
    : String(className || "").includes("mile-marker")
      ? 9.9
      : 8.8;
  return Math.max(38, chars * unit);
}

function calloutLeftEdge(callout) {
  const width = callout.textWidth || estimateCalloutWidth(callout.text, callout.className);
  if (callout.anchor === "end") return callout.x - width;
  if (callout.anchor === "middle") return callout.x - (width / 2);
  return callout.x;
}

function calloutRightEdge(callout) {
  const width = callout.textWidth || estimateCalloutWidth(callout.text, callout.className);
  if (callout.anchor === "end") return callout.x;
  if (callout.anchor === "middle") return callout.x + (width / 2);
  return callout.x + width;
}

function clampCalloutX(callout, x, minX, maxX) {
  const width = callout.textWidth || estimateCalloutWidth(callout.text, callout.className);
  if (callout.anchor === "end") return Math.max(minX + width, Math.min(maxX, x));
  if (callout.anchor === "middle") return Math.max(minX + (width / 2), Math.min(maxX - (width / 2), x));
  return Math.max(minX, Math.min(maxX - width, x));
}

function nearlyEqual(a, b) {
  return Number.isFinite(numberValue(a)) && Number.isFinite(numberValue(b))
    && Math.abs(numberValue(a) - numberValue(b)) < 0.001;
}

function routeSliceForMileMarkers(points, routeStartMarker, routeEndMarker, segmentStartMarker, segmentEndMarker) {
  const startT = mileMarkerFraction(routeStartMarker, routeEndMarker, segmentStartMarker);
  const endT = mileMarkerFraction(routeStartMarker, routeEndMarker, segmentEndMarker);
  if (!Number.isFinite(startT) || !Number.isFinite(endT)) return [];
  const from = Math.max(0, Math.min(1, Math.min(startT, endT)));
  const to = Math.max(0, Math.min(1, Math.max(startT, endT)));
  if (to <= from) return [];
  return routeSliceByFraction(points, from, to);
}

function pointForMileMarker(points, routeStartMarker, routeEndMarker, mileMarker) {
  const fraction = mileMarkerFraction(routeStartMarker, routeEndMarker, mileMarker);
  if (!Number.isFinite(fraction)) return null;
  return pointAtRouteFraction(points, Math.max(0, Math.min(1, fraction)));
}

function mileMarkerFraction(routeStartMarker, routeEndMarker, mileMarker) {
  const start = numberValue(routeStartMarker);
  const end = numberValue(routeEndMarker);
  const marker = numberValue(mileMarker);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(marker) || start === end) {
    return Number.NaN;
  }
  return (marker - start) / (end - start);
}

function routeSliceByFraction(points, from, to) {
  const cumulative = routeCumulativeDistances(points);
  const total = cumulative[cumulative.length - 1] || 0;
  if (points.length < 2 || total <= 0) return [];

  const fromDistance = total * from;
  const toDistance = total * to;
  const out = [pointAtDistance(points, cumulative, fromDistance)];
  for (let i = 1; i < points.length - 1; i += 1) {
    if (cumulative[i] > fromDistance && cumulative[i] < toDistance) {
      out.push(points[i]);
    }
  }
  out.push(pointAtDistance(points, cumulative, toDistance));
  return out;
}

function pointAtRouteFraction(points, fraction) {
  const cumulative = routeCumulativeDistances(points);
  const total = cumulative[cumulative.length - 1] || 0;
  if (points.length === 0 || total <= 0) return null;
  return pointAtDistance(points, cumulative, total * fraction);
}

function pointAtDistance(points, cumulative, targetDistance) {
  if (targetDistance <= 0) return points[0];
  const total = cumulative[cumulative.length - 1] || 0;
  if (targetDistance >= total) return points[points.length - 1];

  for (let i = 0; i < cumulative.length - 1; i += 1) {
    const startDistance = cumulative[i];
    const endDistance = cumulative[i + 1];
    if (targetDistance >= startDistance && targetDistance <= endDistance) {
      const span = Math.max(0.000001, endDistance - startDistance);
      const t = (targetDistance - startDistance) / span;
      return [
        points[i][0] + ((points[i + 1][0] - points[i][0]) * t),
        points[i][1] + ((points[i + 1][1] - points[i][1]) * t)
      ];
    }
  }
  return points[points.length - 1];
}

function routeCumulativeDistances(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  return cumulative;
}

function haversineMeters(a, b) {
  const radiusMeters = 6_371_000;
  const lat1 = degreesToRadians(numberValue(a[1], 0));
  const lat2 = degreesToRadians(numberValue(b[1], 0));
  const dLat = lat2 - lat1;
  const dLon = degreesToRadians(numberValue(b[0], 0) - numberValue(a[0], 0));
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLon / 2) ** 2);
  return 2 * radiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function drawChart(canvas, datasets, options = {}) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { top: 24, right: 20, bottom: 34, left: 44 };
  const drawWidth = width - pad.left - pad.right;
  const drawHeight = height - pad.top - pad.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfdfd";
  ctx.fillRect(0, 0, width, height);

  const allPoints = datasets.flatMap((dataset) => dataset.points).filter((point) => Number.isFinite(point.y));
  if (allPoints.length === 0) {
    ctx.fillStyle = "#4e5d6c";
    ctx.font = '15px "Avenir Next", "Trebuchet MS", sans-serif';
    ctx.fillText("Not enough data points.", 24, 40);
    return;
  }

  let minY = Math.min(...allPoints.map((point) => point.y));
  let maxY = Math.max(...allPoints.map((point) => point.y));
  if (Math.abs(maxY - minY) < 1.0) {
    maxY += 1.0;
    minY -= 1.0;
  }
  const span = maxY - minY;
  minY -= span * 0.1;
  maxY += span * 0.1;

  ctx.strokeStyle = "#dbe4e2";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (drawHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#4e5d6c";
  ctx.font = '12px "Avenir Next", "Trebuchet MS", sans-serif';
  const yTickValues = [];
  for (let i = 0; i <= 4; i += 1) {
    yTickValues.push(maxY - ((maxY - minY) * i) / 4);
  }
  const yTickLabels = formatChartTickLabels(yTickValues);
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (drawHeight * i) / 4;
    ctx.fillText(yTickLabels[i], 8, y + 4);
  }

  datasets.forEach((dataset) => {
    const points = dataset.points.filter((point) => Number.isFinite(point.y));
    if (points.length === 0) return;
    ctx.strokeStyle = dataset.color;
    ctx.lineWidth = 2.4;
    if (points.length === 1) {
      const x = pad.left + drawWidth / 2;
      const y = pad.top + ((maxY - points[0].y) / (maxY - minY)) * drawHeight;
      ctx.fillStyle = dataset.color;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = pad.left + (drawWidth * index) / (points.length - 1);
      const y = pad.top + ((maxY - point.y) / (maxY - minY)) * drawHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });

  const labels = datasets[0].points;
  if (labels.length === 1) {
    ctx.fillStyle = "#4e5d6c";
    ctx.textAlign = "center";
    ctx.fillText(labels[0].xLabel || "", pad.left + drawWidth / 2, height - 12);
    ctx.textAlign = "left";
  } else if (labels.length >= 2) {
    const first = labels[0].xLabel || "";
    const mid = labels[Math.floor(labels.length / 2)].xLabel || "";
    const last = labels[labels.length - 1].xLabel || "";
    ctx.fillStyle = "#4e5d6c";
    ctx.textAlign = "left";
    ctx.fillText(first, pad.left, height - 12);
    ctx.textAlign = "center";
    ctx.fillText(mid, pad.left + drawWidth / 2, height - 12);
    ctx.textAlign = "right";
    ctx.fillText(last, width - pad.right, height - 12);
    ctx.textAlign = "left";
  }

  if (options.yLabel) {
    ctx.fillStyle = "#4e5d6c";
    ctx.fillText(options.yLabel, 8, 14);
  }
}

function formatChartTickLabels(values) {
  const ticks = Array.isArray(values) ? values.filter((value) => Number.isFinite(value)) : [];
  if (ticks.length === 0) return [];

  for (let decimals = 0; decimals <= 2; decimals += 1) {
    const labels = ticks.map((value) => value.toFixed(decimals));
    if (new Set(labels).size === labels.length) {
      return labels;
    }
  }

  return ticks.map((value) => value.toFixed(2));
}

function drawHistoryScatterTrendChart(canvas, samplePoints, averagePoints, predictionPoints, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { top: 24, right: 20, bottom: 34, left: 44 };
  const drawWidth = width - pad.left - pad.right;
  const drawHeight = height - pad.top - pad.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfdfd";
  ctx.fillRect(0, 0, width, height);

  const samples = Array.isArray(samplePoints) ? samplePoints.filter(isFiniteChartPoint) : [];
  const averages = Array.isArray(averagePoints) ? averagePoints.filter(isFiniteChartPoint) : [];
  const predictions = Array.isArray(predictionPoints) ? predictionPoints.filter(isFiniteChartPoint) : [];
  const allPoints = [...samples, ...averages, ...predictions];
  if (allPoints.length === 0) {
    ctx.fillStyle = "#4e5d6c";
    ctx.font = '15px "Avenir Next", "Trebuchet MS", sans-serif';
    ctx.fillText("Not enough data points.", 24, 40);
    return;
  }

  let minY = Math.min(...allPoints.map((point) => point.y));
  let maxY = Math.max(...allPoints.map((point) => point.y));
  if (Math.abs(maxY - minY) < 1.0) {
    maxY += 1.0;
    minY -= 1.0;
  }
  const span = maxY - minY;
  minY -= span * 0.12;
  maxY += span * 0.12;

  const minTimestamp = Math.min(...allPoints.map((point) => point.timestamp));
  const maxTimestamp = Math.max(...allPoints.map((point) => point.timestamp));
  const timestampSpan = Math.max(60_000, maxTimestamp - minTimestamp);
  const xForTimestamp = (timestamp) => pad.left + ((timestamp - minTimestamp) / timestampSpan) * drawWidth;
  const yForValue = (value) => pad.top + ((maxY - value) / (maxY - minY)) * drawHeight;

  ctx.strokeStyle = "#dbe4e2";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (drawHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  const yTickValues = [];
  for (let i = 0; i <= 4; i += 1) {
    yTickValues.push(maxY - ((maxY - minY) * i) / 4);
  }
  const yTickLabels = formatChartTickLabels(yTickValues);
  ctx.fillStyle = "#4e5d6c";
  ctx.font = '12px "Avenir Next", "Trebuchet MS", sans-serif';
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (drawHeight * i) / 4;
    ctx.fillText(yTickLabels[i], 8, y + 4);
  }

  if (predictions.length > 0 && samples.length > 0) {
    const lastObserved = samples[samples.length - 1];
    const splitX = xForTimestamp(lastObserved.timestamp);
    ctx.strokeStyle = "rgba(86, 101, 95, 0.18)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(splitX, pad.top);
    ctx.lineTo(splitX, height - pad.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (averages.length > 0) {
    drawTimedLine(ctx, averages, xForTimestamp, yForValue, {
      strokeStyle: "#0a5f57",
      lineWidth: 2.6
    });
  }

  if (predictions.length > 0) {
    const predictedPath = samples.length > 0
      ? [{ ...samples[samples.length - 1] }, ...predictions]
      : predictions;
    drawTimedLine(ctx, predictedPath, xForTimestamp, yForValue, {
      strokeStyle: "#285ea8",
      lineWidth: 2.2,
      lineDash: [7, 5]
    });
  }

  ctx.fillStyle = "rgba(15, 118, 110, 0.24)";
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 1.1;
  for (const point of samples) {
    const x = xForTimestamp(point.timestamp);
    const y = yForValue(point.y);
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  drawHistoryLegend(ctx, width, pad);
  drawHistoryXAxisLabels(ctx, samples, predictions, xForTimestamp, width, height, pad);

  if (options.yLabel) {
    ctx.fillStyle = "#4e5d6c";
    ctx.textAlign = "left";
    ctx.fillText(options.yLabel, 8, 14);
  }
}

function drawTimedLine(ctx, points, xForTimestamp, yForValue, options = {}) {
  const rows = Array.isArray(points) ? points.filter(isFiniteChartPoint) : [];
  if (rows.length === 0) return;
  ctx.save();
  ctx.strokeStyle = options.strokeStyle || "#0f766e";
  ctx.lineWidth = options.lineWidth || 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (Array.isArray(options.lineDash) && options.lineDash.length > 0) {
    ctx.setLineDash(options.lineDash);
  }
  ctx.beginPath();
  rows.forEach((point, index) => {
    const x = xForTimestamp(point.timestamp);
    const y = yForValue(point.y);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawHistoryLegend(ctx, width, pad) {
  const items = [
    { label: "Samples", color: "#0f766e", mode: "dot" },
    { label: "Average", color: "#0a5f57", mode: "line" },
    { label: "Predicted", color: "#285ea8", mode: "dash" }
  ];
  let x = width - pad.right - 248;
  const y = 16;

  ctx.save();
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillStyle = "#56655f";
  ctx.strokeStyle = "#56655f";
  ctx.lineWidth = 1.6;

  items.forEach((item) => {
    if (item.mode === "dot") {
      ctx.beginPath();
      ctx.fillStyle = "rgba(15, 118, 110, 0.24)";
      ctx.arc(x + 6, y + 2, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = item.color;
      ctx.stroke();
      ctx.fillStyle = "#56655f";
    } else {
      ctx.save();
      ctx.strokeStyle = item.color;
      if (item.mode === "dash") {
        ctx.setLineDash([7, 5]);
      }
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x + 14, y + 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillText(item.label, x + 20, y + 6);
    x += 78;
  });
  ctx.restore();
}

function drawHistoryXAxisLabels(ctx, samples, predictions, xForTimestamp, width, height, pad) {
  const labels = [];
  if (samples.length === 1) {
    labels.push({ text: samples[0].xLabel || "", x: xForTimestamp(samples[0].timestamp), align: "center" });
  } else if (samples.length >= 2) {
    labels.push({ text: samples[0].xLabel || "", x: pad.left, align: "left" });
    const lastObserved = samples[samples.length - 1];
    if (predictions.length > 0) {
      labels.push({ text: lastObserved.xLabel || "", x: xForTimestamp(lastObserved.timestamp), align: "center" });
      const lastPredicted = predictions[predictions.length - 1];
      labels.push({ text: lastPredicted.xLabel || "", x: width - pad.right, align: "right" });
    } else {
      labels.push({ text: samples[Math.floor(samples.length / 2)].xLabel || "", x: pad.left + ((width - pad.left - pad.right) / 2), align: "center" });
      labels.push({ text: lastObserved.xLabel || "", x: width - pad.right, align: "right" });
    }
  } else if (predictions.length > 0) {
    labels.push({ text: predictions[0].xLabel || "", x: pad.left, align: "left" });
    labels.push({ text: predictions[predictions.length - 1].xLabel || "", x: width - pad.right, align: "right" });
  }

  ctx.save();
  ctx.fillStyle = "#4e5d6c";
  ctx.font = '12px "Avenir Next", "Trebuchet MS", sans-serif';
  labels.forEach((label) => {
    ctx.textAlign = label.align;
    ctx.fillText(label.text, label.x, height - 12);
  });
  ctx.textAlign = "left";
  ctx.restore();
}

function buildRollingAverageSeries(points) {
  const rows = Array.isArray(points) ? points.filter(isFiniteChartPoint) : [];
  if (rows.length === 0) return [];
  const radius = Math.max(1, Math.min(4, Math.floor(rows.length / 18)));
  return rows.map((point, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(rows.length - 1, index + radius);
    const window = rows.slice(start, end + 1);
    const average = window.reduce((sum, row) => sum + row.y, 0) / window.length;
    return {
      y: average,
      timestamp: point.timestamp,
      xLabel: point.xLabel
    };
  });
}

function isFiniteChartPoint(point) {
  return Number.isFinite(numberValue(point?.y)) && Number.isFinite(numberValue(point?.timestamp));
}

function parseTimestampMillis(timestamp) {
  if (!timestamp) return Number.NaN;
  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? millis : Number.NaN;
}

function bindIncidentTooltip(circle, feature, x, y) {
  const show = () => showMapTooltip(feature, x, y);
  const hide = () => hideMapTooltip();

  circle.addEventListener("pointerenter", show);
  circle.addEventListener("focus", show);
  circle.addEventListener("click", show);
  circle.addEventListener("pointerleave", hide);
  circle.addEventListener("blur", hide);
}

function showMapTooltip(feature, x, y) {
  if (!mapTooltip) {
    return;
  }

  const props = feature?.properties || {};
  const heading = props.incidentDisplayLabel || props.referenceLabel || props.locationLabel || "Incident";
  const subtitle = [props.corridor || props.roadNumber, props.travelDirectionLabel || longDirectionLabel(props.travelDirection)]
    .filter(Boolean)
    .join(" | ");
  const items = [
    ["Type", props.incidentTypeLabel || formatIncidentType(props.iconCategory)],
    ["Description", props.incidentDescription || props.incidentTypeLabel || formatIncidentType(props.iconCategory)],
    ["Delay", formatSeconds(props.delaySeconds)],
    ["Last Seen", formatDateTime(props.polledAt)],
    ["Direction", props.travelDirectionLabel || longDirectionLabel(props.travelDirection) || "-"],
    ["Mile Marker", formatMileMarker(props.closestMileMarker)],
    ["Placement", formatMethodLabel(props.mileMarkerMethod)],
    ["Confidence", formatConfidence(props.mileMarkerConfidence)],
    ["Snap Distance", formatMeters(props.distanceToCorridorMeters)],
    ["Map Point", formatMapPointSource(props.displayGeometrySource, props.displaySnapDistanceMeters)],
    ["Location", props.locationLabel || "-"]
  ];

  mapTooltip.innerHTML = [
    `<p class="map-tooltip-title">${escapeHtml(heading)}</p>`,
    subtitle ? `<p class="map-tooltip-subtitle">${escapeHtml(subtitle)}</p>` : "",
    `<div class="map-tooltip-grid">${items.map(([label, value]) => `
      <div class="map-tooltip-item">
        <span class="map-tooltip-label">${escapeHtml(label)}</span>
        <span class="map-tooltip-value">${escapeHtml(value)}</span>
      </div>
    `).join("")}</div>`
  ].join("");

  mapTooltip.classList.remove("hidden");
  positionMapTooltip(x, y);
}

function positionMapTooltip(x, y) {
  if (!mapTooltip || mapTooltip.classList.contains("hidden")) {
    return;
  }

  const mapBounds = corridorMap.getBoundingClientRect();
  const tooltipWidth = mapTooltip.offsetWidth || 260;
  const mapWidth = mapBounds.width || corridorMap.clientWidth || 900;
  const mapHeight = mapBounds.height || corridorMap.clientHeight || 520;
  const scaleX = mapWidth / 900;
  const scaleY = mapHeight / 520;
  const leftPadding = tooltipWidth / 2 + 12;
  const rightPadding = mapWidth - tooltipWidth / 2 - 12;
  const left = Math.max(leftPadding, Math.min(rightPadding, x * scaleX));
  const top = Math.max(72, y * scaleY);

  mapTooltip.style.left = `${left}px`;
  mapTooltip.style.top = `${top}px`;
}

function hideMapTooltip() {
  if (!mapTooltip) {
    return;
  }
  mapTooltip.classList.add("hidden");
}

function buildIncidentAriaLabel(feature) {
  const props = feature?.properties || {};
  const parts = [
    props.incidentDisplayLabel || props.referenceLabel || props.locationLabel || "Incident",
    props.incidentTypeLabel || formatIncidentType(props.iconCategory),
    props.travelDirectionLabel || longDirectionLabel(props.travelDirection),
    formatDelaySummary(props.delaySeconds, props.delaySeconds),
    props.isOffCorridor ? "off corridor" : props.isApproximateLocation ? "approximate location" : null,
    formatDateTime(props.polledAt)
  ].filter(Boolean);
  return parts.join(", ");
}

function incidentFillColor(delaySeconds, isApproximateLocation, isOffCorridor) {
  if (isOffCorridor) {
    return "#64748b";
  }
  if (isApproximateLocation) {
    return "#d97706";
  }
  return delaySeconds >= 600 ? "#ad2f2f" : "#db6c3f";
}

function incidentStrokeColor(isApproximateLocation, isOffCorridor) {
  if (isOffCorridor) {
    return "#0f172a";
  }
  if (isApproximateLocation) {
    return "#fff7ed";
  }
  return "#ffffff";
}

function aggregateIncidentReferences(features) {
  const groups = new Map();

  for (const feature of features) {
    const props = feature?.properties || {};
    const key = incidentAggregationKey(feature);
    const polledAt = props.polledAt || null;
    const delaySeconds = numberValue(props.delaySeconds, 0);
    const label = props.incidentDisplayLabel || props.referenceLabel || props.locationLabel || buildIncidentFallbackLabel(props);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        label,
        observationCount: 1,
        maxDelaySeconds: Number.isFinite(delaySeconds) ? delaySeconds : null,
        firstSeenAt: polledAt,
        lastSeenAt: polledAt
      });
      continue;
    }

    existing.observationCount += 1;
    existing.maxDelaySeconds = maxFinite(existing.maxDelaySeconds, delaySeconds);
    if (!existing.firstSeenAt || new Date(polledAt) < new Date(existing.firstSeenAt)) {
      existing.firstSeenAt = polledAt;
    }
    if (!existing.lastSeenAt || new Date(polledAt) > new Date(existing.lastSeenAt)) {
      existing.lastSeenAt = polledAt;
    }
  }

  return [...groups.values()].sort((left, right) => {
    const timeDiff = new Date(right.lastSeenAt || 0).getTime() - new Date(left.lastSeenAt || 0).getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return right.observationCount - left.observationCount;
  });
}

function incidentAggregationKey(feature) {
  const props = feature?.properties || {};
  return [
    String(props.corridor || ""),
    String(props.travelDirection || ""),
    String(props.referenceKey || props.referenceLabel || props.locationLabel || ""),
    geometrySignature(feature?.geometry)
  ].join("|");
}

function geometrySignature(geometry) {
  const points = geometryPoints(geometry);
  if (points.length === 0) {
    return "no-geometry";
  }
  return points
    .slice(0, 6)
    .map((point) => point.map((value) => numberValue(value, 0).toFixed(4)).join(","))
    .join(";");
}

function buildIncidentFallbackLabel(props) {
  const corridor = props.roadNumber || props.corridor || "Incident";
  const direction = props.travelDirectionLabel || longDirectionLabel(props.travelDirection);
  return [corridor, direction].filter(Boolean).join(" ");
}

function formatHotspotReferenceLabel(row) {
  const label = row?.referenceLabel || row?.corridor || "Hotspot";
  return row?.mileMarkerBand == null ? `${label} (approximate)` : label;
}

function formatDelaySummary(avgDelaySeconds, maxDelaySeconds) {
  const avg = numberValue(avgDelaySeconds);
  const max = numberValue(maxDelaySeconds);
  if ((Number.isFinite(avg) && avg <= 0) && (Number.isFinite(max) && max <= 0)) {
    return "delay unavailable";
  }
  if (Number.isFinite(avg) && Number.isFinite(max)) {
    return `avg delay ${formatSeconds(avg)}, max ${formatSeconds(max)}`;
  }
  if (Number.isFinite(max)) {
    return `peak delay ${formatSeconds(max)}`;
  }
  return "delay unavailable";
}

function formatPeakDelaySummary(maxDelaySeconds) {
  const max = numberValue(maxDelaySeconds);
  return Number.isFinite(max) ? `peak delay ${formatSeconds(max)}` : "delay unavailable";
}

function formatObservationTiming(firstSeenAt, lastSeenAt) {
  if (firstSeenAt && lastSeenAt) {
    const spanMinutes = Math.max(0, Math.round((new Date(lastSeenAt).getTime() - new Date(firstSeenAt).getTime()) / 60000));
    if (spanMinutes < 1) {
      return `seen ${formatDateTime(lastSeenAt)}`;
    }
    return `active ${formatDurationMinutes(spanMinutes)} | last ${formatDateTime(lastSeenAt)}`;
  }
  if (lastSeenAt) {
    return `last ${formatDateTime(lastSeenAt)}`;
  }
  if (firstSeenAt) {
    return `first ${formatDateTime(firstSeenAt)}`;
  }
  return "timing unavailable";
}

function formatDurationMinutes(totalMinutes) {
  const rounded = Math.max(0, Math.round(numberValue(totalMinutes, 0)));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes}m`;
}

function maxFinite(left, right) {
  const normalizedLeft = numberValue(left);
  const normalizedRight = numberValue(right);
  if (Number.isFinite(normalizedLeft) && Number.isFinite(normalizedRight)) {
    return Math.max(normalizedLeft, normalizedRight);
  }
  if (Number.isFinite(normalizedLeft)) {
    return normalizedLeft;
  }
  if (Number.isFinite(normalizedRight)) {
    return normalizedRight;
  }
  return null;
}

function formatMethodLabel(method) {
  const normalized = String(method || "").trim().toLowerCase();
  switch (normalized) {
    case "anchor_interpolated":
      return "anchor interpolated";
    case "range_interpolated":
      return "range interpolated";
    case "direction_only":
      return "direction only";
    case "off_corridor":
      return "off corridor";
    case "unresolved":
      return "unresolved";
    case "none":
      return "no dominant method";
    default:
      return method || "-";
  }
}

function formatConfidence(value) {
  const numeric = numberValue(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : "-";
}

function formatMeters(value) {
  const numeric = numberValue(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)} m` : "-";
}

function formatMapPointSource(source, snapDistanceMeters) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "corridor_snapped") {
    const distance = formatMeters(snapDistanceMeters);
    return distance === "-" ? "snapped to corridor" : `snapped to corridor (${distance})`;
  }
  if (normalized === "centroid") return "provider centroid";
  if (normalized === "provider_center") return "provider geometry center";
  if (normalized === "provider_geometry") return "provider geometry";
  return "-";
}

function formatPercent(value) {
  const numeric = numberValue(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : "-";
}

async function fetchJson(path) {
  const response = await fetch(path);

  if (response.status === 401 || response.status === 403) {
    throw new Error("Dashboard data is unavailable. Check dashboard public data settings.");
  }
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#8d1f1f" : "#4e5d6c";
}

function numberValue(value, fallback = Number.NaN) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatSpeed(value) {
  if (!Number.isFinite(numberValue(value))) return "-";
  return `${numberValue(value).toFixed(1)} mph`;
}

function formatSignedSpeedDelta(value) {
  const delta = numberValue(value);
  if (!Number.isFinite(delta)) return "-";
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} mph`;
}

function formatCount(value) {
  if (!Number.isFinite(numberValue(value))) return "-";
  return String(Math.round(numberValue(value)));
}

function formatSeconds(value) {
  if (!Number.isFinite(numberValue(value))) return "-";
  const seconds = numberValue(value);
  const minutes = seconds / 60;
  return `${minutes.toFixed(minutes >= 10 ? 0 : 1)} min`;
}

function formatMileMarker(value) {
  const marker = numberValue(value);
  if (!Number.isFinite(marker)) return "-";
  return `MM ${marker.toFixed(1)}`;
}

function longDirectionLabel(direction) {
  const normalized = String(direction || "").trim().toUpperCase();
  if (!normalized) return "";
  return {
    N: "northbound",
    S: "southbound",
    E: "eastbound",
    W: "westbound"
  }[normalized] || normalized;
}

function formatIncidentType(iconCategory) {
  const code = Math.round(numberValue(iconCategory));
  if (!Number.isFinite(code)) return "-";
  const knownTypes = {
    0: "Unknown",
    1: "Accident",
    2: "Fog",
    3: "Dangerous conditions",
    4: "Rain",
    5: "Ice",
    6: "Traffic jam",
    7: "Lane closed",
    8: "Road closed",
    9: "Road works",
    10: "Wind",
    11: "Flooding",
    13: "Incident cluster",
    14: "Broken down vehicle"
  };
  return knownTypes[code] ? `${knownTypes[code]} (code ${code})` : `Type code ${code}`;
}

function renderIncidentLegend() {
  if (!incidentLegendGrid) {
    return;
  }

  incidentLegendGrid.innerHTML = INCIDENT_CATEGORY_LEGEND
    .map(([code, label]) => `
      <div class="incident-legend-item">
        <span class="incident-legend-code">${escapeHtml(code)}</span>
        <span class="incident-legend-label">${escapeHtml(label)}</span>
      </div>
    `)
    .join("");
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatShortDate(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatShortDateTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ageMinutes(timestamp) {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

function formatAgeMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "unknown age";
  if (minutes < 60) return `${minutes} min old`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h old` : `${hours}h ${remainingMinutes}m old`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseJson(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}
