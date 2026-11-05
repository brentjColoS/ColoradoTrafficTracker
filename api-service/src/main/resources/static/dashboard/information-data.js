(() => {
  function create({ apiBase }) {
    const DATA_DAILY_TIMEOUT_MS = 8_000;
    const elements = {
      i25DailyFastest: document.getElementById("i25DailyFastest"),
      i25DailySlowest: document.getElementById("i25DailySlowest"),
      i70DailyFastest: document.getElementById("i70DailyFastest"),
      i70DailySlowest: document.getElementById("i70DailySlowest"),
      dailyRangeStatus: document.getElementById("dailyRangeStatus")
    };

    const DATA_CORRIDORS = Object.freeze([
      { id: "I25", label: "I-25", distanceMiles: 63, fastest: "i25DailyFastest", slowest: "i25DailySlowest" },
      { id: "I70", label: "I-70", distanceMiles: 68, fastest: "i70DailyFastest", slowest: "i70DailySlowest" }
    ]);

    async function initializeDataDailyRange() {
      if (!elements.dailyRangeStatus) return;
      const base = apiBase();
      const results = await Promise.allSettled(DATA_CORRIDORS.map(async corridor => {
        const options = { headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(DATA_DAILY_TIMEOUT_MS) };
        const summaryResponse = await window.fetch(`${base}/traffic/summary?corridor=${corridor.id}&preferUsable=true`, options);
        if (!summaryResponse.ok) throw new Error("The retained-data endpoint could not be reached.");
        const summary = await summaryResponse.json();
        const observedAt = summary?.latest?.polledAt;
        if (!observedAt || !Number.isFinite(Date.parse(observedAt))) {
          throw new Error("No valid retained observation time is available.");
        }
        const trendResponse = await window.fetch(`${base}/traffic/zones/trends?corridor=${corridor.id}&windowHours=24&asOf=${encodeURIComponent(observedAt)}`, options);
        if (!trendResponse.ok) throw new Error("The retained-data endpoint could not be reached.");
        const trend = await trendResponse.json();
        return { observedAt, range: retainedDailyTravelRange(trend?.points, corridor.distanceMiles, observedAt) };
      }));
      const labels = results.map((result, index) => {
        const corridor = DATA_CORRIDORS[index];
        const fastestNode = elements[corridor.fastest];
        const slowestNode = elements[corridor.slowest];
        if (result.status === "fulfilled" && Number.isFinite(result.value.range.fastest)) {
          fastestNode.textContent = formatTravelMinutes(result.value.range.fastest);
          slowestNode.textContent = formatTravelMinutes(result.value.range.slowest);
          return `${corridor.label} · ${formatDenverDay(result.value.observedAt)}`;
        }
        fastestNode.textContent = "Unavailable";
        slowestNode.textContent = "Unavailable";
        if (result.status === "fulfilled") return `${corridor.label} · no complete retained estimates`;
        if (result.reason?.name === "TimeoutError" || result.reason?.name === "AbortError") {
          return `${corridor.label} · request timed out`;
        }
        return `${corridor.label} · retained data could not be loaded`;
      });
      const incomplete = results.some(result => result.status === "rejected"
        || !Number.isFinite(result.value.range.fastest));
      elements.dailyRangeStatus.textContent = labels.join(" / ")
        + (incomplete ? ". Refresh this page to retry." : " · latest retained days");
    }

    return { initialize: initializeDataDailyRange };
  }

  function numericDataValue(value) {
    return typeof value === "number" || (typeof value === "string" && value.trim() !== "")
      ? Number(value) : Number.NaN;
  }

  function retainedDailyTravelRange(points, distanceMiles, observedAt) {
    const cutoff = Date.parse(observedAt);
    const activeDay = denverDayKey(observedAt);
    const buckets = new Map();
    for (const point of Array.isArray(points) ? points : []) {
      const timestamp = Date.parse(point?.bucketStart || point?.polledAt);
      if (!Number.isFinite(cutoff) || !Number.isFinite(timestamp) || timestamp > cutoff || denverDayKey(timestamp) !== activeDay) continue;
      if (!buckets.has(timestamp)) buckets.set(timestamp, []);
      buckets.get(timestamp).push(point);
    }
    const minutes = [...buckets.values()]
      .map(bucket => estimateZoneTravelMinutes(bucket, distanceMiles))
      .filter(Number.isFinite);
    return minutes.length > 0
      ? { fastest: Math.min(...minutes), slowest: Math.max(...minutes) }
      : { fastest: Number.NaN, slowest: Number.NaN };
  }

  function estimateZoneTravelMinutes(points, distanceMiles) {
    return window.TrafficEstimates.estimateSpeedZoneTravelMinutes(points, distanceMiles, numericDataValue);
  }

  function denverDayKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
  }

  function formatDenverDay(value) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric"
    }).format(new Date(value));
  }

  function formatTravelMinutes(value) {
    return Number.isFinite(value) ? `${Math.round(value)} min` : "Unavailable";
  }


  window.InformationData = { create, retainedDailyTravelRange, estimateZoneTravelMinutes };
})();
