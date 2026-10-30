function dashboardReadKey(path) {
  if (path === DASHBOARD_RUNTIME.healthPath) return "health";
  const url = new URL(path, "https://dashboard.invalid");
  if (url.searchParams.has("asOf")) url.searchParams.set("asOf", String(Date.parse(url.searchParams.get("asOf"))));
  url.searchParams.sort();
  return url.pathname.replace(DASHBOARD_RUNTIME.apiBase, "") + "?" + [...url.searchParams]
    .map(([key, value]) => `${key}=${value}`).join("&");
}

function acceptDashboardSections(sections, historical = false) {
  const reads = new Map();
  for (const [key, section] of Object.entries(sections || {})) {
    const previous = state.readSections.get(key) || [...state.readSections.values()].find(value => value.version === section.version);
    if (!historical && key === "/traffic/database/observations?") window.StoredObservations?.receive(section, previous);
    if (section.status !== 200 || !section.version || (section.data === undefined && previous?.version !== section.version)) {
      const error = new Error(`Dashboard data ${key.split("?")[0]} returned ${section.status}. Select Sync now to retry.`);
      error.status = section.status === 200 ? 503 : section.status;
      reads.set(key, {error});
      continue;
    }
    const current = section.data === undefined ? previous : section;
    // The graph buffer owns historical observations; only baseline hints need long-lived reuse here.
    if (!historical || key.includes("/baselines?")) {
      state.readSections.delete(key);
      state.readSections.set(key, current);
    }
    reads.set(key, current);
  }
  while (state.readSections.size > 96) state.readSections.delete(state.readSections.keys().next().value);
  return async path => {
    const section = reads.get(dashboardReadKey(path));
    if (!section || section.error) throw section?.error || new Error("Dashboard response is incomplete. Select Sync now to retry.");
    return section.data;
  };
}


function dashboardSnapshotReader(reader) {
  return async path => {
    if (!HISTORICAL_MODE && path.includes("/incidents/recent?")) {
      const url = new URL(path, "https://dashboard.invalid");
      const corridor = url.searchParams.get("corridor");
      const shared = await reader(dashboardApi(`/traffic/map/incidents/shared?corridor=${corridor}`));
      if (shared.truncated) return reader(path);
      const cutoff = Date.now() - Number(url.searchParams.get("windowMinutes")) * 60_000;
      return { features: (shared.features || []).filter(feature => {
        const p = feature.properties || {};
        return (p.eventActive === true || dateMillis(p.lastSeenAt) >= cutoff)
          && (p.corridorActive === true || dateMillis(p.lastMatchedAt) >= cutoff);
      }), truncated: false };
    }
    return reader(path);
  };
}

async function dashboardSnapshotBatch(ranges, signal) {
  const reader = await readDashboardBatch(dashboardApi(`/traffic/dashboard/snapshot?ranges=${ranges.join(",")}`
    + `&selectedHours=${state.selectedHours}&historical=${HISTORICAL_MODE}`), signal);
  const requestJson = dashboardSnapshotReader(reader);
  return new Map(await Promise.all(ranges.map(async hours => [hours,
    await loadLiveDashboardData(hours, {preload: true, requestJson})])));
}

async function hydrateDashboardBootstrap() {
  if (DEMO_MODE || HISTORICAL_MODE || REPLAY_MODE) return;
  const node = document.getElementById("dashboardBootstrap");
  if (!node?.textContent) return;
  try {
    const reader = acceptDashboardSections(JSON.parse(node.textContent));
    const snapshot = await loadLiveDashboardData(24, {preload: true, requestJson: dashboardSnapshotReader(reader)});
    if (snapshot.routeData.size) {
      state.snapshots.set(24, snapshot); state.lastSyncedAt = new Date();
      applyDashboardSnapshot(24);
    }
  } catch { /* The normal snapshot read also handles an unavailable bootstrap. */ }
}

async function loadLiveDashboardSnapshots() {
  const controller = new AbortController();
  state.syncController = controller;
  try {
    let snapshots = new Map();
    if (!state.snapshots.size) {
      snapshots = await dashboardSnapshotBatch([state.selectedHours], controller.signal);
      if ([...snapshots.values()].some(snapshot => snapshot.routeData?.size)) {
        state.snapshots = snapshots; state.lastSyncedAt = new Date();
        applyDashboardSnapshot(state.selectedHours);
      }
    }
    const remaining = DASHBOARD_RANGE_HOURS.filter(hours => !snapshots.has(hours));
    if (remaining.length) {
      const warmed = await dashboardSnapshotBatch(remaining, controller.signal);
      snapshots = new Map([...snapshots, ...warmed]);
    }
    if (![...snapshots.values()].some(snapshot => snapshot.routeData?.size > 0)) {
      throw new Error("Dashboard sync failed. Select Sync now to retry.");
    }
    return new Map(DASHBOARD_RANGE_HOURS.filter(hours => snapshots.has(hours)).map(hours => [hours, snapshots.get(hours)]));
  } finally { if (state.syncController === controller) state.syncController = null; }
}

function mergeDashboardSnapshots(previousSnapshots, nextSnapshots) {
  if (!(previousSnapshots instanceof Map) || previousSnapshots.size === 0) return nextSnapshots;
  const merged = new Map();
  for (const hours of DASHBOARD_RANGE_HOURS) {
    const previous = previousSnapshots.get(hours);
    const next = nextSnapshots.get(hours);
    if (!next) {
      if (previous) merged.set(hours, previous);
      continue;
    }
    if (!previous) {
      merged.set(hours, next);
      continue;
    }
    const routeData = new Map();
    for (const corridor of CORRIDOR_IDS) {
      const previousRoute = previous.routeData?.get(corridor);
      const nextRoute = next.routeData?.get(corridor);
      if (nextRoute && previousRoute) routeData.set(corridor, mergeRouteData(previousRoute, nextRoute));
      else if (nextRoute || previousRoute) routeData.set(corridor, nextRoute || previousRoute);
    }
    const corridorFeatures = new Map(next.corridorFeatures || []);
    for (const corridor of CORRIDOR_IDS) {
      if (!corridorFeatures.has(corridor) && previous.corridorFeatures?.has(corridor)) {
        corridorFeatures.set(corridor, previous.corridorFeatures.get(corridor));
      }
    }
    merged.set(hours, {
      ...next,
      routeData,
      corridorFeatures
    });
  }
  return merged;
}

function mergeRouteData(previous, next) {
  const available = next.syncAvailability || {};
  const merged = { ...next };
  const preserve = (availableKey, ...fieldNames) => {
    if (available[availableKey] !== false) return;
    for (const fieldName of fieldNames) merged[fieldName] = previous[fieldName];
  };
  preserve("summary", "summary", "dataAnchor");
  preserve("trend", "trend");
  preserve("incidents", "incidentFeatures", "incidentThreads", "incidentsAvailable", "incidentsTruncated");
  preserve("zones", "zones");
  preserve("zoneBaseline", "zoneBaseline");
  preserve("history", "history");
  preserve("baseline", "baseline");
  preserve("currentFlowCells", "currentFlowCells");
  preserve("flowCells", "flowCells");
  preserve("dailyZones", "dailyZones");
  preserve("variableSpeedSigns", "variableSpeedSigns");
  return merged;
}
