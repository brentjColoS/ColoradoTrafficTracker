(() => {
  const finite = value => value === null || value === undefined || value === "" ? NaN : Number(value);

  function currentFlowCells(snapshot, allowHistorical = false) {
    if (snapshot?.resolution === "SLOWDOWN_FREQUENCY") return [];
    const hourly = snapshot?.resolution === "HOURLY";
    const observedAt = hourly
      ? Math.max(0, ...(Array.isArray(snapshot?.cells) ? snapshot.cells : [])
        .map(cell => Date.parse(cell?.lastObservedAt) || 0))
      : Date.parse(snapshot?.observedAt);
    if (!observedAt || !Number.isFinite(observedAt)
      || (!allowHistorical && Date.now() - observedAt > 60 * 60_000)) return [];
    const unique = new Map();
    for (const cell of Array.isArray(snapshot?.cells) ? snapshot.cells : []) {
      const start = finite(cell?.startMileMarker);
      const end = finite(cell?.endMileMarker);
      const speedMph = finite(hourly ? cell?.avgSpeedMph : cell?.speedMph);
      const distanceMiles = Math.abs(end - start);
      if (String(cell?.direction || "COMBINED").toUpperCase() !== "COMBINED"
        || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(speedMph)
        || speedMph < 0 || !Number.isFinite(distanceMiles) || distanceMiles <= 0) continue;
      const key = `${Math.min(start, end)}|${Math.max(start, end)}`;
      unique.set(key, { cell: hourly ? { ...cell, speedMph } : cell, distanceMiles, speedMph });
    }
    return [...unique.values()];
  }

  function estimateCorridorTravelMinutes(snapshot, distanceMiles, averageSpeed, allowHistorical = false) {
    const cells = currentFlowCells(snapshot, allowHistorical).sort((left, right) =>
      Math.min(left.cell.startMileMarker, left.cell.endMileMarker)
        - Math.min(right.cell.startMileMarker, right.cell.endMileMarker));
    const tolerance = 0.02;
    if (cells.some(cell => cell.speedMph === 0)) return NaN;
    const coveredMiles = cells.reduce((miles, cell) => miles + cell.distanceMiles, 0);
    const spanMiles = cells.length ? Math.max(cells.at(-1).cell.startMileMarker, cells.at(-1).cell.endMileMarker)
      - Math.min(cells[0].cell.startMileMarker, cells[0].cell.endMileMarker) : 0;
    const contiguous = cells.every((cell, index) => index === 0 || Math.abs(
      Math.min(cell.cell.startMileMarker, cell.cell.endMileMarker)
        - Math.max(cells[index - 1].cell.startMileMarker, cells[index - 1].cell.endMileMarker)) <= tolerance);
    // Snapshot counts include directional companions; validate the combined span itself.
    if (cells.length > 0 && contiguous && Number.isFinite(distanceMiles) && distanceMiles > 0
      && Math.abs(coveredMiles - distanceMiles) <= tolerance
      && Math.abs(spanMiles - distanceMiles) <= tolerance) {
      return cells.reduce((minutes, cell) => minutes + cell.distanceMiles / cell.speedMph * 60, 0);
    }
    return Number.isFinite(distanceMiles) && distanceMiles > 0 && Number.isFinite(averageSpeed) && averageSpeed > 0
      ? distanceMiles / averageSpeed * 60 : NaN;
  }

  window.TrafficEstimates = { currentFlowCells, estimateCorridorTravelMinutes };
})();
