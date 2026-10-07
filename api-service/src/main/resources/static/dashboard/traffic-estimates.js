(() => {
  const finite = value => value === null || value === undefined || value === "" ? NaN : Number(value);

  function currentFlowCells(snapshot, allowHistorical = false) {
    const observedAt = Date.parse(snapshot?.observedAt);
    if (!observedAt || !Number.isFinite(observedAt)
      || (!allowHistorical && Date.now() - observedAt > 60 * 60_000)) return [];
    const unique = new Map();
    for (const cell of Array.isArray(snapshot?.cells) ? snapshot.cells : []) {
      const start = finite(cell?.startMileMarker);
      const end = finite(cell?.endMileMarker);
      const speedMph = finite(cell?.speedMph);
      const distanceMiles = Math.abs(end - start);
      if (String(cell?.direction || "COMBINED").toUpperCase() !== "COMBINED"
        || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(speedMph)
        || speedMph <= 0 || !Number.isFinite(distanceMiles) || distanceMiles <= 0) continue;
      const key = String(cell?.cellId || `${Math.min(start, end)}|${Math.max(start, end)}`);
      unique.set(key, { cell, distanceMiles, speedMph });
    }
    return [...unique.values()];
  }

  function estimateCorridorTravelMinutes(snapshot, distanceMiles, averageSpeed, allowHistorical = false) {
    const cells = currentFlowCells(snapshot, allowHistorical);
    const total = finite(snapshot?.totalCellCount);
    const supported = finite(snapshot?.supportedCellCount);
    if (cells.length > 0 && (!Number.isFinite(total) || cells.length === total)
      && (!Number.isFinite(supported) || !Number.isFinite(total) || supported === total)) {
      return cells.reduce((minutes, cell) => minutes + cell.distanceMiles / cell.speedMph * 60, 0);
    }
    return Number.isFinite(distanceMiles) && distanceMiles > 0 && Number.isFinite(averageSpeed) && averageSpeed > 0
      ? distanceMiles / averageSpeed * 60 : NaN;
  }

  window.TrafficEstimates = { currentFlowCells, estimateCorridorTravelMinutes };
})();
