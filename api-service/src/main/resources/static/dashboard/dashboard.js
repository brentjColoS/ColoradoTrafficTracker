const apiKeyInput = document.getElementById("apiKey");
const corridorSelect = document.getElementById("corridorSelect");
const connectBtn = document.getElementById("connectBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusText = document.getElementById("statusText");

const metricCurrent = document.getElementById("metricCurrent");
const metricDelta = document.getElementById("metricDelta");
const metricConfidence = document.getElementById("metricConfidence");
const metricAnomalies = document.getElementById("metricAnomalies");
const metricIncidentTotal = document.getElementById("metricIncidentTotal");
const metricHotspot = document.getElementById("metricHotspot");

const historyMeta = document.getElementById("historyMeta");
const trendMeta = document.getElementById("trendMeta");
const forecastMeta = document.getElementById("forecastMeta");
const mapMeta = document.getElementById("mapMeta");
const mapLegend = document.getElementById("mapLegend");
const summaryMeta = document.getElementById("summaryMeta");
const hotspotMeta = document.getElementById("hotspotMeta");
const incidentMeta = document.getElementById("incidentMeta");

const summaryStats = document.getElementById("summaryStats");
const anomalyList = document.getElementById("anomalyList");
const hotspotList = document.getElementById("hotspotList");
const incidentList = document.getElementById("incidentList");
const corridorMap = document.getElementById("corridorMap");

const HISTORY_WINDOW_MINUTES = 180;
const HISTORY_LIMIT = 120;
const MAP_WINDOW_MINUTES = 720;
const HOTSPOT_WINDOW_HOURS = 168;
const TREND_WINDOW_HOURS = 168;
const TREND_LIMIT = 168;
const FORECAST_HORIZON_MINUTES = 60;
const FORECAST_WINDOW_MINUTES = 720;
const FORECAST_STEP_MINUTES = 15;

const storageKey = "ctt_dashboard_api_key";
const svgNs = "http://www.w3.org/2000/svg";

connectBtn.addEventListener("click", connectAndLoad);
refreshBtn.addEventListener("click", refreshDashboard);
corridorSelect.addEventListener("change", refreshDashboard);

init();

async function init() {
  const remembered = localStorage.getItem(storageKey);
  if (remembered) {
    apiKeyInput.value = remembered;
    await connectAndLoad();
    return;
  }
  setStatus("Paste your API key, then select Connect.");
}

async function connectAndLoad() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setStatus("API key is required.", true);
    return;
  }

  localStorage.setItem(storageKey, apiKey);
  setStatus("Connecting...");
  try {
    const corridors = await fetchJson("/api/traffic/corridors");
    populateCorridors(corridors);
    setStatus("Connected.");
    await refreshDashboard();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function refreshDashboard() {
  const corridor = corridorSelect.value;
  if (!corridor) {
    setStatus("No corridor selected.", true);
    return;
  }

  setStatus(`Refreshing ${corridor}...`);
  try {
    const [latest, history, anomalies, forecast, mapCorridors, mapIncidents, analyticsSummary, analyticsTrend, analyticsHotspots] =
      await Promise.all([
        fetchJson(`/api/traffic/latest?corridor=${encodeURIComponent(corridor)}`),
        fetchJson(
          `/api/traffic/history?corridor=${encodeURIComponent(corridor)}&windowMinutes=${HISTORY_WINDOW_MINUTES}&limit=${HISTORY_LIMIT}`
        ),
        fetchJson(
          `/api/traffic/anomalies?corridor=${encodeURIComponent(corridor)}&windowMinutes=180&baselineMinutes=1440&zThreshold=2.0`
        ),
        fetchJson(
          `/api/traffic/forecast?corridor=${encodeURIComponent(corridor)}&horizonMinutes=${FORECAST_HORIZON_MINUTES}&windowMinutes=${FORECAST_WINDOW_MINUTES}&stepMinutes=${FORECAST_STEP_MINUTES}`
        ),
        fetchJson("/api/traffic/map/corridors"),
        fetchJson(
          `/api/traffic/map/incidents?corridor=${encodeURIComponent(corridor)}&windowMinutes=${MAP_WINDOW_MINUTES}&limit=40`
        ),
        fetchJson(`/api/traffic/analytics/corridors?windowHours=${HOTSPOT_WINDOW_HOURS}`),
        fetchJson(
          `/api/traffic/analytics/trends?corridor=${encodeURIComponent(corridor)}&windowHours=${TREND_WINDOW_HOURS}&limit=${TREND_LIMIT}`
        ),
        fetchJson(
          `/api/traffic/analytics/hotspots?corridor=${encodeURIComponent(corridor)}&windowHours=${HOTSPOT_WINDOW_HOURS}&limit=5`
        )
      ]);

    renderLatest(latest);
    renderHistory(history);
    renderTrend(analyticsTrend);
    renderAnomalies(anomalies);
    renderForecast(forecast);
    renderSummary(analyticsSummary, corridor);
    renderHotspots(analyticsHotspots);
    renderIncidentReferences(mapIncidents);
    renderMap(mapCorridors, mapIncidents, corridor);

    setStatus(`Updated ${corridor} at ${new Date().toLocaleTimeString()}.`);
  } catch (err) {
    setStatus(err.message, true);
  }
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

function renderLatest(latest) {
  const current = numberValue(latest.avgCurrentSpeed);
  const freeflow = numberValue(latest.avgFreeflowSpeed);
  const confidence = numberValue(latest.confidence);

  metricCurrent.textContent = formatSpeed(current);
  metricConfidence.textContent = Number.isFinite(confidence)
    ? `${Math.round(confidence * 100)}%`
    : "-";

  if (Number.isFinite(current) && Number.isFinite(freeflow)) {
    const delta = current - freeflow;
    metricDelta.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} mph`;
  } else {
    metricDelta.textContent = "-";
  }
}

function renderHistory(history) {
  const samples = Array.isArray(history.samples) ? history.samples.slice().reverse() : [];
  const series = samples
    .filter((sample) => Number.isFinite(numberValue(sample.avgCurrentSpeed)))
    .map((sample) => ({
      y: numberValue(sample.avgCurrentSpeed),
      xLabel: formatTime(sample.polledAt)
    }));

  historyMeta.textContent = `${samples.length} recent samples`;
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

  trendMeta.textContent = `${buckets.length} hourly buckets`;
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
  forecastMeta.textContent = `${predictions.length} projected points`;

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

function renderSummary(summary, corridor) {
  const rows = Array.isArray(summary.corridors) ? summary.corridors : [];
  const current = rows.find((row) => row.corridor === corridor);

  if (!current) {
    metricIncidentTotal.textContent = "-";
    summaryMeta.textContent = "No corridor analytics";
    summaryStats.innerHTML = "<div><dt>No summary</dt><dd>Analytics are not available yet</dd></div>";
    return;
  }

  metricIncidentTotal.textContent = formatCount(current.totalIncidentCount);
  summaryMeta.textContent = `${rows.length} corridors over ${summary.windowHours}h`;

  const items = [
    ["Samples", formatCount(current.sampleCount)],
    ["Buckets", formatCount(current.bucketCount)],
    ["Average Speed", formatSpeed(current.avgCurrentSpeed)],
    ["Observed Low", formatSpeed(current.minCurrentSpeed)],
    ["Speed Variability", formatSpeed(current.avgSpeedStddev)],
    ["Window", `${formatShortDate(current.firstBucketStart)} to ${formatShortDate(current.lastBucketStart)}`]
  ];

  summaryStats.innerHTML = items.map(([label, value]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  ).join("");
}

function renderHotspots(hotspots) {
  const rows = Array.isArray(hotspots.hotspots) ? hotspots.hotspots : [];
  hotspotMeta.textContent = `${rows.length} hotspot bands`;

  hotspotList.innerHTML = "";
  if (rows.length === 0) {
    metricHotspot.textContent = "-";
    hotspotList.innerHTML = "<li>No persistent hotspot bands in the selected window.</li>";
    return;
  }

  const top = rows[0];
  metricHotspot.textContent = top.mileMarkerBand != null
    ? `MM ${top.mileMarkerBand} ${top.travelDirection || ""}`.trim()
    : top.travelDirectionLabel || top.corridor;

  for (const row of rows) {
    const li = document.createElement("li");
    li.textContent = `${row.referenceLabel}: ${formatCount(row.incidentCount)} incidents, avg delay ${formatSeconds(row.avgDelaySeconds)}, max delay ${formatSeconds(row.maxDelaySeconds)}`;
    hotspotList.appendChild(li);
  }
}

function renderIncidentReferences(incidents) {
  const rows = Array.isArray(incidents.features) ? incidents.features : [];
  incidentMeta.textContent = `${rows.length} incidents on map`;
  incidentList.innerHTML = "";

  if (rows.length === 0) {
    incidentList.innerHTML = "<li>No mapped incidents in the selected window.</li>";
    return;
  }

  for (const feature of rows.slice(0, 6)) {
    const props = feature.properties || {};
    const li = document.createElement("li");
    li.textContent = `${props.referenceLabel || props.locationLabel || "Incident"}: ${formatSeconds(props.delaySeconds)} delay, ${formatDateTime(props.polledAt)}`;
    incidentList.appendChild(li);
  }
}

function renderMap(corridorsCollection, incidentsCollection, selectedCorridor) {
  corridorMap.innerHTML = "";
  const corridorFeatures = Array.isArray(corridorsCollection.features) ? corridorsCollection.features : [];
  const incidentFeatures = Array.isArray(incidentsCollection.features) ? incidentsCollection.features : [];

  const bounds = featureBounds(corridorFeatures, incidentFeatures);
  if (!bounds) {
    mapMeta.textContent = "No spatial data";
    mapLegend.textContent = "No corridor or incident geometry is available yet.";
    renderMapPlaceholder("Map data is not available yet.");
    return;
  }

  mapMeta.textContent = `${corridorFeatures.length} corridors, ${incidentFeatures.length} incidents`;
  mapLegend.textContent = "Highlighted corridor uses live map geometry. Incident markers reflect the last 12 hours and are keyed to corridor, mile marker, and direction.";

  drawMapBackground();
  for (const feature of corridorFeatures) {
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

  const title = document.createElementNS(svgNs, "title");
  title.textContent = `${feature.properties?.referenceLabel || "Incident"} | delay ${formatSeconds(delaySeconds)}`;
  circle.appendChild(title);
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
  if (allPoints.length < 2) {
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
    if (points.length < 2) return;
    ctx.strokeStyle = dataset.color;
    ctx.lineWidth = 2.4;
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
  if (labels.length >= 2) {
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

async function fetchJson(path) {
  const apiKey = apiKeyInput.value.trim();
  const response = await fetch(path, {
    headers: {
      "X-API-Key": apiKey
    }
  });

  if (response.status === 401) {
    throw new Error("Unauthorized. Check your API key and reconnect.");
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
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatSpeed(value) {
  if (!Number.isFinite(numberValue(value))) return "-";
  return `${numberValue(value).toFixed(1)} mph`;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
