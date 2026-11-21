(() => {
  const number = value => value === null || value === undefined || value === "" ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  const time = value => value ? Date.parse(value) : Number.NaN;

  // CDOT OTIS: 070A MM236.918–237.087 is 60mph eastbound and 65mph westbound.
  const regularSignReferences = {
    "OpenTMS-Sign465279": {direction:"WEST", mileMarker:237, limitMph:65},
    "OpenTMS-Sign465294": {direction:"WEST", mileMarker:237.05, limitMph:65}
  };

  function signs(snapshot, confirmed = true, now = Date.now()) {
    if (snapshot?.corridor !== "I70" || !Array.isArray(snapshot.signs)) return [];
    return snapshot.signs.slice(0, 64).filter(sign => {
      const marker = number(sign.mileMarker);
      return marker !== null && marker >= 206 && marker <= 274
        && ["EAST", "WEST"].includes(sign.direction)
        && number(sign.longitude) !== null && number(sign.latitude) !== null
        && Math.abs(Number(sign.longitude)) <= 180 && Math.abs(Number(sign.latitude)) <= 90;
    }).map(sign => {
      const reported = number(sign.reportedLimitMph);
      const roadReference = number(sign.regularLimitMph);
      const candidate = regularSignReferences[sign.id];
      const reviewed = candidate?.direction === sign.direction && Math.abs(candidate.mileMarker - Number(sign.mileMarker)) < 0.001;
      const regular = reviewed ? candidate.limitMph : roadReference;
      let status = sign.status || "UNAVAILABLE";
      if (!confirmed) status = "FETCH_FAILED";
      else if (status === "AVAILABLE") {
        if (!Number.isFinite(time(sign.fetchedAt)) || now - time(sign.fetchedAt) > 3_600_000) status = "STALE";
        else if (["error", "communication error"].includes(sign.communicationStatus)) status = "COMMUNICATION_ERROR";
        else if (sign.communicationStatus !== "operational") status = "UNAVAILABLE";
        else if (sign.displayStatus !== "on" || reported === null || reported < 5 || reported > 85) status = "UNAVAILABLE";
      }
      return {...sign, status, reportedLimitMph:reported, regularLimitMph:regular,
        roadReferenceMph:roadReference, referenceSource:reviewed ? "cdot-inventory" : "configured-road",
        differentFromRegular:status === "AVAILABLE" && regular !== null && reported !== regular,
        belowRegular:status === "AVAILABLE" && regular !== null && reported < regular};
    });
  }

  function groups(records) {
    const result = [];
    for (const sign of [...records].sort((a,b) => a.direction.localeCompare(b.direction) || a.mileMarker-b.mileMarker)) {
      let group = result.at(-1);
      if (!group || group.direction !== sign.direction || sign.mileMarker-group.mileMarker > 0.1) {
        group = {direction:sign.direction, mileMarker:Number(sign.mileMarker), longitude:Number(sign.longitude),
          latitude:Number(sign.latitude), signs:[]};
        result.push(group);
      }
      group.signs.push(sign);
    }
    return result.map(group => {
      const available = group.signs.filter(sign => sign.status === "AVAILABLE");
      const speeds = [...new Set(available.map(sign => sign.reportedLimitMph))];
      const uncertain = available.length !== group.signs.length || speeds.length > 1;
      const speed = speeds.length === 1 ? speeds[0] : null;
      const error = group.signs.some(sign => sign.status === "COMMUNICATION_ERROR");
      const reduced = available.some(sign => sign.belowRegular);
      const changed = available.some(sign => sign.differentFromRegular);
      const label = `${speed === null ? "—" : speed}${group.direction === "EAST" ? "E" : "W"}${uncertain ? " !" : ""}`;
      return {...group, speed, uncertain, error, reduced, changed, label};
    });
  }

  function summary(snapshot, confirmed = true, now = Date.now()) {
    const records = signs(snapshot, confirmed, now);
    const locations = groups(records);
    const available = records.filter(sign => sign.status === "AVAILABLE");
    const changed = groups(available).filter(group => group.changed && !group.uncertain);
    const lastReported = records.filter(sign => sign.status === "STALE" && sign.reportedLimitMph >= 5 && sign.reportedLimitMph <= 85
      && sign.communicationStatus === "operational" && sign.displayStatus === "on" && Number.isFinite(time(sign.fetchedAt)));
    return {records, locations, lastReported, changed, reduced:changed.filter(group => group.reduced),
      unavailable:locations.filter(group => group.uncertain), available};
  }

  function statusLabel(status) {
    return ({AVAILABLE:"CDOT-reported limit", COMMUNICATION_ERROR:"Communication error — limit unconfirmed",
      UNAVAILABLE:"Limit unavailable", FETCH_FAILED:"Read failed — limit unconfirmed", STALE:"Last read over one hour ago — limit unconfirmed",
      NOT_OBSERVED:"Not checked yet — limit unavailable"})[status] || "Limit unavailable";
  }

  function historyPeriods(history) {
    if (history?.corridor !== "I70" || !Array.isArray(history.observations) || history.observations.length > 6000) return [];
    const start = time(history.start), end = time(history.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end-start > 720*3_600_000) return [];
    const events = new Map(), latest = new Map(), result = [];
    const eventAt = at => { if (!events.has(at)) events.set(at, []); return events.get(at); };
    eventAt(start); eventAt(end);
    for (const observation of history.observations) {
      const at = time(observation.lastAttemptAt), fetched = time(observation.fetchedAt);
      if (!observation.id || !Number.isFinite(at) || at < start-3_600_000 || at > end) continue;
      const sign = signs({corridor:"I70",signs:[observation]}, true, at)[0];
      if (!sign) continue;
      if (sign.status === "AVAILABLE" && (!Number.isFinite(fetched) || fetched > at)) sign.status = "UNAVAILABLE";
      eventAt(at).push(sign);
      if (fetched+3_600_000 > at && fetched+3_600_000 < end) eventAt(fetched+3_600_000);
    }
    const times = [...events.keys()].sort((a,b) => a-b);
    for (let index=0; index<times.length-1; index++) {
      const at = times[index], until = times[index+1];
      for (const sign of events.get(at)) latest.set(sign.id, sign);
      if (latest.size > 64) return [];
      if (until <= start || at >= end) continue;
      const fresh = signs({corridor:"I70",signs:[...latest.values()]}, true, at+1);
      for (const group of summary({corridor:"I70",signs:fresh}, true, at+1).reduced) {
        const from = Math.max(start, at), finish = Math.min(end, until);
        const previous = result.findLast(period => period.direction === group.direction
          && Math.abs(period.mileMarker-group.mileMarker) < 0.1 && period.speed === group.speed && period.end === from);
        if (previous) previous.end = finish;
        else result.push({start:from,end:finish,speed:group.speed,direction:group.direction,mileMarker:group.mileMarker});
      }
    }
    return result;
  }

  function zonePeriods(periods, group, groups, start, end) {
    const low = Math.min(group.startMileMarker, group.endMileMarker), high = Math.max(group.startMileMarker, group.endMileMarker);
    const last = Math.max(...groups.map(row => Math.max(row.startMileMarker, row.endMileMarker)));
    return periods.filter(period => period.start < end && period.end > start && period.mileMarker >= low
      && (period.mileMarker < high || (high === last && period.mileMarker === high)))
      .map(period => ({...period,start:Math.max(start,period.start),end:Math.min(end,period.end)}));
  }

  const api = {signs, groups, summary, statusLabel, historyPeriods, zonePeriods};
  if (typeof window !== "undefined") window.VariableSpeedSigns = api;
  if (typeof module !== "undefined") module.exports = api;
})();
