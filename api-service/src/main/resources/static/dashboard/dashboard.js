const apiKeyInput = document.getElementById("apiKey");
const corridorSelect = document.getElementById("corridorSelect");
const connectBtn = document.getElementById("connectBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusText = document.getElementById("statusText");

const metricCurrent = document.getElementById("metricCurrent");
const metricDelta = document.getElementById("metricDelta");
const metricConfidence = document.getElementById("metricConfidence");
const metricAnomalies = document.getElementById("metricAnomalies");
const anomalyList = document.getElementById("anomalyList");
const historyMeta = document.getElementById("historyMeta");
const forecastMeta = document.getElementById("forecastMeta");

const HISTORY_WINDOW_MINUTES = 180;
const HISTORY_LIMIT = 120;
const FORECAST_HORIZON_MINUTES = 60;
const FORECAST_WINDOW_MINUTES = 720;
const FORECAST_STEP_MINUTES = 15;

const storageKey = "ctt_dashboard_api_key";

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
    const [latest, history, anomalies, forecast] = await Promise.all([
      fetchJson(`/api/traffic/latest?corridor=${encodeURIComponent(corridor)}`),
      fetchJson(
        `/api/traffic/history?corridor=${encodeURIComponent(corridor)}&windowMinutes=${HISTORY_WINDOW_MINUTES}&limit=${HISTORY_LIMIT}`
      ),
      fetchJson(
        `/api/traffic/anomalies?corridor=${encodeURIComponent(corridor)}&windowMinutes=180&baselineMinutes=1440&zThreshold=2.0`
      ),
      fetchJson(
        `/api/traffic/forecast?corridor=${encodeURIComponent(corridor)}&horizonMinutes=${FORECAST_HORIZON_MINUTES}&windowMinutes=${FORECAST_WINDOW_MINUTES}&stepMinutes=${FORECAST_STEP_MINUTES}`
      )
    ]);

    renderLatest(latest);
    renderHistory(history);
    renderAnomalies(anomalies);
    renderForecast(forecast);
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

  if (Number.isFinite(current) && Number.isFinite(freeflow)) {
    const delta = current - freeflow;
    metricDelta.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} mph`;
  } else {
    metricDelta.textContent = "-";
  }

  metricConfidence.textContent = Number.isFinite(confidence)
    ? `${Math.round(confidence * 100)}%`
    : "-";
}

function renderHistory(history) {
  const samples = Array.isArray(history.samples) ? history.samples.slice().reverse() : [];
  const series = samples
    .filter((s) => Number.isFinite(numberValue(s.avgCurrentSpeed)))
    .map((s) => ({
      y: numberValue(s.avgCurrentSpeed),
      xLabel: formatTime(s.polledAt)
    }));

  historyMeta.textContent = `${samples.length} samples`;
  drawChart(document.getElementById("historyCanvas"), [{ name: "Current speed", color: "#0b6f6a", points: series }], {
    yLabel: "mph"
  });
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
    li.textContent = `${formatTime(row.polledAt)}: observed ${formatSpeed(row.observedSpeed)}, expected minimum ${formatSpeed(row.expectedMinimumSpeed)} (z=${numberValue(row.zScore, 0).toFixed(2)})`;
    anomalyList.appendChild(li);
  }
}

function renderForecast(forecast) {
  const predictions = Array.isArray(forecast.predictions) ? forecast.predictions : [];
  forecastMeta.textContent = `${predictions.length} projected points`;

  const main = predictions.map((p) => ({
    y: numberValue(p.predictedSpeed),
    xLabel: formatTime(p.timestamp)
  }));
  const lower = predictions.map((p) => ({
    y: numberValue(p.lowerBoundSpeed),
    xLabel: formatTime(p.timestamp)
  }));
  const upper = predictions.map((p) => ({
    y: numberValue(p.upperBoundSpeed),
    xLabel: formatTime(p.timestamp)
  }));

  drawChart(
    document.getElementById("forecastCanvas"),
    [
      { name: "Lower", color: "#de6f3d", points: lower },
      { name: "Predicted", color: "#2559a8", points: main },
      { name: "Upper", color: "#0b6f6a", points: upper }
    ],
    { yLabel: "mph" }
  );
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

  const allPoints = datasets.flatMap((d) => d.points).filter((p) => Number.isFinite(p.y));
  if (allPoints.length < 2) {
    ctx.fillStyle = "#4e5d6c";
    ctx.font = '15px "Avenir Next", "Trebuchet MS", sans-serif';
    ctx.fillText("Not enough data points.", 24, 40);
    return;
  }

  let minY = Math.min(...allPoints.map((p) => p.y));
  let maxY = Math.max(...allPoints.map((p) => p.y));
  if (Math.abs(maxY - minY) < 1.0) {
    maxY += 1.0;
    minY -= 1.0;
  }
  const span = maxY - minY;
  minY -= span * 0.1;
  maxY += span * 0.1;

  ctx.strokeStyle = "#dbe4e2";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (drawHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#4e5d6c";
  ctx.font = '12px "Avenir Next", "Trebuchet MS", sans-serif';
  for (let i = 0; i <= 4; i++) {
    const value = maxY - ((maxY - minY) * i) / 4;
    const y = pad.top + (drawHeight * i) / 4;
    ctx.fillText(value.toFixed(0), 8, y + 4);
  }

  datasets.forEach((dataset) => {
    const points = dataset.points.filter((p) => Number.isFinite(p.y));
    if (points.length < 2) return;
    ctx.strokeStyle = dataset.color;
    ctx.lineWidth = 2.25;
    ctx.beginPath();
    points.forEach((point, idx) => {
      const x = pad.left + (drawWidth * idx) / (points.length - 1);
      const y = pad.top + ((maxY - point.y) / (maxY - minY)) * drawHeight;
      if (idx === 0) ctx.moveTo(x, y);
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

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
