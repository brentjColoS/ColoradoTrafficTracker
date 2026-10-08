const chartHistory = {
  enabled: false, endTime: null, bounds: null, coveragePromise: null,
  data: null, dataKey: null, cache: new Map(), baselines: new Map(),
  timer: null, drawing: false, loading: false, error: "",
  controller: null, coverageController: null, coverageFailures: new Map(),
  disposed: false, lastReadAt: 0, rateUntil: 0, rateTimer: null
};
const HISTORY_WINDOW_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
});

function initializeHistoryControls() {
  elements.historyToggle.addEventListener("click", () => {
    chartHistory.enabled = !chartHistory.enabled;
    chartHistory.error = "";
    updateHistoryControls();
    if (chartHistory.enabled) void loadHistoryCoverage();
  });
  elements.historyFirst.addEventListener("click", () => setHistoryEnd(historyLimits().firstEnd));
  elements.historyCurrent.addEventListener("click", () => setHistoryEnd(null));
  elements.historyOlder.addEventListener("click", () => panHistoryWindow(state.selectedHours * 3_600_000 / 4));
  elements.historyNewer.addEventListener("click", () => panHistoryWindow(-state.selectedHours * 3_600_000 / 4));
  elements.historyRetry.addEventListener("click", () => {
    chartHistory.error = "";
    if (chartHistory.bounds === null || chartHistory.coverageFailures.size || !historyLimits().available) {
      chartHistory.enabled = true;
      void loadHistoryCoverage(true);
    }
    else scheduleHistoryLoad();
  });
  for (const corridor of CORRIDOR_IDS) {
    const canvas = document.getElementById(CORRIDOR_CONFIG[corridor].chartId);
    canvas.addEventListener("wheel", event => {
      if (!chartHistory.enabled || chartHistory.disposed || document.hidden || event.ctrlKey || event.metaKey || event.altKey) return;
      const width = canvas.clientWidth;
      const distance = historyWheelPixels(event, width);
      if (panHistoryWindow(distance / Math.max(300, width) * state.selectedHours * 3_600_000)) {
        event.preventDefault();
      }
    }, { passive: false });
    canvas.addEventListener("keydown", event => {
      if (!chartHistory.enabled || chartHistory.disposed || document.hidden || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const step = state.selectedHours * 3_600_000 / 4;
      const handled = event.key === "ArrowLeft" ? panHistoryWindow(step)
        : event.key === "ArrowRight" ? panHistoryWindow(-step)
          : event.key === "Home" ? setHistoryEnd(historyLimits().firstEnd)
            : event.key === "End" ? setHistoryEnd(null) : false;
      if (handled) event.preventDefault();
    });
  }
  window.addEventListener("pagehide", () => {
    chartHistory.disposed = true;
    cancelHistoryReads();
    chartHistory.coverageController?.abort();
  });
  window.addEventListener("pageshow", () => {
    chartHistory.disposed = false;
    resumeHistoryReads();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelHistoryReads();
      chartHistory.coverageController?.abort();
    } else resumeHistoryReads();
  });
}

function cancelHistoryReads() {
  window.clearTimeout(chartHistory.timer);
  chartHistory.timer = null;
  chartHistory.controller?.abort();
  window.clearTimeout(chartHistory.rateTimer);
  chartHistory.rateTimer = null;
}

function resumeHistoryReads() {
  if (chartHistory.disposed || document.hidden) return;
  if (chartHistory.enabled && chartHistory.bounds === null) {
    if (chartHistory.coveragePromise) void chartHistory.coveragePromise.then(() => {
      if (chartHistory.enabled && chartHistory.bounds === null) void loadHistoryCoverage();
    });
    else void loadHistoryCoverage();
  }
  if (chartHistory.endTime !== null && chartHistory.dataKey !== historyWindowKey()) scheduleHistoryLoad();
}

function historyWheelPixels(event, width) {
  const horizontal = Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0);
  const delta = horizontal ? -(event.deltaX || 0) : event.deltaY || 0;
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1;
  return Math.max(-120, Math.min(120, delta * multiplier));
}

function historyCorridors() {
  return state.focusedCorridor === "ALL" ? CORRIDOR_IDS : [state.focusedCorridor];
}

function historyLatestTime() {
  return HISTORICAL_MODE || REPLAY_MODE ? latestRouteTime(state.routeData)?.getTime() || Date.now() : Date.now();
}

function historyLimits() {
  const latest = historyLatestTime();
  const field = state.chartView === "zones" ? "firstZoneObservedAt" : "firstObservedAt";
  const starts = historyCorridors().map(corridor => dateMillis(chartHistory.bounds?.get(corridor)?.[field]))
    .filter(time => Number.isFinite(time) && time > 0 && time <= latest);
  const bucketMs = (state.chartView === "zones" ? {2:1, 6:5, 24:15, 168:60, 720:180}[state.selectedHours] : 60) * 60_000;
  const firstStart = starts.length ? Math.floor(Math.min(...starts) / bucketMs) * bucketMs : latest;
  const firstEnd = Math.min(latest, firstStart + state.selectedHours * 3_600_000);
  return { firstEnd, latest, available: starts.length > 0 };
}

function clampHistoryEnd(end, firstEnd, latest) {
  return Math.max(Math.min(firstEnd, latest), Math.min(latest, end));
}

function panHistoryWindow(olderBy) {
  const limits = historyLimits();
  if (!chartHistory.enabled || !limits.available || !Number.isFinite(olderBy) || olderBy === 0) return false;
  const end = chartHistory.endTime ?? limits.latest;
  const next = clampHistoryEnd(end - olderBy, limits.firstEnd, limits.latest);
  if (Math.abs(next - end) < 1) return false;
  return setHistoryEnd(next >= limits.latest ? null : next);
}

function setHistoryEnd(requestedEnd) {
  const limits = historyLimits();
  if (requestedEnd !== null && !limits.available) return false;
  const end = requestedEnd === null ? null : clampHistoryEnd(requestedEnd, limits.firstEnd, limits.latest);
  const next = end !== null && end >= limits.latest ? null : end;
  if (next === chartHistory.endTime) return false;
  chartHistory.endTime = next;
  chartHistory.error = "";
  refreshHistorySelection();
  return true;
}

function historyWindowKey() {
  return `${historyCorridors().join(",")}|${state.chartView}|${state.selectedHours}|${Math.floor(chartHistory.endTime / 60_000)}`;
}

function refreshHistorySelection() {
  if (chartHistory.endTime === null || chartHistory.controller?.key !== historyWindowKey()) cancelHistoryReads();
  if (chartHistory.endTime !== null) {
    const limits = historyLimits();
    if (limits.available) {
      chartHistory.endTime = clampHistoryEnd(chartHistory.endTime, limits.firstEnd, limits.latest);
      const cached = chartHistory.cache.get(historyWindowKey());
      if (chartHistory.dataKey !== historyWindowKey()) chartHistory.error = "";
      if (cached && !cached.partial && Date.now() - cached.fetchedAt < 60_000) {
        chartHistory.data = cached.data;
        chartHistory.dataKey = historyWindowKey();
        chartHistory.error = "";
      } else scheduleHistoryLoad();
    } else {
      chartHistory.dataKey = null;
      const failures = historyCorridors().map(corridor => chartHistory.coverageFailures.get(corridor)).filter(Boolean);
      chartHistory.error = failures.length ? `${failures.join("; ")}. Retry to load bounds, or choose Current.`
        : "No retained observations for this chart selection. Retry to check again, or choose Current.";
    }
  }
  if (!chartHistory.drawing) {
    chartHistory.drawing = true;
    window.requestAnimationFrame(() => {
      chartHistory.drawing = false;
      if (chartHistory.disposed || document.hidden) return;
      updateHistoryControls();
      updateReferenceBandControl();
      drawAllCharts();
    });
  }
}

async function loadHistoryCoverage(force = false) {
  if (chartHistory.disposed || document.hidden) return;
  if (!force && chartHistory.bounds?.size === CORRIDOR_IDS.length) return;
  if (chartHistory.coveragePromise) return chartHistory.coveragePromise;
  const controller = new AbortController();
  chartHistory.coverageController = controller;
  chartHistory.coveragePromise = (async () => {
    try {
      const corridors = CORRIDOR_IDS.filter(corridor => force || !chartHistory.bounds?.has(corridor));
      const results = await Promise.allSettled(corridors.map(async corridor => [corridor, DEMO_MODE
        ? { firstObservedAt: new Date(Date.now() - 180 * 86_400_000).toISOString(), firstZoneObservedAt: new Date(Date.now() - 180 * 86_400_000).toISOString() }
        : await fetchJson(dashboardApi(`/traffic/analytics/coverage?corridor=${corridor}`), controller.signal)]));
      if (controller.signal.aborted || chartHistory.disposed) return;
      for (const [index, result] of results.entries()) {
        const corridor = corridors[index];
        if (result.status === "fulfilled") {
          chartHistory.bounds ??= new Map();
          chartHistory.bounds.set(...result.value);
          chartHistory.coverageFailures.delete(corridor);
        } else chartHistory.coverageFailures.set(corridor, `${CORRIDOR_CONFIG[corridor].label} history bounds unavailable`);
      }
      if (chartHistory.bounds === null) chartHistory.enabled = false;
    } finally {
      chartHistory.coveragePromise = null;
      chartHistory.coverageController = null;
      if (!chartHistory.disposed && !document.hidden) {
        if (chartHistory.endTime !== null && !controller.signal.aborted) refreshHistorySelection();
        updateHistoryControls();
      }
    }
  })();
  return chartHistory.coveragePromise;
}

function scheduleHistoryLoad() {
  window.clearTimeout(chartHistory.timer);
  if (chartHistory.endTime === null || chartHistory.disposed || document.hidden) return;
  if (chartHistory.rateUntil > Date.now()) {
    window.clearTimeout(chartHistory.rateTimer);
    chartHistory.rateTimer = window.setTimeout(() => {
      chartHistory.rateTimer = null;
      if (!chartHistory.disposed && !document.hidden) updateHistoryControls();
    }, chartHistory.rateUntil - Date.now());
    return;
  }
  const delay = Math.max(250, chartHistory.lastReadAt + 4000 - Date.now());
  chartHistory.timer = window.setTimeout(() => {
    chartHistory.timer = null;
    void loadChartHistory();
  }, delay);
}

async function loadChartHistory() {
  if (chartHistory.endTime === null || chartHistory.loading || chartHistory.disposed || document.hidden || chartHistory.rateUntil > Date.now()) return;
  const key = historyWindowKey();
  const hours = state.selectedHours;
  const end = Math.floor(chartHistory.endTime / 60_000) * 60_000;
  const view = state.chartView;
  const corridors = [...historyCorridors()];
  const controller = new AbortController();
  controller.key = key;
  chartHistory.controller = controller;
  chartHistory.lastReadAt = Date.now();
  chartHistory.rateUntil = 0;
  chartHistory.loading = true;
  updateHistoryControls();
  try {
    const data = DEMO_MODE ? buildDemoDashboardData(hours, new Date(end)).routeData
      : new Map(await Promise.all(corridors.map(async corridor => {
        try { return [corridor, await loadChartHistoryRoute(corridor, hours, end, view, controller.signal)]; }
        catch (error) {
          if (controller.signal.aborted) throw error;
          if (error.status === 429) {
            const seconds = Number(error.retryAfter);
            const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.parse(error.retryAfter) - Date.now();
            chartHistory.rateUntil = Math.max(chartHistory.rateUntil, Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60_000));
          }
          return [corridor, {trend:{buckets:[]}, zones:[], baseline:{profiles:[]}, zoneBaseline:{zones:[]}, history:{samples:[]}, incidentThreads:[],
            chartPartial:true, chartUnavailable:true, chartIssues:[`${CORRIDOR_CONFIG[corridor].label} chart observations unavailable`]}];
        }
      })));
    if (controller.signal.aborted || chartHistory.disposed) return;
    for (const route of data.values()) {
      route.chartHours = hours;
      route.chartView = view;
      route.chartWeek = historyWeekKey(end);
    }
    const partial = [...data.values()].some(route => route.chartPartial);
    chartHistory.cache.set(key, { data, partial, fetchedAt: Date.now() });
    while (chartHistory.cache.size > 8) chartHistory.cache.delete(chartHistory.cache.keys().next().value);
    if (chartHistory.endTime !== null && key === historyWindowKey()) {
      chartHistory.data = data;
      chartHistory.dataKey = key;
      const issues = [...data.values()].flatMap(route => route.chartIssues || []);
      chartHistory.error = partial ? `${issues.join("; ") || "Some chart history is unavailable"}. Retry to reload this window.` : "";
    }
  } catch {
    if (!controller.signal.aborted && chartHistory.endTime !== null && key === historyWindowKey()) {
      chartHistory.error = "Chart history could not load. Retry or return to Current.";
    }
  } finally {
    chartHistory.loading = false;
    chartHistory.controller = null;
    if (chartHistory.disposed || document.hidden) return;
    updateHistoryControls();
    updateReferenceBandControl();
    drawAllCharts();
    if (chartHistory.endTime !== null && (key !== historyWindowKey() || chartHistory.rateUntil > Date.now())) scheduleHistoryLoad();
  }
}

function historyWeekKey(timestamp) {
  const day = denverCalendarDay(timestamp);
  const weekday = Number(denverProfileKey(timestamp).split("|")[0]);
  return new Date(Date.parse(`${day}T12:00:00Z`) - (weekday - 1) * 86_400_000).toISOString().slice(0, 10);
}

async function historyBaseline(corridor, end, zones, signal, requestJson = fetchJson) {
  const key = `${corridor}|${zones}|${historyWeekKey(end)}`;
  if (chartHistory.baselines.has(key)) return chartHistory.baselines.get(key);
  const value = await requestJson(dashboardApi(`/traffic/${zones ? "zones" : "analytics"}/baselines?corridor=${corridor}&asOf=${encodeURIComponent(new Date(end).toISOString())}`), signal);
  if (signal?.aborted) throw signal.reason;
  chartHistory.baselines.set(key, value);
  while (chartHistory.baselines.size > 16) chartHistory.baselines.delete(chartHistory.baselines.keys().next().value);
  return value;
}

const historyBatches = new Map();

async function chartHistoryBatch(corridor, hours, end, view, signal) {
  const key = `${hours}|${end}|${view}`;
  let batch = historyBatches.get(key);
  if (!batch || batch.signal !== signal || (batch.dispatched && !batch.corridors.has(corridor))) {
    batch = {signal, corridors: new Set(), dispatched: false};
    batch.promise = Promise.resolve().then(() => {
      batch.dispatched = true;
      return readDashboardBatch(
        dashboardApi(`/traffic/dashboard/history?corridors=${[...batch.corridors].join(",")}`
          + `&hours=${hours}&asOf=${encodeURIComponent(new Date(end).toISOString())}&zones=${view === "zones"}`), signal);
    })
      .finally(() => { if (historyBatches.get(key) === batch) historyBatches.delete(key); });
    historyBatches.set(key, batch);
  }
  batch.corridors.add(corridor);
  return batch.promise;
}

async function loadChartHistoryRoute(corridor, hours, end, view, signal) {
  const requestJson = await chartHistoryBatch(corridor, hours, end, view, signal);
  const asOf = `&asOf=${encodeURIComponent(new Date(end).toISOString())}`;
  const zones = view === "zones";
  const results = await Promise.allSettled([
    requestJson(dashboardApi(zones
      ? `/traffic/zones/trends?corridor=${corridor}&windowHours=${hours}${asOf}`
      : `/traffic/analytics/trends?corridor=${corridor}&windowHours=${hours + 169}&limit=${hours + 170}&preferUsable=true${asOf}`), signal),
    historyBaseline(corridor, end, zones, signal, requestJson),
    !zones && hours <= 24 ? requestJson(dashboardApi(`/traffic/history?corridor=${corridor}&windowMinutes=${hours * 60}&limit=${detailedSpeedSampleLimit(hours * 60)}&preferUsable=true&includeIncidents=false${asOf}`), signal) : Promise.resolve({ samples: [] }),
    requestJson(dashboardApi(`/traffic/map/incidents/timeline?corridor=${corridor}&windowMinutes=${hours * 60}&limit=1000${asOf}`), signal)
  ]);
  const limited = results.find(result => result.status === "rejected" && result.reason?.status === 429);
  if (limited) throw limited.reason;
  // A zone 404 denotes an empty window, not permission to reuse another window's observations.
  if (results[0].status === "rejected" && !(zones && String(results[0].reason).includes("returned 404"))) throw results[0].reason;
  const [series, baseline, history, incidents] = results.map(result => result.status === "fulfilled" ? result.value : null);
  const label = corridor === "I25" ? "I-25" : "I-70";
  const chartIssues = results.slice(1).flatMap((result, index) => result.status === "rejected"
    ? [`${label} ${["baseline", "detailed speeds", "incident markers"][index]} unavailable`] : []);
  return {
    corridor, dataAnchor: new Date(end).toISOString(), chartWeek: historyWeekKey(end),
    trend: zones ? { buckets: [] } : series || { buckets: [] },
    zones: zones ? series?.points || [] : [],
    baseline: zones ? { profiles: [] } : baseline || { profiles: [] },
    zoneBaseline: zones ? baseline || { zones: [] } : { zones: [] },
    history: history || { samples: [] }, incidentThreads: aggregateIncidentThreads(incidents?.features || [], new Date(end)),
    chartPartial: chartIssues.length > 0, chartIssues,
    chartNote: (incidents?.features?.length || 0) >= 1000
      ? `${label} incident markers are limited to the latest 1,000 reports. Choose a shorter range for more detail.` : ""
  };
}

function chartRouteData(corridor) {
  if (chartHistory.endTime === null) return state.routeData.get(corridor);
  const cached = chartHistory.data?.get(corridor);
  return chartHistory.dataKey === historyWindowKey() ? cached || null : null;
}

function chartEndTime(route) {
  return chartHistory.endTime === null ? routeEndTime(route) : Math.floor(chartHistory.endTime / 60_000) * 60_000;
}

function chartHistoryEmptyMessage(message, corridor) {
  if (chartHistory.endTime !== null && chartHistory.dataKey === historyWindowKey()
      && chartHistory.data?.get(corridor)?.chartUnavailable) return "History could not load. Choose Retry or Current.";
  if (chartHistory.endTime === null || chartHistory.dataKey === historyWindowKey()) return message;
  return chartHistory.error ? "History could not load. Choose Retry or Current." : "Loading observations for this historical window…";
}

function updateHistoryControls() {
  const limits = historyLimits();
  const end = chartHistory.endTime ?? limits.latest;
  const historical = chartHistory.endTime !== null;
  const atFirst = end <= limits.firstEnd;
  elements.historyToggle.setAttribute("aria-pressed", String(chartHistory.enabled));
  elements.historyState.textContent = chartHistory.enabled ? "Enabled" : "Disabled";
  document.body.dataset.historyScroll = chartHistory.enabled ? "enabled" : "disabled";
  elements.historyFirst.disabled = !chartHistory.enabled || !limits.available || atFirst;
  elements.historyOlder.disabled = elements.historyFirst.disabled;
  elements.historyNewer.disabled = !chartHistory.enabled || !historical;
  elements.historyCurrent.disabled = !historical;
  elements.historyRetry.hidden = !chartHistory.error && !chartHistory.coverageFailures.size && (limits.available || !chartHistory.enabled);
  if (chartHistory.rateUntil) elements.historyRetry.hidden = false;
  elements.historyRetry.disabled = chartHistory.rateUntil > Date.now();
  const format = value => HISTORY_WINDOW_FORMATTER.format(new Date(value));
  elements.historyWindow.textContent = `${historical ? "Historical" : "Current window"} · ${format(end - state.selectedHours * 3_600_000)} → ${format(end)} · Denver time`;
  const pending = historical && chartHistory.dataKey !== historyWindowKey();
  const coverageIssue = historyCorridors().map(corridor => chartHistory.coverageFailures.get(corridor)).filter(Boolean).join("; ");
  const rateIssue = chartHistory.rateUntil ? chartHistory.rateUntil > Date.now()
    ? `History read limit reached. Retry available after ${HISTORY_WINDOW_FORMATTER.format(new Date(chartHistory.rateUntil))} Denver time. Current and normal page scrolling remain available.`
    : "History read limit reached. Choose Retry to reload this window, or Current." : "";
  elements.historyHelp.textContent = rateIssue || chartHistory.error || (coverageIssue && !limits.available ? `${coverageIssue}. Retry to load history bounds.` : "") || (chartHistory.enabled && chartHistory.bounds === null
    ? "Finding retained history…"
    : pending || chartHistory.loading && historical ? `${chartHistory.enabled ? "" : "Historical window locked. "}Loading this chart window… Summaries and map are unchanged.`
      : chartHistory.enabled && !limits.available ? "No retained observations for this chart selection. Normal page scrolling remains available."
        : chartHistory.enabled ? `${atFirst ? "Start of retained history. " : ""}Wheel down: earlier · wheel up: later · ←/→ keys · Home: First · End: Current. Summaries and map are unchanged.`
        : historical ? "Historical window locked. Enable scrolling to navigate, or choose Current."
          : "Enable to browse earlier patterns. Summaries and map stay in their selected current window.");
  if (coverageIssue && limits.available && !chartHistory.error && !rateIssue) {
    elements.historyHelp.textContent += ` ${coverageIssue}. Retry to include its retained boundary; the other corridor remains navigable.`;
  }
  if (historical && !pending && !chartHistory.error) {
    const notes = [...(chartHistory.data?.values() || [])].map(route => route.chartNote).filter(Boolean);
    if (notes.length) elements.historyHelp.textContent += ` ${notes.join(" ")}`;
  }
  for (const corridor of CORRIDOR_IDS) {
    const label = document.querySelector(`[data-speed-legend="${corridor}"]`);
    if (label) label.textContent = `${corridor === "I25" ? "I-25" : "I-70"} ${historical ? "Observed" : "Current"}`;
  }
  updateChartCopy();
}
