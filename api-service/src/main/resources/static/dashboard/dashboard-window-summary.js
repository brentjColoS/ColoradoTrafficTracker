(() => {
  const cache = new Map();
  let key = null, selection = null, timer = null, controller = null, generation = 0;
  let values = null, phase = "current", paused = false;
  let lastEnd = null;
  let busyRetries = 0;
  let settleMs = 150;

  function navigation(input) { settleMs = input === "wheel" ? 150 : 50; }

  function cancel() {
    window.clearTimeout(timer); timer = null;
    controller?.abort(); controller = null; generation++;
  }

  function render(corridor) {
    const prefix = CORRIDOR_CONFIG[corridor].summaryPrefix;
    const card = document.getElementById(`${prefix}Summary`);
    card?.setAttribute("aria-busy", String(phase === "pending"));
    card?.setAttribute("data-summary-mode", "historical");
    const labels = {AverageSpeed:"Window Avg Speed", TravelTime:"Avg Travel Time", FastestTravelTime:"Fastest in window",
      SlowestTravelTime:"Slowest in window", Incidents:"Observed Incidents", WorstSegment:"Slowest Avg Zone"};
    for (const [name, label] of Object.entries(labels)) setText(`${prefix}${name}Label`, label);
    const value = values?.[corridor];
    for (const [field, property] of [["AverageSpeed","averageSpeed"],["TravelTime","averageTravelMinutes"],
      ["FastestTravelTime","fastestTravelMinutes"],["SlowestTravelTime","slowestTravelMinutes"]]) {
      setText(`${prefix}${field}`, formatMetricNumber(value?.[property], 0));
    }
    setText(`${prefix}ActiveIncidents`, value?.incidentsAvailable && Number.isFinite(value.observedIncidents)
      ? String(value.observedIncidents) : "—");
    setText(`${prefix}WorstMileMarker`, value?.worstZone ? formatZoneMileMarkerRange(value.worstZone) : "—");
    setText(`${prefix}WorstSpeed`, Number.isFinite(value?.worstZone?.speedMph) ? `${Math.round(value.worstZone.speedMph)} mph` : "");
    const partial = value && (!value.speedAvailable || !value.zonesAvailable || !value.incidentsAvailable);
    const status = phase === "pending" ? "Loading selected window after the graph" : value?.busy ? "Summary read capacity is busy; select Sync now to retry" : phase === "error" ? "Window summary unavailable; select Sync now to retry"
      : partial ? "Some window values unavailable; select Sync now to retry" : "Observed data in the selected window";
    const frame = selection ? `${HISTORY_WINDOW_FORMATTER.format(new Date(selection.end - selection.hours * 3_600_000))} → ${HISTORY_WINDOW_FORMATTER.format(new Date(selection.end))}` : "";
    card?.setAttribute("title", `${status}. ${frame}`);
    const bucket = value?.bucketMinutes;
    const corridorEstimate = value?.travelMethod === "CORRIDOR_AVERAGES";
    const travel = document.getElementById(`${prefix}TravelTimeLabel`);
    if (travel) travel.title = corridorEstimate
      ? "Average estimated travel time from corridor distance and each retained corridor-average speed; not measured vehicle journeys."
      : "Average complete end-to-end estimates, adding travel through each observed speed zone; missing coverage is unavailable, not zero.";
    const range = document.getElementById(`${prefix}TravelTimeRange`);
    if (range) range.title = corridorEstimate
      ? "Fastest and slowest distance / speed estimates from valid retained corridor observations in this window, not individual vehicle journeys."
      : `Fastest and slowest complete ${bucket || "selected"}-minute zone-bucket estimates in this window, not individual vehicle journeys.`;
    const worst = document.getElementById(`${prefix}WorstSegmentLabel`);
    if (worst) worst.title = "Speed zone with the lowest observation-weighted average speed in this window, not today's half-mile segment.";
  }

  function paint() { for (const corridor of CORRIDOR_IDS) render(corridor); }

  function ready() {
    if (window.ContinuousHistory?.moving) return false;
    return selection.corridors.every(corridor => {
      const route = chartRouteData(corridor);
      if (!route || route.chartUnavailable) return false;
      if (!window.ContinuousHistory?.active) return chartHistory.dataKey === historyWindowKey();
      let coveredUntil = selection.end - selection.hours * 3_600_000;
      for (const part of [...(route.parts || [])].filter(part => !part.value.chartUnavailable).sort((a,b)=>a.start-b.start)) {
        if (part.start > coveredUntil + 60_000) break;
        coveredUntil = Math.max(coveredUntil, part.end);
      }
      return coveredUntil >= selection.end - 60_000;
    });
  }

  async function read() {
    timer = null;
    if (paused || document.hidden || chartHistory.disposed || !selection || !ready()) return;
    const mine = generation, selected = selection, requestedKey = key;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const path = dashboardApi(`/traffic/dashboard/window-summary?corridors=${selected.corridors.join(",")}`
        + `&hours=${selected.hours}&asOf=${encodeURIComponent(new Date(selected.end).toISOString())}`);
      const result = DEMO_MODE ? demo(selected) : await fetchDashboardBatch(path, signal, {priority:2, background:true});
      if (signal.aborted || mine !== generation || requestedKey !== key || paused || document.hidden) return;
      for (const corridor of selected.corridors) {
        const value = result?.[corridor];
        if (!value || value.corridor !== corridor || value.hours !== selected.hours || dateMillis(value.end) !== selected.end
            || dateMillis(value.start) !== selected.end - selected.hours * 3_600_000) throw new Error("Mismatched window summary");
      }
      if (selected.corridors.some(corridor => result[corridor].busy) && busyRetries < 1) {
        values = result; paint(); busyRetries++; timer = window.setTimeout(read, 1000); return;
      }
      values = result; phase = "ready";
      cache.set(key, {values, fetchedAt:Date.now(), partial:selected.corridors.some(corridor =>
        !values[corridor].speedAvailable || !values[corridor].zonesAvailable || !values[corridor].incidentsAvailable)});
      while (cache.size > 32) cache.delete(cache.keys().next().value);
      paint();
    } catch (error) {
      if (!signal.aborted && mine === generation && requestedKey === key) { values = null; phase = "error"; paint(); }
    } finally { if (mine === generation) controller = null; }
  }

  function demo(selected) {
    return Object.fromEntries(selected.corridors.map(corridor => {
      const route = buildDemoRouteData(corridor, new Date(selected.end));
      const period = periodCorridorMetrics(route, CORRIDOR_CONFIG[corridor].distanceMiles, selected.hours);
      const worst = period.slowestAverageZone;
      return [corridor, {...period, corridor, start:new Date(selected.end-selected.hours*3_600_000).toISOString(),
        end:new Date(selected.end).toISOString(), hours:selected.hours, bucketMinutes:selected.hours===720?180:selected.hours===168?60:15,
        observedIncidents:route.incidentThreads.length, incidentsAvailable:true,speedAvailable:true,zonesAvailable:true,
        worstZone:worst?{startMileMarker:worst.startMileMarker,endMileMarker:worst.endMileMarker,speedMph:worst.avgCurrentSpeed}:null}];
    }));
  }

  function schedule(force = false) {
    if (paused || document.hidden || chartHistory.disposed) return;
    if (chartHistory.endTime === null) {
      if (key !== null) {
        cancel(); key = null; selection = null; values = null; phase = "current"; lastEnd = null;
        for (const corridor of CORRIDOR_IDS) {
          const card = document.getElementById(`${CORRIDOR_CONFIG[corridor].summaryPrefix}Summary`);
          card?.setAttribute("aria-busy", "false"); card?.removeAttribute("data-summary-mode"); card?.removeAttribute("title");
          renderCorridorSummary(corridor, state.routeData.get(corridor));
        }
      }
      return;
    }
    const end = Math.floor(chartHistory.endTime / 60_000) * 60_000;
    if (lastEnd !== chartHistory.endTime) { window.clearTimeout(timer); timer = null; lastEnd = chartHistory.endTime; }
    const next = `${historyCorridors().join(",")}|${state.selectedHours}|${end}`;
    if (next !== key || force) {
      cancel(); key = next; busyRetries = 0;
      if (force) cache.delete(key);
      selection = {end, hours:state.selectedHours, corridors:[...historyCorridors()]};
      const previous = force ? null : cache.get(key);
      const lifetime = previous?.partial ? 5000 : end > Date.now()-3_600_000 ? 60_000 : 600_000;
      values = previous && Date.now()-previous.fetchedAt < lifetime ? previous.values : null;
      phase = values ? "ready" : "pending"; paint();
    }
    if (phase === "pending" && timer === null && controller === null && ready()) timer = window.setTimeout(read, force ? 50 : settleMs);
  }

  function pause() { paused = true; cancel(); if (key !== null && phase === "pending") values = null; }
  function resume() { paused = false; schedule(); }
  window.addEventListener("pagehide", pause);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", () => document.hidden ? pause() : resume());
  window.HistoricalSummary = {schedule, render, pause, resume, navigation};
})();
