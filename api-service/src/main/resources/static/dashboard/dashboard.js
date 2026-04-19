const corridorSelect = document.getElementById("corridorSelect");
const refreshBtn = document.getElementById("refreshBtn");
const statusText = document.getElementById("statusText");
const qualityNotes = document.getElementById("qualityNotes");
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
const operationsMeta = document.getElementById("operationsMeta");
const opsDeltaValue = document.getElementById("opsDeltaValue");
const opsDeltaMeta = document.getElementById("opsDeltaMeta");
const opsFreshnessValue = document.getElementById("opsFreshnessValue");
const opsFreshnessMeta = document.getElementById("opsFreshnessMeta");
const opsHotspotValue = document.getElementById("opsHotspotValue");
const opsHotspotMeta = document.getElementById("opsHotspotMeta");
const opsCoverageValue = document.getElementById("opsCoverageValue");
const opsCoverageMeta = document.getElementById("opsCoverageMeta");

const historyMeta = document.getElementById("historyMeta");
const trendMeta = document.getElementById("trendMeta");
const forecastMeta = document.getElementById("forecastMeta");
const mapMeta = document.getElementById("mapMeta");
const mapLegend = document.getElementById("mapLegend");
const summaryMeta = document.getElementById("summaryMeta");
const hotspotMeta = document.getElementById("hotspotMeta");
const incidentMeta = document.getElementById("incidentMeta");
const markerAssessmentMeta = document.getElementById("markerAssessmentMeta");

const summaryStats = document.getElementById("summaryStats");
const anomalyList = document.getElementById("anomalyList");
const hotspotList = document.getElementById("hotspotList");
const incidentList = document.getElementById("incidentList");
const markerAssessmentList = document.getElementById("markerAssessmentList");
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
const STALE_SAMPLE_MINUTES = 180;
const PROVIDER_GUARD_NOTIFICATION_KEY = "cttd-provider-guard-notification";

const svgNs = "http://www.w3.org/2000/svg";
let refreshTimer = null;
let refreshInFlight = false;

refreshBtn.addEventListener("click", refreshDashboard);
corridorSelect.addEventListener("change", refreshDashboard);

init();

async function init() {
  setStatus("Loading local traffic data...");
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
    const [dashboardSummary, history, usableHistory, anomalies, forecast, mapCorridors, mapIncidents, analyticsTrend, analyticsHotspots, mileMarkerCoverage] =
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
        ),
        fetchJson(
          `/dashboard-api/traffic/analytics/mile-marker-coverage?windowHours=${HOTSPOT_WINDOW_HOURS}`
        )
      ]);

    const providerStatus = dashboardSummary?.providerStatus || null;
    const latest = dashboardSummary?.latest || null;
    applyProviderGuardStatus(providerStatus);

    const latestHasSpeedData = renderLatest(dashboardSummary);
    renderOperations(dashboardSummary, mileMarkerCoverage, corridor);
    renderHistory(history, usableHistory);
    renderTrend(analyticsTrend);
    renderAnomalies(anomalies);
    renderForecast(forecast);
    renderSummary(dashboardSummary);
    renderHotspots(analyticsHotspots, dashboardSummary?.topHotspot || null);
    renderDataQualityNotes(dashboardSummary, mapIncidents, mileMarkerCoverage, corridor);
    renderIncidentReferences(mapIncidents);
    renderMileMarkerAssessment(mileMarkerCoverage, corridor);
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
  const shouldWarn = Boolean(status?.halted) || state === "DEGRADED" || stale;

  if (!shouldWarn) {
    systemWarning.classList.add("hidden");
    document.body.classList.remove("system-halted");
    setControlsLocked(false);
    clearProviderGuardNotificationMarker();
    startAutoRefresh();
    return;
  }

  const halted = Boolean(status?.halted);
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

function renderDataQualityNotes(summary, incidentsCollection, mileMarkerCoverage, corridor) {
  if (!qualityNotes) {
    return;
  }

  const notes = new Set(Array.isArray(summary?.notes) ? summary.notes : []);
  const incidentFeatures = Array.isArray(incidentsCollection?.features) ? incidentsCollection.features : [];
  const missingMileMarkers = incidentFeatures.filter(
    (feature) => !Number.isFinite(numberValue(feature?.properties?.closestMileMarker))
  ).length;
  const providerStatus = summary?.providerStatus || null;
  const providerDetails = parseJson(providerStatus?.detailsJson);
  const assessment = mileMarkerAssessmentForCorridor(mileMarkerCoverage, corridor);

  if (missingMileMarkers > 0 && incidentFeatures.length > 0 && !Array.from(notes).some((note) => note.includes("mile marker"))) {
    if (missingMileMarkers === incidentFeatures.length) {
      notes.add("Current incident observations do not include mile markers, so references fall back to corridor, direction, and location text.");
    } else {
      notes.add(`${missingMileMarkers} of ${incidentFeatures.length} current incident observations are missing mile markers, so some references are approximate.`);
    }
  }
  if (String(providerStatus?.failureCode || "").toUpperCase() === "STALE_PAYLOAD_WARNING") {
    const repeatedCycles = Math.max(
      numberValue(providerStatus?.consecutiveStaleCycles, 0),
      numberValue(providerDetails?.consecutiveStaleCycles, 0)
    );
    notes.add(`Provider guard has seen the same usable payload repeat across ${Math.round(repeatedCycles)} consecutive cycles. Live ingest is still running, but upstream freshness should be checked.`);
  }
  if (assessment) {
    if (numberValue(assessment.resolvedRatePercent) < 70 && numberValue(assessment.recentIncidentCount) >= 5) {
      notes.add(`Only ${formatPercent(assessment.resolvedRatePercent)} of ${formatCount(assessment.recentIncidentCount)} recent incidents have resolved mile markers in the ${HOTSPOT_WINDOW_HOURS}h calibration window.`);
    }
    if (numberValue(assessment.offCorridorCount) > 0) {
      notes.add(`${formatCount(assessment.offCorridorCount)} recent incidents projected off the corridor line, which usually points to stale incident geometry or an imprecise route shape.`);
    }
  }

  qualityNotes.innerHTML = "";
  qualityNotes.classList.toggle("hidden", notes.size === 0);
  for (const note of notes) {
    const li = document.createElement("li");
    li.textContent = note;
    qualityNotes.appendChild(li);
  }
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

function renderOperations(summary, mileMarkerCoverage, corridor) {
  const latest = summary?.latest || {};
  const corridorSummary = summary?.corridorSummary || {};
  const providerStatus = summary?.providerStatus || {};
  const topHotspot = summary?.topHotspot || null;
  const assessment = mileMarkerAssessmentForCorridor(mileMarkerCoverage, corridor);
  const current = numberValue(latest.avgCurrentSpeed);
  const windowAverage = numberValue(corridorSummary.avgCurrentSpeed);
  const speedDelta = numberValue(summary?.speedDeltaFromWindowAverage);
  const sampleAgeMinutes = numberValue(summary?.sampleAgeMinutes, ageMinutes(latest?.polledAt));
  const recentObservationCount = Math.max(0, Math.round(numberValue(summary?.recentIncidentObservationCount, 0)));
  const recentMissingMileMarkers = Math.max(0, Math.round(numberValue(summary?.recentMissingMileMarkerCount, 0)));
  const recentResolvedMileMarkers = Math.max(0, recentObservationCount - recentMissingMileMarkers);
  const recentReferenceCount = Math.max(0, Math.round(numberValue(summary?.recentIncidentReferenceCount, 0)));
  const sourceMode = String(latest?.sourceMode || "").trim().toLowerCase();

  operationsMeta.textContent = `${numberValue(summary?.summaryWindowHours, HOTSPOT_WINDOW_HOURS)}h rolling window | ${Math.round(numberValue(summary?.recentIncidentWindowMinutes, MAP_WINDOW_MINUTES) / 60)}h incident sweep`;

  opsDeltaValue.textContent = Number.isFinite(speedDelta)
    ? formatSignedSpeedDelta(speedDelta)
    : formatSpeed(current);
  opsDeltaMeta.textContent = Number.isFinite(speedDelta) && Number.isFinite(windowAverage)
    ? `Current ${formatSpeed(current)} against rolling average ${formatSpeed(windowAverage)}.`
    : "Rolling speed delta will appear once corridor analytics are available.";

  opsFreshnessValue.textContent = formatAgeMinutes(sampleAgeMinutes);
  opsFreshnessMeta.textContent = [
    latest?.polledAt ? `Latest sample ${formatDateTime(latest.polledAt)}` : "Latest sample time unavailable",
    sourceMode ? `${sourceMode} mode` : "unknown mode",
    providerStatus?.freshnessState ? `provider ${String(providerStatus.freshnessState).toLowerCase()}` : null
  ].filter(Boolean).join(" | ");

  opsHotspotValue.textContent = topHotspot?.referenceLabel || "No active lead";
  opsHotspotMeta.textContent = topHotspot
    ? `${formatCount(topHotspot.incidentCount)} incidents | avg delay ${formatSeconds(topHotspot.avgDelaySeconds)}`
    : "No persistent hotspot band is available in the selected window.";

  if (assessment && numberValue(assessment.recentIncidentCount) > 0) {
    opsCoverageValue.textContent = formatPercent(assessment.resolvedRatePercent);
    opsCoverageMeta.textContent = [
      `${formatCount(assessment.resolvedIncidentCount)}/${formatCount(assessment.recentIncidentCount)} resolved in ${HOTSPOT_WINDOW_HOURS}h`,
      `${formatCount(assessment.highConfidenceCount)} high-confidence`,
      Number.isFinite(numberValue(assessment.avgDistanceToCorridorMeters))
        ? `avg snap ${numberValue(assessment.avgDistanceToCorridorMeters).toFixed(1)} m`
        : null
    ].filter(Boolean).join(" | ");
    return;
  }

  opsCoverageValue.textContent = recentObservationCount > 0
    ? `${recentResolvedMileMarkers}/${recentObservationCount}`
    : "0/0";
  opsCoverageMeta.textContent = recentObservationCount > 0
    ? `${formatCount(recentReferenceCount)} recent reference groups | ${formatCount(recentMissingMileMarkers)} still missing mile markers`
    : "No recent mapped incident observations in the selected corridor.";
}

function renderHistory(history, usableHistory) {
  const recentSamples = Array.isArray(history.samples) ? history.samples.slice().reverse() : [];
  const recentSeries = recentSamples
    .filter((sample) => Number.isFinite(numberValue(sample.avgCurrentSpeed)))
    .map((sample) => ({
      y: numberValue(sample.avgCurrentSpeed),
      xLabel: formatTime(sample.polledAt)
    }));
  const fallbackSamples = Array.isArray(usableHistory.samples) ? usableHistory.samples.slice().reverse() : [];
  const fallbackSeries = fallbackSamples
    .filter((sample) => Number.isFinite(numberValue(sample.avgCurrentSpeed)))
    .map((sample) => ({
      y: numberValue(sample.avgCurrentSpeed),
      xLabel: formatShortDateTime(sample.polledAt)
    }));
  const series = recentSeries.length >= 2 ? recentSeries : fallbackSeries;

  if (recentSeries.length >= 2) {
    historyMeta.textContent = `${recentSeries.length} usable speed samples (${recentSamples.length} recent total)`;
  } else if (fallbackSeries.length >= 2) {
    historyMeta.textContent = `${fallbackSeries.length} usable speed samples (7d fallback; ${recentSamples.length} recent rows lacked speed)`;
  } else {
    historyMeta.textContent = `${Math.max(recentSeries.length, fallbackSeries.length)} usable speed samples available`;
  }
  drawChart(document.getElementById("historyCanvas"), [
    { name: "Current speed", color: "#0f766e", points: series }
  ], { yLabel: "mph" });
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

function renderHotspots(hotspots, topHotspot) {
  const rows = Array.isArray(hotspots.hotspots) ? hotspots.hotspots : [];
  hotspotMeta.textContent = `${rows.length} hotspot bands`;

  hotspotList.innerHTML = "";
  const lead = topHotspot || rows[0] || null;
  if (rows.length === 0) {
    metricHotspot.textContent = "-";
    hotspotList.innerHTML = "<li>No persistent hotspot bands in the selected window.</li>";
    return;
  }

  metricHotspot.textContent = lead?.mileMarkerBand != null
    ? `MM ${lead.mileMarkerBand} ${lead.travelDirection || ""}`.trim()
    : lead?.travelDirectionLabel || lead?.corridor || "-";

  for (const row of rows) {
    const li = document.createElement("li");
    li.textContent = `${row.referenceLabel}: ${formatCount(row.incidentCount)} incidents, avg delay ${formatSeconds(row.avgDelaySeconds)}, max delay ${formatSeconds(row.maxDelaySeconds)}`;
    hotspotList.appendChild(li);
  }
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
    li.textContent = `${reference.label}: ${formatCount(reference.observationCount)} observations, peak ${formatSeconds(reference.maxDelaySeconds)}, last ${formatDateTime(reference.lastSeenAt)}`;
    incidentList.appendChild(li);
  }
}

function renderMileMarkerAssessment(mileMarkerCoverage, corridor) {
  if (!markerAssessmentMeta || !markerAssessmentList) {
    return;
  }

  const assessment = mileMarkerAssessmentForCorridor(mileMarkerCoverage, corridor);
  if (!assessment) {
    markerAssessmentMeta.textContent = "No assessment";
    markerAssessmentList.innerHTML = "<li>No mile-marker assessment is available for the selected corridor yet.</li>";
    return;
  }

  markerAssessmentMeta.textContent = `${formatCount(assessment.recentIncidentCount)} incidents in ${numberValue(mileMarkerCoverage?.windowHours, HOTSPOT_WINDOW_HOURS)}h window`;
  const items = [
    `${formatPercent(assessment.resolvedRatePercent)} resolved | ${formatCount(assessment.highConfidenceCount)} high-confidence placements.`,
    `${formatCount(assessment.anchorInterpolatedCount)} anchor-based, ${formatCount(assessment.rangeInterpolatedCount)} range-based, ${formatCount(assessment.directionOnlyCount)} direction-only, ${formatCount(assessment.offCorridorCount)} off-corridor.`,
    Number.isFinite(numberValue(assessment.avgDistanceToCorridorMeters))
      ? `Average snap distance is ${numberValue(assessment.avgDistanceToCorridorMeters).toFixed(1)} meters from the corridor polyline.`
      : "Average snap distance is not available yet.",
    assessment.configuredAnchorCount > 0
      ? `${formatCount(assessment.configuredAnchorCount)} corridor anchor points are configured across ${formatMileMarker(assessment.configuredStartMileMarker)} to ${formatMileMarker(assessment.configuredEndMileMarker)}.`
      : `Range-only calibration is active from ${formatMileMarker(assessment.configuredStartMileMarker)} to ${formatMileMarker(assessment.configuredEndMileMarker)}.`
  ];

  markerAssessmentList.innerHTML = items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
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
    renderMapPlaceholder("Map data is not available yet.");
    return;
  }

  mapMeta.textContent = `${focusedCorridors.length} corridor, ${incidentFeatures.length} incidents`;
  mapLegend.textContent = selectedFeature?.properties?.geometrySource === "bbox-derived"
    ? "Corridor extent is approximated from the configured bounding box because routing geometry is unavailable. Incident markers reflect the last 12 hours for the selected corridor."
    : "Highlighted corridor uses live map geometry. Incident markers reflect the last 12 hours and are keyed to corridor, mile marker, and direction.";

  drawMapBackground();
  for (const feature of focusedCorridors) {
    drawCorridorFeature(feature, bounds, feature.properties?.corridor === selectedCorridor);
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

  const polyline = document.createElementNS(svgNs, "polyline");
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", selected ? "#0f766e" : "#8fa5a0");
  polyline.setAttribute("stroke-width", selected ? "10" : "6");
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  polyline.setAttribute("opacity", selected ? "0.96" : "0.5");
  polyline.setAttribute("points", points.map((point) => projectPoint(point, bounds).join(",")).join(" "));
  corridorMap.appendChild(polyline);

  if (selected) {
    const labelPoint = projectPoint(points[Math.floor(points.length / 2)], bounds);
    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", String(labelPoint[0] + 12));
    label.setAttribute("y", String(labelPoint[1] - 10));
    label.setAttribute("class", "map-annotation");
    label.textContent = feature.properties?.displayName || feature.properties?.corridor || "Corridor";
    corridorMap.appendChild(label);
  }
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
  const circle = document.createElementNS(svgNs, "circle");
  circle.setAttribute("cx", String(x));
  circle.setAttribute("cy", String(y));
  circle.setAttribute("r", String(radius));
  circle.setAttribute("fill", delaySeconds >= 600 ? "#ad2f2f" : "#db6c3f");
  circle.setAttribute("fill-opacity", "0.82");
  circle.setAttribute("stroke", "#ffffff");
  circle.setAttribute("stroke-width", "2");
  circle.setAttribute("tabindex", "0");
  circle.setAttribute("role", "img");
  circle.setAttribute("aria-label", buildIncidentAriaLabel(feature));

  const title = document.createElementNS(svgNs, "title");
  title.textContent = `${feature.properties?.referenceLabel || "Incident"} | delay ${formatSeconds(delaySeconds)}`;
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
  for (let i = 0; i <= 4; i += 1) {
    const value = maxY - ((maxY - minY) * i) / 4;
    const y = pad.top + (drawHeight * i) / 4;
    ctx.fillText(value.toFixed(0), 8, y + 4);
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
  const heading = props.referenceLabel || props.locationLabel || "Incident";
  const subtitle = [props.corridor || props.roadNumber, props.travelDirectionLabel || longDirectionLabel(props.travelDirection)]
    .filter(Boolean)
    .join(" | ");
  const items = [
    ["Delay", formatSeconds(props.delaySeconds)],
    ["Last Seen", formatDateTime(props.polledAt)],
    ["Direction", props.travelDirectionLabel || longDirectionLabel(props.travelDirection) || "-"],
    ["Mile Marker", formatMileMarker(props.closestMileMarker)],
    ["Placement", formatMethodLabel(props.mileMarkerMethod)],
    ["Confidence", formatConfidence(props.mileMarkerConfidence)],
    ["Snap Distance", formatMeters(props.distanceToCorridorMeters)],
    ["Location", props.locationLabel || "-"],
    ["Type", formatIncidentType(props.iconCategory)]
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
    props.referenceLabel || props.locationLabel || "Incident",
    props.travelDirectionLabel || longDirectionLabel(props.travelDirection),
    formatSeconds(props.delaySeconds),
    formatDateTime(props.polledAt)
  ].filter(Boolean);
  return parts.join(", ");
}

function aggregateIncidentReferences(features) {
  const groups = new Map();

  for (const feature of features) {
    const props = feature?.properties || {};
    const key = incidentAggregationKey(feature);
    const polledAt = props.polledAt || null;
    const delaySeconds = numberValue(props.delaySeconds, 0);
    const label = props.referenceLabel || props.locationLabel || buildIncidentFallbackLabel(props);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        label,
        observationCount: 1,
        maxDelaySeconds: delaySeconds,
        lastSeenAt: polledAt
      });
      continue;
    }

    existing.observationCount += 1;
    existing.maxDelaySeconds = Math.max(existing.maxDelaySeconds, delaySeconds);
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

function mileMarkerAssessmentForCorridor(response, corridor) {
  const rows = Array.isArray(response?.corridors) ? response.corridors : [];
  return rows.find((row) => String(row?.corridor || "").toUpperCase() === String(corridor || "").toUpperCase()) || null;
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
    1: "Accident",
    4: "Road closure",
    5: "Roadworks",
    8: "Lane restriction",
    9: "Traffic event",
    13: "Hazard"
  };
  return knownTypes[code] ? `${knownTypes[code]} (code ${code})` : `Type code ${code}`;
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
