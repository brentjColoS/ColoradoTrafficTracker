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
    return {records, locations, reduced:locations.filter(group => group.reduced), changed:locations.filter(group => group.changed),
      unavailable:locations.filter(group => group.uncertain), available:records.filter(sign => sign.status === "AVAILABLE")};
  }

  function statusLabel(status) {
    return ({AVAILABLE:"CDOT-reported limit", COMMUNICATION_ERROR:"Communication error — limit unconfirmed",
      UNAVAILABLE:"Limit unavailable", FETCH_FAILED:"Read failed — limit unconfirmed", STALE:"Last read over one hour ago — limit unconfirmed",
      NOT_OBSERVED:"Not checked yet — limit unavailable"})[status] || "Limit unavailable";
  }

  const api = {signs, groups, summary, statusLabel};
  if (typeof window !== "undefined") window.VariableSpeedSigns = api;
  if (typeof module !== "undefined") module.exports = api;
})();
