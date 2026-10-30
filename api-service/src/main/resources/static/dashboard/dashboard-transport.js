const dashboardReadQueue = [];
const dashboardRequestTimes = [];
let dashboardReadRunning = false;
let dashboardBackgroundRunning = false;
let dashboardReadTimer = null;
let dashboardRetryUntil = 0;

function fetchDashboardBatch(path, signal, options = {}) {
  return new Promise((resolve, reject) => {
    const job = {path, signal, resolve, reject,
      priority: path.includes("/snapshot?") ? 0 : options.background === true ? 1.5 : options.priority === 2 ? 2 : 1,
      onDispatch: options.onDispatch, versionHints: options.versionHints, background: options.background === true,
      onPartial: options.onPartial};
    const abort = () => {
      const index = dashboardReadQueue.indexOf(job);
      if (index < 0) return;
      dashboardReadQueue.splice(index, 1);
      job.detachAbort();
      reject(signal.reason);
      window.clearTimeout(dashboardReadTimer); dashboardReadTimer = null;
      drainDashboardReads();
    };
    signal?.addEventListener("abort", abort, {once: true});
    job.detachAbort = () => signal?.removeEventListener("abort", abort);
    dashboardReadQueue.push(job);
    window.clearTimeout(dashboardReadTimer); dashboardReadTimer = null;
    drainDashboardReads();
    options.onQueued?.();
  });
}

function drainDashboardReads() {
  if (dashboardReadTimer !== null) return;
  while (dashboardReadQueue.length) {
    dashboardReadQueue.sort((a, b) => a.priority - b.priority);
    const index = dashboardReadQueue.findIndex(job => job.signal?.aborted
      || (job.background ? !dashboardBackgroundRunning : !dashboardReadRunning));
    if (index < 0) return;
    const job = dashboardReadQueue[index];
    if (job.signal?.aborted) {
      dashboardReadQueue.splice(index, 1); job.detachAbort(); job.reject(job.signal.reason); continue;
    }
    const now = Date.now();
    while (dashboardRequestTimes.length && dashboardRequestTimes[0] <= now - 60_000) dashboardRequestTimes.shift();
    const availableAt = Math.max(dashboardRetryUntil,
      dashboardRequestTimes.length >= (job.priority === 0 ? 48 : 46) ? dashboardRequestTimes[0] + 60_050 : now);
    if (availableAt > now) {
      dashboardReadTimer = window.setTimeout(() => { dashboardReadTimer = null; drainDashboardReads(); }, availableAt - now);
      return;
    }
    dashboardReadQueue.splice(index, 1); job.detachAbort();
    if (job.background) dashboardBackgroundRunning = true;
    else dashboardReadRunning = true;
    dashboardRequestTimes.push(now);
    const known = job.versionHints
      ? [...new Set([...state.readSections.values()].map(section => section.version).filter(Boolean))] : null;
    const path = known ? `${job.path}&known=${encodeURIComponent(known.join(","))}` : job.path;
    job.onDispatch?.();
    void fetchJson(path, job.signal, job.onPartial).then(job.resolve, error => {
      if (error.status === 429) {
        const seconds = Number(error.retryAfter);
        const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.parse(error.retryAfter) - Date.now();
        dashboardRetryUntil = Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60_000);
      }
      job.reject(error);
    }).finally(() => {
      if (job.background) dashboardBackgroundRunning = false;
      else dashboardReadRunning = false;
      window.clearTimeout(dashboardReadTimer); dashboardReadTimer = null;
      drainDashboardReads();
    });
  }
}

function dashboardReadWait(signal) {
  const job = dashboardReadQueue.find(value => value.signal === signal);
  if (!job) return null;
  if (dashboardRetryUntil > Date.now()) return "server";
  const recent = dashboardRequestTimes.filter(value => value > Date.now() - 60_000).length;
  return recent >= (job.priority === 0 ? 48 : 46) ? "budget" : "queued";
}

async function readDashboardBatch(path, signal, options = {}) {
  try {
    const sections = await fetchDashboardBatch(path, signal, {...options, versionHints: true});
    signal?.throwIfAborted();
    const reader = acceptDashboardSections(sections, path.includes("/dashboard/history?"));
    if (path.includes("/dashboard/snapshot?") && !DEMO_MODE && !HISTORICAL_MODE && !REPLAY_MODE) {
      window.HealthMonitor?.receive(sections, state.readSections);
    }
    return reader;
  } catch (error) {
    if (!signal?.aborted && !String(error.message).includes("retry")) error.message += ". Select Sync now to retry.";
    throw error;
  }
}


async function fetchJson(path, signal = null, onPartial = null) {
  const response = await window.fetch(path, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: { Accept: onPartial ? "application/x-ndjson" : "application/json" },
    cache: "no-store"
  });
  if (!response.ok) {
    const error = new Error(`${path} returned ${response.status}`);
    error.status = response.status;
    error.retryAfter = response.headers?.get?.("Retry-After");
    throw error;
  }
  if (!onPartial || !response.headers?.get?.("Content-Type")?.includes("application/x-ndjson")) return response.json();
  if (!response.body?.getReader) throw new Error("Progressive summaries are unavailable in this browser");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", last = null, frames = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (signal?.aborted) throw signal.reason;
      buffer += decoder.decode(part.value, {stream:!part.done});
      if (buffer.length > 65_536) throw new Error("Summary update exceeded its size limit");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0,newline); buffer = buffer.slice(newline+1);
        if (!line.trim()) continue;
        if (++frames > 16 || last?.complete) throw new Error("Unexpected summary updates");
        const frame = JSON.parse(line);
        if (!frame || typeof frame.complete !== "boolean" || !frame.summaries) throw new Error("Invalid summary update");
        onPartial(frame); last = frame;
      }
      if (part.done) break;
    }
    if (buffer.trim() || !last?.complete) throw new Error("Summary update ended before completion");
    return last.summaries;
  } finally {
    await reader.cancel().catch(()=>{}); reader.releaseLock();
  }
}
