window.ContinuousHistory = (() => {
  const options = new URLSearchParams(window.location.search);
  const experimental = window.location.pathname.startsWith("/dashboard-experimental/");
  const active = options.has("continuous") ? options.get("continuous") === "1" : experimental;
  const prepared = active && (options.has("prepared") ? options.get("prepared") === "1" : experimental);
  let chunks = new Map();
  const buffers = new Map(), scenes = new Map(), domains = new Map(), rows = new Map();
  const axisTargets = new Map();
  let axisTimer = null, axisStep = 0;
  let scope = "", anchor = 0, target = null, frameId = null, lastFrame = 0, lastUi = 0;
  let controller = null, timer = null, version = 0, lastRead = 0, merged = null;
  let failed = new Set(), notice = "", disposed = false;
  let speculativeAfter = 0, timerPriority = 0, timerDue = 0;
  let previousRange = "";
  const warmAttempts = new Set();
  const preparation = new Set(), preparedAttempts = new Set();
  let cursorIntent = null;
  const span = () => state.selectedHours * 3_600_000;
  const scopeKey = () => `${(prepared ? CORRIDOR_IDS : historyCorridors()).join(",")}|${state.chartView}|${state.selectedHours}`;
  const latest = () => Math.floor(historyLatestTime() / 60_000) * 60_000;
  const end = () => chartHistory.endTime ?? latest();
  const running = () => active && !disposed && !chartHistory.disposed && !document.hidden;

  function stop(keepDispatched = false) {
    if (frameId !== null) window.cancelAnimationFrame?.(frameId);
    frameId = null;
    window.clearTimeout(timer); timer = null;
    if (!keepDispatched || !controller?.dispatched) {
      controller?.abort.abort(); controller = null;
    }
    stopAxisFit();
    lastFrame = 0;
  }

  function chartSeed(data) {
    if (!prepared) return new Map(data);
    return new Map([...data].map(([corridor, route]) => [corridor, Object.fromEntries([
      "trend", "history", "zones", "baseline", "zoneBaseline", "incidentThreads",
      "chartPartial", "chartUnavailable", "chartIssues", "chartNote"
    ].map(field => [field, route[field]]))]));
  }

  function initialize() {
    if (scope === scopeKey() && anchor && (chunks.size || !state.routeData.size)) return;
    stop(chartHistory.endTime !== null && scope.split("|")[0] === scopeKey().split("|")[0]);
    if (scope && scope.split("|")[0] === scopeKey().split("|")[0]
        && scope.split("|")[2] !== String(state.selectedHours)) previousRange = scope;
    else if (scope.split("|")[0] !== scopeKey().split("|")[0]) previousRange = "";
    scope = scopeKey();
    let buffer = buffers.get(scope);
    if (!buffer) {
      buffer = {anchor: Math.floor(historyLatestTime() / 60_000) * 60_000, chunks: new Map(), failed: new Set(), skipped: new Set()};
    }
    buffers.delete(scope); buffers.set(scope, buffer);
    while (buffers.size > (prepared ? 10 : 3)) buffers.delete(buffers.keys().next().value);
    anchor = buffer.anchor; chunks = buffer.chunks; failed = buffer.failed;
    scenes.clear(); domains.clear(); rows.clear();
    merged = null; notice = failed.size ? "Some adjacent history is unavailable. Choose Retry or Current." : "";
    version++;
    target = chartHistory.endTime;
    if (!chunks.has(0) && state.routeData.size && latest() === anchor && !buffer.skipped.has(0)) {
      chunks.set(0, { start: anchor - span(), end: anchor, data: chartSeed(state.routeData), seed: true });
      trimBuffers();
    }
    retainCurrent();
  }

  function recordCount(chunk) {
    return [...chunk.data.values()].reduce((total, data) => total + (data.trend?.buckets?.length || 0)
      + (data.history?.samples?.length || 0) + (data.zones?.length || 0) + (data.incidentThreads?.length || 0)
      + (data.baseline?.profiles?.length || 0) + (data.zoneBaseline?.zones || []).reduce((n, zone) => n + (zone.profiles?.length || 0), 0), 0);
  }

  function retainedRecords() {
    const records = new Set();
    for (const buffer of buffers.values()) for (const chunk of buffer.chunks.values()) {
      for (const data of chunk.data.values()) {
        for (const list of [data.trend?.buckets, data.history?.samples, data.zones, data.incidentThreads,
          data.baseline?.profiles, ...(data.zoneBaseline?.zones || []).map(zone => zone.profiles)]) {
          for (const value of list || []) records.add(value);
        }
      }
    }
    return records.size;
  }

  function prepare() {
    if (!prepared || !running() || !DASHBOARD_RANGE_HOURS.every(hours => state.snapshots.has(hours))) return;
    initialize();
    for (const hours of DASHBOARD_RANGE_HOURS) for (const view of ["overall", "zones"]) {
      const key = `${CORRIDOR_IDS.join(",")}|${view}|${hours}`;
      // Prepare once per session. Syncing the live snapshot must not restart a history sweep.
      if (preparation.has(key)) continue;
      preparation.add(key);
      const buffer = buffers.get(key) || {anchor, chunks: new Map(), failed: new Set(), skipped: new Set()};
      if (!buffer.chunks.has(0)) buffer.chunks.set(0, {start: buffer.anchor - hours * 3_600_000,
        end: buffer.anchor, data: chartSeed(state.snapshots.get(hours).routeData), seed: true});
      buffers.set(key, buffer);
    }
    trimBuffers();
    if (chartHistory.bounds === null) void loadHistoryCoverage();
    ensure();
  }

  function preparedSelection() {
    for (const key of [scope, ...preparation]) {
      if (!preparation.has(key)) continue;
      const buffer = buffers.get(key);
      if (!buffer) continue;
      const [corridors, view, hoursText] = key.split("|"), hours = Number(hoursText);
      const field = view === "zones" ? "firstZoneObservedAt" : "firstObservedAt";
      for (const index of hours === 2 ? [1, 2, 3] : [1]) {
        if (preparedAttempts.has(`${key}|${index}`) || buffer.chunks.has(index)
            || buffer.failed.has(index) || buffer.skipped.has(index)) continue;
        const edge = buffer.anchor - index * hours * 3_600_000;
        if (!corridors.split(",").some(corridor => {
          const first = dateMillis(chartHistory.bounds?.get(corridor)?.[field]);
          return Number.isFinite(first) && first > 0 && first < edge;
        })) continue;
        return {key, buffer, index, hours, view, corridors: corridors.split(","), priority: 2, preparing: true};
      }
    }
    return null;
  }

  function preparationStatus() {
    let ready = 0, total = 0;
    for (const key of preparation) {
      const buffer = buffers.get(key), [, view, hoursText] = key.split("|"), hours = Number(hoursText);
      const field = view === "zones" ? "firstZoneObservedAt" : "firstObservedAt";
      for (const index of hours === 2 ? [1, 2, 3] : [1]) {
        if (!CORRIDOR_IDS.some(corridor => {
          const first = dateMillis(chartHistory.bounds?.get(corridor)?.[field]);
          return Number.isFinite(first) && first > 0 && first < (buffer?.anchor || anchor) - index * hours * 3_600_000;
        })) continue;
        total++;
        if (buffer?.chunks.has(index) && !buffer.failed.has(index)) ready++;
      }
    }
    return {ready, total};
  }

  function retainCurrent() {
    const current = latest();
    if (current <= anchor || !state.routeData.size) return;
    // Overlay the fresh live window without moving the fixed historical chunk grid.
    chunks.set("live", {start: current - span(), end: current, data: chartSeed(state.routeData), seed: true});
    merged = null; scenes.clear(); version++; trimBuffers();
  }

  function trimBuffers() {
    const total = () => prepared ? retainedRecords() : [...buffers.values()].reduce((sum, buffer) => sum
      + [...buffer.chunks.values()].reduce((n, chunk) => n + recordCount(chunk), 0), 0);
    const count = () => [...buffers.values()].reduce((n, buffer) => n + buffer.chunks.size, 0);
    while (chunks.size > 12 || count() > (prepared ? 32 : 24) || total() > 60_000) {
      const candidates = [...buffers].flatMap(([key, buffer], order) => {
        if (chunks.size > 12 && key !== scope) return [];
        const width = Number(key.split("|")[2]) * 3_600_000;
        const cursor = key === scope ? end() : buffer.cursor ?? buffer.anchor;
        return [...buffer.chunks].filter(([, chunk]) => key !== scope
          || chunk.end <= end() - span() || chunk.start >= end())
          .map(([index, chunk]) => ({key, buffer, index, order,
            distance: Math.abs((chunk.start + chunk.end) / 2 - cursor) / width}));
      });
      candidates.sort((a, b) => Number(a.key === scope) - Number(b.key === scope)
        || b.distance - a.distance || a.order - b.order);
      const farthest = candidates[0];
      // Keep the visible interval even if one unusually large response exceeds the record target.
      if (farthest === undefined) break;
      farthest.buffer.chunks.delete(farthest.index); farthest.buffer.failed.delete(farthest.index);
      farthest.buffer.skipped.add(farthest.index);
      while (farthest.buffer.skipped.size > 24) {
        farthest.buffer.skipped.delete(farthest.buffer.skipped.values().next().value);
      }
    }
  }

  function covered(buffer, start, finish) {
    if (finish <= start) return true;
    let cursor = start;
    for (const chunk of [...buffer.chunks.values()].sort((a, b) => a.start - b.start)) {
      if (chunk.end <= cursor) continue;
      if (chunk.start > cursor) return false;
      cursor = Math.max(cursor, chunk.end);
      if (cursor >= finish) return true;
    }
    return false;
  }

  function needed() {
    const position = (anchor - end()) / span();
    const first = Math.floor(position);
    const indices = [first];
    if (position - first > 0.000001) indices.push(first + 1);
    for (let preload = first + 1; chartHistory.enabled && preload <= first + 3; preload++) {
      if (!indices.includes(preload)) indices.push(preload);
    }
    if (chartHistory.enabled) indices.push(first - 1);
    return indices.filter(index => {
      const finish = Math.min(anchor - index * span(), latest()), start = finish - span();
      const visible = index === first || (position > first && index === first + 1);
      return finish >= historyLimits().firstEnd - span()
        && !covered(buffers.get(scope), visible ? Math.max(end() - span(), start) : start,
          visible ? Math.min(end(), finish) : finish)
        && (visible || !buffers.get(scope).skipped.has(index));
    });
  }

  function warmSelection() {
    if (chartHistory.endTime === null || target !== chartHistory.endTime) return null;
    const corridorKey = historyCorridors().join(",");
    const companion = state.focusedCorridor === "ALL" ? ""
      : `${corridorKey}|${state.chartView === "zones" ? "overall" : "zones"}|${state.selectedHours}`;
    for (const key of [companion, previousRange].filter(key => key && key !== scope)) {
      const [corridors, view, hoursText] = key.split("|");
      const hours = Number(hoursText), width = hours * 3_600_000;
      const time = historyEndForRange(hours, view) ?? latest();
      const field = view === "zones" ? "firstZoneObservedAt" : "firstObservedAt";
      if (!corridors.split(",").some(corridor => {
        const first = dateMillis(chartHistory.bounds?.get(corridor)?.[field]);
        return Number.isFinite(first) && first > 0 && first <= time;
      })) continue;
      let buffer = buffers.get(key);
      if (!buffer) {
        if (warmAttempts.has(`${key}|${time}`)) continue;
        buffer = {anchor: time, chunks: new Map(), failed: new Set(), skipped: new Set()};
        buffers.set(key, buffer);
        while (buffers.size > 3) {
          const oldest = [...buffers.keys()].find(value => value !== scope && value !== key);
          buffers.delete(oldest);
        }
      }
      const position = (buffer.anchor - time) / width;
      const index = [...new Set([Math.floor(position), Math.ceil(position)])]
        .find(value => value >= Math.ceil((buffer.anchor - latest()) / width)
          && !buffer.chunks.has(value) && !buffer.failed.has(value) && !buffer.skipped.has(value)
          && !warmAttempts.has(`${key}|${buffer.anchor - value * width}`));
      if (index !== undefined) return {key, buffer, index, hours, view, corridors: corridors.split(","), priority: 2};
    }
    return null;
  }

  function cursorSelection() {
    if (!prepared || !chartHistory.enabled || chartHistory.endTime === null
        || target !== chartHistory.endTime) return null;
    const midpoint = end() - span() / 2;
    const identity = `${Math.floor(midpoint / 60_000)}|${state.chartView}`;
    if (cursorIntent?.identity !== identity) cursorIntent = {identity, attempts: new Set(), readyAt: Date.now() + 350};
    if (cursorIntent.attempts.size >= 3) return null;
    const corridorKey = CORRIDOR_IDS.join(",");
    const companion = state.focusedCorridor === "ALL" ? ""
      : `${corridorKey}|${state.chartView === "zones" ? "overall" : "zones"}|${state.selectedHours}`;
    const ranges = state.selectedHours >= 168 ? [24, 6] : state.selectedHours === 24 ? [6, 2] : [24, 2];
    const keys = [...new Set([...ranges.map(hours => `${corridorKey}|${state.chartView}|${hours}`), previousRange, companion])];
    for (const key of keys.filter(key => key && key !== scope)) {
      const [corridors, view, hoursText] = key.split("|"), hours = Number(hoursText);
      const time = historyEndForRange(hours, view) ?? latest();
      const buffer = buffers.get(key);
      if (!buffer || covered(buffer, time - hours * 3_600_000, time)) continue;
      const field = view === "zones" ? "firstZoneObservedAt" : "firstObservedAt";
      if (!corridors.split(",").some(corridor => {
        const first = dateMillis(chartHistory.bounds?.get(corridor)?.[field]);
        return Number.isFinite(first) && first > 0 && first < time;
      })) continue;
      const index = `cursor:${time}`, token = `${key}|${time}`;
      if (buffer.failed.has(index) || buffer.skipped.has(index) || warmAttempts.has(token)
          || cursorIntent.attempts.has(token)) continue;
      return {key, buffer, index, hours, view, corridors: corridors.split(","), priority: 2,
        requestedEnd: time, intent: cursorIntent, notBefore: cursorIntent.readyAt};
    }
    return null;
  }

  function ensure() {
    if (!running() || (!chartHistory.enabled && chartHistory.endTime === null && !prepared)
        || (prepared ? chartHistory.bounds === null : !historyLimits().available)) return;
    buffers.get(scope).cursor = end();
    const missing = (chartHistory.enabled || chartHistory.endTime !== null) && historyLimits().available
      ? needed().filter(value => !failed.has(value)) : [];
    const index = missing[0];
    const position = (anchor - end()) / span();
    const priority = index === Math.floor(position) || index === Math.ceil(position) ? 1 : 2;
    // Prepare the visible window and one older interval before warming alternate views.
    const warm = priority !== 1 ? prepared ? cursorSelection() || preparedSelection()
      : chunks.has(Math.floor(position) + 1) ? warmSelection() : null : null;
    const selection = warm || (index === undefined ? null : {key: scope, buffer: buffers.get(scope), index,
      hours: state.selectedHours, view: state.chartView, corridors: prepared ? CORRIDOR_IDS : historyCorridors(), priority});
    if (controller) {
      if (controller.dispatched || (selection && controller.key === selection.key
          && controller.index === selection.index && controller.priority === selection.priority)) return;
      const obsolete = controller; controller = null;
      obsolete.abort.abort();
    }
    if (!selection) { window.clearTimeout(timer); timer = null; return; }
    const wait = selection.priority === 1 ? 0 : Math.max(0,
      selection.preparing || selection.intent ? 0 : lastRead + 4000 - Date.now(),
      (selection.notBefore || 0) - Date.now(), speculativeAfter - Date.now());
    if (timer !== null) {
      if (timerPriority <= selection.priority && timerDue <= Date.now() + wait) return;
      window.clearTimeout(timer); timer = null;
    }
    if (wait) {
      timerPriority = selection.priority; timerDue = Date.now() + wait;
      timer = window.setTimeout(() => { timer = null; ensure(); }, wait);
      return;
    }
    if (chartHistory.rateUntil > Date.now()) {
      updateHistoryControls();
      return;
    }
    void read(selection);
  }

  async function read({key, buffer, index, priority, hours, view, corridors, preparing = false, requestedEnd, intent}) {
    const width = hours * 3_600_000;
    const chunkEnd = Math.min(requestedEnd ?? buffer.anchor - index * width, latest());
    const abort = new AbortController();
    const pending = {abort, key, index, priority, dispatched: false, startedAt: null}; controller = pending;
    const options = {priority, onDispatch() {
      pending.dispatched = true; pending.startedAt = lastRead = Date.now();
      if (preparing) preparedAttempts.add(`${key}|${index}`);
      if (intent) { intent.attempts.add(`${key}|${chunkEnd}`); buffer.cursor = chunkEnd; }
      if (key !== scope) {
        warmAttempts.add(`${key}|${chunkEnd}`);
        while (warmAttempts.size > 24) warmAttempts.delete(warmAttempts.values().next().value);
      }
    },
      onQueued: updateHistoryControls};
    if (DEMO_MODE) options.onDispatch();
    try {
      const results = await Promise.all(corridors.map(async corridor => {
        try {
          const route = DEMO_MODE ? buildDemoDashboardData(hours, new Date(chunkEnd)).routeData.get(corridor)
            : await loadChartHistoryRoute(corridor, hours, chunkEnd, view, abort.signal, options);
          return [corridor, route];
        } catch (error) {
          if (abort.signal.aborted) throw error;
          if (error.status === 429) {
            const seconds = Number(error.retryAfter);
            const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.parse(error.retryAfter) - Date.now();
            chartHistory.rateUntil = Math.max(chartHistory.rateUntil, Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60_000));
          }
          return [corridor, { chartUnavailable: true, chartPartial: true, chartIssues: [`${corridor} adjacent history unavailable`] }];
        }
      }));
      if (abort.signal.aborted || buffers.get(key) !== buffer || !running()) return;
      const data = new Map(results);
      buffer.chunks.set(index, { start: chunkEnd - width, end: chunkEnd, data });
      trimBuffers();
      if ([...data.values()].some(value => value.chartPartial)) {
        buffer.failed.add(index);
      }
      if (key === scope) {
        version++; merged = null; scenes.clear();
        notice = failed.size ? "Some adjacent history is unavailable. Gaps are not filled. Choose Retry or Current." : "";
      }
    } catch (error) {
      if (!abort.signal.aborted && buffers.get(key) === buffer && running()) {
        buffer.failed.add(index);
        if (key === scope) notice = "Adjacent history could not load. Choose Retry or Current; loaded observations remain available.";
      }
    } finally {
      if (preparing && abort.signal.aborted) preparedAttempts.delete(`${key}|${index}`);
      if (intent && abort.signal.aborted) {
        intent.attempts.delete(`${key}|${chunkEnd}`); warmAttempts.delete(`${key}|${chunkEnd}`);
      }
      if (pending.startedAt !== null && !abort.signal.aborted) {
        const elapsed = Date.now() - pending.startedAt;
        if (elapsed >= 2000) speculativeAfter = Date.now() + Math.min(30_000, elapsed * 2);
      }
      if (controller === pending) controller = null;
      if (running()) {
        updateHistoryControls();
        if (key === scope) drawAllCharts();
        ensure();
      }
    }
  }

  function unique(values, key) {
    return [...new Map(values.map(value => [key(value), value])).values()];
  }

  function zoneIdentity(zone) {
    return `${zone.zoneKey}|${zone.startMileMarker}|${zone.endMileMarker}|${zone.postedSpeedMph}`;
  }

  function route(corridor) {
    initialize();
    if (!merged) merged = new Map();
    if (merged.has(corridor)) return merged.get(corridor);
    const parts = [...chunks.values()].sort((a, b) => a.end - b.end)
      .flatMap(chunk => chunk.data.has(corridor) ? [{...chunk, value: chunk.data.get(corridor)}] : []);
    const usable = parts.filter(part => !part.value.chartUnavailable);
    if (!usable.length) return null;
    const inChunk = (part, point) => {
      const timestamp = dateMillis(point.polledAt || point.bucketStart);
      return timestamp >= part.start && timestamp <= part.end;
    };
    const all = field => usable.flatMap(part => (field(part.value) || []).filter(point => inChunk(part, point)));
    const zones = all(value => value.zones).map(row => ({...row, zoneKey: zoneIdentity(row)}));
    const value = {
      trend: {buckets: unique(all(value => value.trend?.buckets), row => row.bucketStart)},
      history: {samples: unique(all(value => value.history?.samples), row => row.polledAt)},
      continuousSamples: unique(usable.flatMap(part => buildCurrentSpeedSeries(part.value.trend?.buckets || [],
        state.selectedHours <= 24 ? part.value.history?.samples || [] : [], state.selectedHours, part.end)),
        point => point.timestamp).sort((a, b) => a.timestamp - b.timestamp),
      zones: unique(zones, row => `${row.zoneKey}|${row.bucketStart || row.polledAt}`),
      baseline: usable.at(-1).value.baseline, zoneBaseline: {zones: []},
      incidentThreads: unique(usable.flatMap(part => part.value.incidentThreads || []), row => `${row.id}|${row.firstSeenAt}`),
      parts, chartPartial: parts.some(part => part.value.chartPartial),
      chartNote: [...new Set(parts.map(part => part.value.chartNote).filter(Boolean))].join(" ")
    };
    merged.set(corridor, value);
    if (state.chartView === "zones") value.layoutGroups = zoneGroups(corridor, value,
      Math.min(...usable.map(part => part.start)), Math.max(...usable.map(part => part.end)));
    return value;
  }

  function baseline(route, start, finish, zoneKey = null) {
    const points = [];
    for (const part of route.parts) {
      const left = Math.max(start, part.start), right = Math.min(finish, part.end);
      if (right < left || part.value.chartUnavailable) continue;
      const profiles = zoneKey === null ? part.value.baseline?.profiles
        : part.value.zoneBaseline?.zones?.find(zone => zoneIdentity(zone) === zoneKey)?.profiles;
      const buckets = zoneKey === null ? part.value.trend?.buckets || [] : [];
      points.push(...buildBaselineSeries(buckets, left, right, profiles || []));
    }
    return unique(points, point => point.timestamp).sort((a, b) => a.timestamp - b.timestamp);
  }

  function stableDomain(key, samples, reference, posted) {
    const values = samples.map(point => point.speed);
    for (const point of reference) values.push(point.speed);
    if (Number.isFinite(posted)) values.push(posted);
    const proposed = calculateSpeedDomain(values);
    const previous = domains.get(key);
    if (!previous || proposed.min < previous.min || proposed.max > previous.max) {
      const min = Math.min(previous?.min ?? proposed.min, proposed.min);
      const max = Math.max(previous?.max ?? proposed.max, proposed.max);
      const expanded = {min, max, step: niceSpeedStep((max - min) / 6)};
      domains.set(key, expanded); axisTargets.delete(key);
      return expanded;
    }
    if (proposed.max - proposed.min < (previous.max - previous.min) * 0.8) {
      if (!axisTargets.has(key)) axisTargets.set(key, {from: previous, to: proposed});
      else axisTargets.get(key).to = proposed;
      scheduleAxisFit();
    }
    return previous;
  }

  function stopAxisFit() {
    window.clearTimeout(axisTimer); axisTimer = null; axisStep = 0; axisTargets.clear();
  }

  function scheduleAxisFit() {
    if (axisTimer !== null || !axisTargets.size || target !== chartHistory.endTime) return;
    axisTimer = window.setTimeout(() => {
      axisTimer = null;
      if (!running() || target !== chartHistory.endTime) return;
      const t = ++axisStep / 6, blend = t * t * (3 - 2 * t);
      for (const [key, {from, to}] of axisTargets) {
        const min = from.min + (to.min - from.min) * blend;
        const max = from.max + (to.max - from.max) * blend;
        domains.set(key, {min, max, step: niceSpeedStep((max - min) / 6)});
      }
      scenes.clear(); queueFrame();
      if (axisStep >= 6) {axisTargets.clear(); axisStep = 0;}
      else scheduleAxisFit();
    }, axisStep ? 60 : 180);
  }

  function visiblePoints(points) {
    const start = end() - span(), finish = end();
    const shown = points.filter(point => point.timestamp >= start && point.timestamp <= finish);
    for (const time of [start, finish]) {
      const boundary = speedBoundaryPoint(points, time);
      if (boundary) shown.push(boundary);
    }
    return shown;
  }

  function visibleScale(corridor, samples, reference, posted, trend = []) {
    return stableDomain(corridor, [...visiblePoints(samples), ...visiblePoints(trend)], visiblePoints(reference), posted);
  }

  function reference(corridor, start, finish) {
    const data = route(corridor);
    if (!data) return [];
    return state.chartView === "zones"
      ? data.layoutGroups.flatMap(group => baseline(data, start, finish, group.key))
      : baseline(data, start, finish);
  }

  function zoneGroups(corridor, data, start, finish) {
    let registry = rows.get(corridor);
    if (!registry) { registry = new Map(); rows.set(corridor, registry); }
    const groups = groupZoneSeries(data.zones, (finish - start) / 3_600_000, finish);
    for (const group of groups) registry.set(group.key, {...group, samples: []});
    const byKey = new Map(groups.map(group => [group.key, group]));
    return [...registry.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
      .map(group => byKey.get(group.key) || {...group, samples: [], latestSpeed: NaN});
  }

  function bake(canvas, corridor, data, width, height, direct = false) {
    const zones = state.chartView === "zones";
    const left = zones ? 92 : 50, right = 18;
    const plotWidth = Math.max(1, width - left - right), visibleEnd = end();
    const ratio = direct ? 1 : 2;
    const start = visibleEnd - span() * (1 + (ratio - 1) / 2), finish = visibleEnd + span() * (ratio - 1) / 2;
    const strip = direct ? canvas : document.createElement("canvas");
    if (!direct) strip.getBoundingClientRect = () => ({width: left + plotWidth * ratio + right, height});
    const spec = {end: finish, hours: state.selectedHours * ratio};
    const halo = trendSmoothingHalfWindow(state.selectedHours);
    const nearby = points => points.filter(point => point.timestamp >= start - halo && point.timestamp <= finish + halo);
    let groups = null, baselines = null;
    if (zones) {
      groups = data.layoutGroups.map(group => ({...group,
        samples: clipZoneSpeedSeriesToWindow(group.samples, start, finish)}));
      baselines = new Map(); spec.groups = groups; spec.baselines = baselines; spec.domains = new Map(); spec.trends = new Map();
      for (const group of groups) {
        const source = data.layoutGroups.find(value => value.key === group.key);
        spec.trends.set(group.key, clipSpeedSeriesToWindow(
          buildSmoothedSpeedSeries(nearby(source?.samples || []), state.selectedHours), start, finish));
        const reference = baseline(data, start, finish, group.key);
        baselines.set(group.key, reference);
        spec.domains.set(group.key, visibleScale(`${corridor}|${group.key}`,
          group.samples, reference, group.postedSpeedMph, spec.trends.get(group.key)));
      }
      drawZoneChart(strip, corridor, data, spec);
    } else {
      spec.baseline = baseline(data, start, finish);
      const samples = clipSpeedSeriesToWindow(data.continuousSamples, start, finish);
      spec.samples = samples;
      spec.trendSamples = clipSpeedSeriesToWindow(
        buildSmoothedSpeedSeries(nearby(data.continuousSamples), state.selectedHours), start, finish);
      spec.domain = visibleScale(corridor, samples, spec.baseline, undefined, spec.trendSamples);
      drawCorridorChart(strip, corridor, data, spec);
    }
    return {strip, start, finish, width, height, left, right, plotWidth, groups, baselines, spec, version,
      theme: document.documentElement.dataset.theme, sigma: state.referenceSigma};
  }

  function paint(canvas, corridor) {
    if (!running()) return false;
    const data = route(corridor);
    if (!data) return false;
    const zones = state.chartView === "zones";
    if (zones) {
      const groups = data.layoutGroups;
      canvas.closest?.(".chart-lane")?.style.setProperty("--chart-height", `${Math.max(280, groups.length * 124 + 36)}px`);
    } else canvas.closest?.(".chart-lane")?.style.removeProperty("--chart-height");
    const {width, height} = sizeCanvas(canvas);
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    // Bound raster memory instead of reducing resolution on a large speed-zone graph.
    if ((width * 2 * height * pixelRatio * pixelRatio) > 12_000_000 || width * 2 * pixelRatio > 8192) {
      const scene = bake(canvas, corridor, data, width, height, true);
      markBandOverflow(canvas, scene, width, height);
      return true;
    }
    let scene = scenes.get(corridor);
    if (scene) {
      const same = (a, b) => a.min === b.min && a.max === b.max;
      const matches = scene.groups ? scene.groups.every(group => same(scene.spec.domains.get(group.key),
        visibleScale(`${corridor}|${group.key}`, group.samples,
          scene.baselines.get(group.key), group.postedSpeedMph, scene.spec.trends.get(group.key))))
        : same(scene.spec.domain, visibleScale(corridor, scene.spec.samples, scene.spec.baseline, undefined, scene.spec.trendSamples));
      if (!matches) scene = null;
    }
    if (!scene || scene.version !== version || scene.width !== width || scene.height !== height
        || scene.theme !== document.documentElement.dataset.theme || scene.sigma !== state.referenceSigma
        || end() > scene.finish - span() * 0.1 || end() - span() < scene.start + span() * 0.1) {
      scene = bake(canvas, corridor, data, width, height); scenes.set(corridor, scene);
    }
    const context = canvas.getContext("2d");
    const offset = (end() - span() - scene.start) / span() * scene.plotWidth;
    context.clearRect(0, 0, width, height);
    context.drawImage(scene.strip, (scene.left + offset) * pixelRatio, 0, scene.plotWidth * pixelRatio,
      height * pixelRatio, scene.left, 0, scene.plotWidth, height);
    let coveredUntil = end() - span();
    for (const part of data.parts.filter(part => !part.value.chartUnavailable)) {
      const start = Math.max(end() - span(), part.start), finish = Math.min(end(), part.end);
      if (finish <= start) continue;
      if (start > coveredUntil) context.clearRect(scene.left + (coveredUntil - end() + span()) / span() * scene.plotWidth,
        0, (start - coveredUntil) / span() * scene.plotWidth, height);
      coveredUntil = Math.max(coveredUntil, finish);
    }
    if (coveredUntil < end()) context.clearRect(scene.left + (coveredUntil - end() + span()) / span() * scene.plotWidth,
      0, (end() - coveredUntil) / span() * scene.plotWidth, height);
    if (scene.groups) {
      const descriptors = scene.groups.map(group => ({group,
        last: group.samples.findLast(point => point.timestamp <= end()),
        expected: (scene.baselines.get(group.key) || []).findLast(point => point.timestamp <= end())}));
      const labelKey = descriptors.map(item => `${Math.round(item.last?.speed)}|${Math.round(item.expected?.speed)}`).join(",");
      if (!scene.labels || scene.labelKey !== labelKey) {
        const labels = document.createElement("canvas");
        labels.width = scene.left * pixelRatio; labels.height = height * pixelRatio;
        const labelContext = labels.getContext("2d"); labelContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        labelContext.drawImage(scene.strip, 0, 0, scene.left * pixelRatio, height * pixelRatio, 0, 0, scene.left, height);
        labelContext.clearRect(0, 0, scene.left - 18, height);
        const colors = chartColors(), rowHeight = (height - 36) / scene.groups.length;
        descriptors.forEach(({group, last, expected}, index) => {
          drawSpeedZoneDescriptor(labelContext, {...group, latestSpeed: last?.speed}, expected ? [expected] : [],
            14 + index * rowHeight, Math.max(42, rowHeight - 16), colors, scene.left);
        });
        scene.labels = labels; scene.labelKey = labelKey;
      }
      context.drawImage(scene.labels, 0, 0, scene.left * pixelRatio, height * pixelRatio, 0, 0, scene.left, height);
    } else context.drawImage(scene.strip, 0, 0, scene.left * pixelRatio, height * pixelRatio, 0, 0, scene.left, height);
    markBandOverflow(canvas, scene, width, height);
    return true;
  }

  function markBandOverflow(canvas, scene, width, height) {
    const context = canvas.getContext("2d");
    let markerColor;
    let overflow = false;
    const mark = (baseline, domain, top, height) => {
      const shown = visiblePoints(baseline);
      const upper = shown.some(point => referenceBandLimits(point).upper > domain.max);
      const lower = shown.some(point => referenceBandLimits(point).lower < domain.min);
      overflow ||= upper || lower;
      if (!upper && !lower) return;
      markerColor ??= chartColors().muted;
      context.save(); context.strokeStyle = markerColor; context.lineWidth = 1.5;
      for (const [visible, direction, y] of [[upper, -1, top + 4], [lower, 1, top + height - 4]]) {
        if (!visible) continue;
        const x = width - 10;
        context.beginPath(); context.moveTo(x - 3, y - direction * 3);
        context.lineTo(x, y); context.lineTo(x + 3, y - direction * 3); context.stroke();
      }
      context.restore();
    };
    if (scene.groups) {
      const rowHeight = (height - 36) / scene.groups.length;
      scene.groups.forEach((group, index) => mark(scene.baselines.get(group.key), scene.spec.domains.get(group.key),
        14 + index * rowHeight, Math.max(42, rowHeight - 16)));
    } else mark(scene.spec.baseline, scene.spec.domain, 34, height - 64);
    canvas.setAttribute?.("aria-description", "Speed axis fits visible observations and baseline means."
      + (overflow ? " Edge arrows mark a reference band continuing beyond the displayed speed scale." : ""));
    canvas.title = overflow ? "Reference-band arrows: the band continues beyond the displayed speed scale." : "Speed scale fits the visible window.";
  }

  function queueFrame() {
    if (frameId !== null || !running()) return;
    frameId = window.requestAnimationFrame(timestamp => {
      frameId = null;
      if (!running()) return;
      if (target !== null && chartHistory.endTime !== null) {
        const elapsed = lastFrame ? Math.min(48, Math.max(1, timestamp - lastFrame)) : 16;
        const remaining = target - chartHistory.endTime;
        chartHistory.endTime = Math.abs(remaining) < 1 ? target : chartHistory.endTime + remaining * (1 - Math.exp(-elapsed / 65));
        lastFrame = timestamp;
        if (Math.abs(target - chartHistory.endTime) < 1) {
          chartHistory.endTime = target >= latest() ? null : target;
          target = chartHistory.endTime;
        }
      }
      if (timestamp - lastUi >= 120 || chartHistory.endTime === target) {
        updateHistoryControls(); lastUi = timestamp;
      }
      drawAllCharts(); ensure();
      if (target !== null && chartHistory.endTime !== target) queueFrame();
      else lastFrame = 0;
    });
  }

  function pan(distance) {
    initialize();
    const limits = historyLimits();
    if (!chartHistory.enabled || !limits.available || !Number.isFinite(distance) || distance === 0) return false;
    if (chartHistory.endTime === null) retainCurrent();
    const previous = target ?? chartHistory.endTime ?? latest();
    const next = clampHistoryEnd(previous - distance, limits.firstEnd, latest());
    if (Math.abs(next - previous) < 1) return false;
    target = next;
    stopAxisFit();
    if (chartHistory.endTime === null) chartHistory.endTime = latest();
    queueFrame(); ensure();
    return true;
  }

  function refresh() {
    stopAxisFit();
    initialize(); target = chartHistory.endTime;
    retainCurrent();
    if (target === null) { stop(); scenes.clear(); retainCurrent(); }
    queueFrame(); ensure();
  }

  function toggle() {
    if (!active) return;
    if (!chartHistory.enabled) {
      stop(chartHistory.endTime !== null && controller?.priority === 1);
      target = chartHistory.endTime;
      if (prepared) { initialize(); ensure(); }
    }
    else { initialize(); ensure(); }
  }

  function help() {
    if (prepared) {
      const status = preparationStatus();
      const visible = buffers.get(scope) && covered(buffers.get(scope), end() - span(), end());
      elements.historyToggle.title = `Prepared historical windows: ${status.ready} / ${status.total}. Selected window ${visible ? "retained" : "not fully retained"}; older history loads on demand.`;
    }
    if (!active || !chartHistory.enabled) return;
    if (chartHistory.rateUntil) return;
    if (notice) {
      elements.historyHelp.textContent = notice;
      elements.historyRetry.hidden = false;
    } else if (controller && dashboardReadWait(controller.abort.signal)) {
      const wait = dashboardReadWait(controller.abort.signal);
      elements.historyHelp.textContent = wait === "budget" || wait === "server"
        ? "History is waiting for shared request capacity. It resumes automatically; loaded history remains scrollable."
        : "History is queued behind higher-priority dashboard reads; loaded history remains scrollable.";
      elements.historyRetry.hidden = true;
    } else if (chartHistory.endTime !== null) {
      if (!covered(buffers.get(scope), end() - span(), end()) && (controller || timer !== null)) {
        elements.historyHelp.textContent += " Loading adjacent history; only loaded observations are drawn.";
      }
    }
  }

  function retry() {
    if (!active || chartHistory.rateUntil > Date.now()) return;
    chartHistory.rateUntil = 0;
    for (const index of failed) chunks.delete(index);
    failed.clear(); notice = ""; merged = null; ensure(); updateHistoryControls();
  }

  function emptyMessage(message, corridor) {
    const parts = [...chunks.values()].map(chunk => chunk.data.get(corridor)).filter(Boolean);
    if (parts.some(part => !part.chartUnavailable)) return message;
    return parts.length ? "History could not load. Choose Retry or Current." : "Loading adjacent observations…";
  }

  return {active, prepared, prepare, preparationStatus, route, reference, paint, pan, refresh, toggle, help, retry, emptyMessage,
    pause() { if (!active) return; disposed = true; stop(); },
    resume() { if (!active) return; disposed = false; initialize(); queueFrame(); ensure(); }};
})();
