(() => {
  const panel = document.getElementById("corridorMapPanel");
  const container = document.getElementById("corridorMap");
  const title = document.getElementById("corridorMapTitle");
  const subtitle = document.getElementById("corridorMapSubtitle");
  const status = document.getElementById("corridorMapStatus");
  const legendNote = document.getElementById("corridorMapLegendNote");
  const emptyCollection = { type: "FeatureCollection", features: [] };
  const loadRenderer = window.CORRIDOR_MAP_RENDERER_LOADER
    || (() => import("./vendor/maplibre-gl/6.10.0/maplibre-gl.mjs"));

  let renderer;
  let map;
  let mapReady;
  let renderVersion = 0;
  let focusedCorridor;

  function hide() {
    renderVersion += 1;
    focusedCorridor = undefined;
    panel.hidden = true;
  }

  async function render(payload) {
    const corridor = payload?.corridor;
    if (!corridor) {
      hide();
      return;
    }

    const version = ++renderVersion;
    const frequencyView = Number(payload.selectedHours) > 24;
    panel.hidden = false;
    title.textContent = `${corridorLabel(corridor)} Corridor Traffic`;
    subtitle.textContent = mapSubtitle(payload.corridorFeature, frequencyView, payload.selectedHours);
    setLegendMode(frequencyView);

    const feature = usableCorridorFeature(payload.corridorFeature);
    if (!feature) {
      setStatus("Route geometry is unavailable. The incident table remains available.");
      clearRoute();
      return;
    }

    setStatus("Loading USGS imagery and the tracked route…");
    try {
      await ensureMap();
      if (version !== renderVersion) return;
      map.getSource("corridor-route").setData({ type: "FeatureCollection", features: [feature] });
      const traffic = trafficFeaturesForRoute(feature, oneMileCombinedCells(payload.flowCells), payload.flowCells);
      map.getSource("corridor-traffic").setData(traffic);
      const incidents = usableIncidentFeatures(payload.incidentFeatures, corridor);
      map.getSource("corridor-incidents").setData({ type: "FeatureCollection", features: incidents });
      map.resize();
      if (focusedCorridor !== corridor) {
        const bounds = geometryBounds(feature.geometry);
        if (bounds) map.fitBounds(bounds, { padding: 34, maxZoom: 13, duration: 0 });
      }
      focusedCorridor = corridor;
      setTheme(payload.theme);
      const incidentStatus = incidents.length === 1
        ? "1 mapped CDOT report"
        : incidents.length > 1 ? `${incidents.length} mapped CDOT reports` : "No mapped CDOT reports in this window";
      setStatus(mapStatus(traffic, payload.flowCells, incidentStatus, frequencyView));
    } catch {
      if (version !== renderVersion) return;
      setStatus("The imagery map could not start. The incident table remains available.");
    }
  }

  async function ensureMap() {
    if (mapReady) return mapReady;
    mapReady = createMap();
    return mapReady;
  }

  async function createMap() {
    const module = await loadRenderer();
    renderer = module.default || module;
    map = new renderer.Map({
      container,
      cooperativeGestures: true,
      attributionControl: false,
      style: mapStyle(document.documentElement.dataset.theme)
    });
    map.addControl(new renderer.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new renderer.AttributionControl({ compact: true }), "bottom-right");
    map.on("click", "corridor-incidents", showIncidentPopup);
    map.on("click", "corridor-traffic", showTrafficPopup);
    map.on("mouseenter", "corridor-incidents", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "corridor-incidents", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "corridor-traffic", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "corridor-traffic", () => { map.getCanvas().style.cursor = ""; });
    map.on("error", (event) => {
      if (event?.sourceId === "usgs-imagery") {
        setStatus("USGS imagery is unavailable. The route outline remains visible.");
      }
    });
    await new Promise((resolve, reject) => {
      if (map.loaded()) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => reject(new Error("Map load timed out")), 15_000);
      map.once("load", () => {
        window.clearTimeout(timer);
        resolve();
      });
    });
    map.getCanvas().setAttribute("aria-label", "Interactive corridor imagery map");
  }

  function clearRoute() {
    const source = map?.getSource?.("corridor-route");
    if (source) source.setData(emptyCollection);
    const incidents = map?.getSource?.("corridor-incidents");
    if (incidents) incidents.setData(emptyCollection);
    const traffic = map?.getSource?.("corridor-traffic");
    if (traffic) traffic.setData(emptyCollection);
  }

  function setTheme(theme) {
    if (!map?.loaded?.()) return;
    const dark = theme === "dark" || (!theme && document.documentElement.dataset.theme === "dark");
    if (map.getLayer("map-background")) {
      map.setPaintProperty("map-background", "background-color", dark ? "#17221c" : "#efece2");
    }
    if (map.getLayer("corridor-casing")) {
      map.setPaintProperty("corridor-casing", "line-color", dark ? "#f7f2df" : "#10251a");
    }
  }

  function mapStyle(theme) {
    const dark = theme === "dark";
    const currentTrafficColor = [
      "case",
      ["==", ["get", "condition"], "STOPPED"], "#0b0d0c",
      ["==", ["get", "condition"], "UNKNOWN"], "#6b6660",
      [
        "interpolate", ["linear"], ["coalesce", ["get", "speedRatio"], 0],
        0.05, "#681c2a",
        0.35, "#bd3334",
        0.60, "#d8aa24",
        0.80, "#2f7a55",
        1.00, "#2f7a55",
        1.05, "#2675b8"
      ]
    ];
    const frequencyTrafficColor = [
      "case",
      [">=", ["coalesce", ["get", "stoppedFrequency"], 0], 0.10], "#0b0d0c",
      [
        "interpolate", ["linear"], ["coalesce", ["get", "slowdownFrequency"], 0],
        0.00, "#2f7a55",
        0.10, "#d8aa24",
        0.25, "#bd3334",
        0.50, "#681c2a",
        0.80, "#681c2a"
      ]
    ];
    const trafficColor = [
      "case",
      ["==", ["get", "resolution"], "SLOWDOWN_FREQUENCY"],
      frequencyTrafficColor,
      currentTrafficColor
    ];
    const trafficOpacity = [
      "case",
      ["==", ["get", "quality"], "PARTIAL_CELL"], 0.62,
      0.96
    ];
    return {
      version: 8,
      sources: {
        "usgs-imagery": {
          type: "raster",
          tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 16,
          attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>'
        },
        "corridor-route": {
          type: "geojson",
          data: emptyCollection,
          attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
        },
        "corridor-traffic": {
          type: "geojson",
          data: emptyCollection
        },
        "corridor-incidents": {
          type: "geojson",
          data: emptyCollection
        }
      },
      layers: [
        { id: "map-background", type: "background", paint: { "background-color": dark ? "#17221c" : "#efece2" } },
        { id: "usgs-imagery", type: "raster", source: "usgs-imagery", paint: { "raster-opacity": 0.94 } },
        {
          id: "corridor-casing",
          type: "line",
          source: "corridor-route",
          paint: { "line-color": dark ? "#f7f2df" : "#10251a", "line-width": 8, "line-opacity": 0.9 }
        },
        {
          id: "corridor-route",
          type: "line",
          source: "corridor-route",
          paint: { "line-color": "#d89b00", "line-width": 4, "line-opacity": 1 }
        },
        {
          id: "corridor-traffic-casing",
          type: "line",
          source: "corridor-traffic",
          paint: {
            "line-color": "#fffdf2",
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 5, 16, 12],
            "line-opacity": 0.9
          }
        },
        {
          id: "corridor-traffic",
          type: "line",
          source: "corridor-traffic",
          paint: {
            "line-color": trafficColor,
            "line-width": ["interpolate", ["linear"], ["zoom"], 7, 3, 16, 8],
            "line-opacity": trafficOpacity
          }
        },
        {
          id: "corridor-incidents",
          type: "circle",
          source: "corridor-incidents",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 4, 13, 7],
            "circle-color": [
              "match", ["get", "normalizedCategory"],
              "CONSTRUCTION", "#d89b00",
              "DISABLED_VEHICLE", "#2f7a55",
              "CLOSURE", "#7e343c",
              "CRASH", "#9c4f59",
              "#6b6660"
            ],
            "circle-opacity": ["case", ["==", ["get", "active"], false], 0.5, 0.95],
            "circle-stroke-color": "#fffdf2",
            "circle-stroke-width": 2
          }
        }
      ]
    };
  }

  function usableCorridorFeature(feature) {
    return feature?.type === "Feature" && geometryBounds(feature.geometry) ? feature : null;
  }

  function usableIncidentFeatures(features, corridor) {
    if (!Array.isArray(features)) return [];
    return features.filter((feature) => {
      const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
      return feature?.type === "Feature"
        && feature.properties?.corridor === corridor
        && feature.properties?.isOffCorridor !== true
        && validPoint(coordinates);
    });
  }

  function oneMileCombinedCells(response) {
    const cells = Array.isArray(response?.cells) ? response.cells : [];
    const frequencyMode = response?.resolution === "SLOWDOWN_FREQUENCY";
    const combinedCells = cells.filter(cell => normalizedDirection(cell?.direction) === "COMBINED");
    const corridor = String(response?.corridor || combinedCells[0]?.cellId || "").split(":")[0];
    const buckets = new Map();

    for (const cell of combinedCells) {
      const firstMarker = finiteNumber(cell?.startMileMarker);
      const secondMarker = finiteNumber(cell?.endMileMarker);
      const speed = finiteNumber(cell?.speedMph ?? cell?.avgSpeedMph);
      if (![firstMarker, secondMarker, speed].every(Number.isFinite) || firstMarker === secondMarker) continue;
      const lowMarker = Math.min(firstMarker, secondMarker);
      const highMarker = Math.max(firstMarker, secondMarker);
      for (let bucketStart = Math.floor(lowMarker); bucketStart < highMarker - 1e-9; bucketStart += 1) {
        const overlap = Math.min(highMarker, bucketStart + 1) - Math.max(lowMarker, bucketStart);
        if (overlap <= 0) continue;
        const bucket = buckets.get(bucketStart) || {
          startMileMarker: bucketStart,
          endMileMarker: bucketStart + 1,
          weightedSpeed: 0,
          weightedSourceSpan: 0,
          sourceSpanWeight: 0,
          coveredMiles: 0,
          partialCoverage: false,
          closureEvidence: new Set(),
          closureObservationCount: 0,
          observationCount: 0,
          observedAt: "",
          firstObservedAt: "",
          slowdownFrequencyTotal: 0,
          heavySlowdownFrequencyTotal: 0,
          severeSlowdownFrequencyTotal: 0,
          stoppedFrequencyTotal: 0,
          sampledHourCount: Number.POSITIVE_INFINITY
        };
        bucket.weightedSpeed += speed * overlap;
        bucket.coveredMiles += overlap;
        const sourceSpan = finiteNumber(cell.lengthWeightedSourceSpanMiles ?? cell.avgLengthWeightedSourceSpanMiles);
        if (Number.isFinite(sourceSpan)) {
          bucket.weightedSourceSpan += sourceSpan * overlap;
          bucket.sourceSpanWeight += overlap;
        }
        bucket.partialCoverage ||= !frequencyMode
          && String(cell.quality || hourlyQuality(cell)) === "PARTIAL_CELL";
        const closure = String(cell.closureEvidence || hourlyClosureEvidence(cell));
        if (closure !== "NONE") bucket.closureEvidence.add(closure);
        bucket.closureObservationCount += finiteNumber(cell.closureObservationCount) || 0;
        bucket.observationCount += finiteNumber(cell.observationCount) || 0;
        bucket.observedAt = latestTimestamp(bucket.observedAt,
          cell.observedAt || cell.lastObservedAt || response?.observedAt || response?.hourEnd);
        bucket.firstObservedAt = earliestTimestamp(bucket.firstObservedAt,
          cell.firstObservedAt || cell.observedAt || response?.windowStart);
        const sampledHours = finiteNumber(cell.sampledHourCount);
        if (sampledHours > 0) {
          bucket.sampledHourCount = Math.min(bucket.sampledHourCount, sampledHours);
          bucket.slowdownFrequencyTotal += frequency(cell.slowdownHourCount, sampledHours) * overlap;
          bucket.heavySlowdownFrequencyTotal += frequency(cell.heavySlowdownHourCount, sampledHours) * overlap;
          bucket.severeSlowdownFrequencyTotal += frequency(cell.severeSlowdownHourCount, sampledHours) * overlap;
          bucket.stoppedFrequencyTotal += frequency(cell.stoppedHourCount, sampledHours) * overlap;
        }
        buckets.set(bucketStart, bucket);
      }
    }

    return [...buckets.values()]
      .sort((first, second) => first.startMileMarker - second.startMileMarker)
      .map(bucket => ({
        cellId: `${corridor}:${bucket.startMileMarker.toFixed(3)}-${bucket.endMileMarker.toFixed(3)}`,
        startMileMarker: bucket.startMileMarker,
        endMileMarker: bucket.endMileMarker,
        direction: "COMBINED",
        speedMph: bucket.weightedSpeed / bucket.coveredMiles,
        quality: bucket.coveredMiles >= 0.999 && !bucket.partialCoverage ? "FULL_CELL" : "PARTIAL_CELL",
        closureEvidence: combinedClosureEvidence(bucket.closureEvidence),
        lengthWeightedSourceSpanMiles: bucket.sourceSpanWeight > 0
          ? bucket.weightedSourceSpan / bucket.sourceSpanWeight : null,
        closureObservationCount: bucket.closureObservationCount,
        observationCount: bucket.observationCount,
        observedAt: bucket.observedAt,
        firstObservedAt: bucket.firstObservedAt,
        sampledHourCount: Number.isFinite(bucket.sampledHourCount) ? bucket.sampledHourCount : null,
        slowdownFrequency: bucket.slowdownFrequencyTotal / bucket.coveredMiles,
        heavySlowdownFrequency: bucket.heavySlowdownFrequencyTotal / bucket.coveredMiles,
        severeSlowdownFrequency: bucket.severeSlowdownFrequencyTotal / bucket.coveredMiles,
        stoppedFrequency: bucket.stoppedFrequencyTotal / bucket.coveredMiles
      }));
  }

  function frequency(count, total) {
    const numerator = finiteNumber(count);
    return Number.isFinite(numerator) && total > 0 ? numerator / total : 0;
  }

  function combinedClosureEvidence(evidence) {
    if (evidence.has("FULL_REPORTED")) return "FULL_REPORTED";
    if (evidence.size > 1) return "MIXED_REPORTED";
    return evidence.values().next().value || "NONE";
  }

  function latestTimestamp(first, second) {
    const firstTime = Date.parse(first);
    const secondTime = Date.parse(second);
    if (!Number.isFinite(secondTime)) return String(first || "");
    return !Number.isFinite(firstTime) || secondTime > firstTime ? String(second) : String(first);
  }

  function earliestTimestamp(first, second) {
    const firstTime = Date.parse(first);
    const secondTime = Date.parse(second);
    if (!Number.isFinite(secondTime)) return String(first || "");
    return !Number.isFinite(firstTime) || secondTime < firstTime ? String(second) : String(first);
  }

  function trafficFeaturesForRoute(routeFeature, cells, response) {
    const coordinates = lineCoordinates(routeFeature?.geometry);
    if (coordinates.length < 2 || cells.length === 0) return emptyCollection;

    const route = measuredRoute(coordinates);
    const markerAnchors = routeMarkerAnchors(routeFeature, route);
    if (markerAnchors.length < 2) return emptyCollection;

    const features = cells.flatMap((cell) => {
      const start = finiteNumber(cell?.startMileMarker);
      const end = finiteNumber(cell?.endMileMarker);
      const speed = finiteNumber(cell?.speedMph ?? cell?.avgSpeedMph);
      if (![start, end].every(Number.isFinite) || start === end) return [];
      if (!Number.isFinite(speed)) return [];
      const startDistance = markerDistance(start, markerAnchors);
      const endDistance = markerDistance(end, markerAnchors);
      const geometry = routeSlice(route, startDistance, endDistance);
      if (geometry.length < 2) return [];
      const postedSpeed = postedSpeedForCell(routeFeature, start, end);
      const frequencyMode = response?.resolution === "SLOWDOWN_FREQUENCY";
      const slowdownFrequency = finiteNumber(cell.slowdownFrequency);
      const condition = frequencyMode
        ? frequencyCondition(slowdownFrequency)
        : trafficCondition(cell, speed, postedSpeed);
      const ratio = speedRatio(speed, postedSpeed);
      return [{
        type: "Feature",
        properties: {
          cellId: String(cell.cellId || ""),
          direction: String(cell.direction || "COMBINED"),
          startMileMarker: Math.min(start, end),
          endMileMarker: Math.max(start, end),
          speedMph: speed,
          postedSpeedMph: Number.isFinite(postedSpeed) ? postedSpeed : null,
          speedRatio: Number.isFinite(ratio) ? ratio : null,
          condition,
          quality: String(cell.quality || hourlyQuality(cell)),
          closureEvidence: String(cell.closureEvidence || hourlyClosureEvidence(cell)),
          sourceSpanMiles: finiteOrNull(cell.lengthWeightedSourceSpanMiles ?? cell.avgLengthWeightedSourceSpanMiles),
          observedAt: String(cell.observedAt || cell.lastObservedAt || response.observedAt || response.hourEnd || ""),
          firstObservedAt: String(cell.firstObservedAt || response.windowStart || ""),
          slowdownFrequency: finiteOrNull(slowdownFrequency),
          heavySlowdownFrequency: finiteOrNull(cell.heavySlowdownFrequency),
          severeSlowdownFrequency: finiteOrNull(cell.severeSlowdownFrequency),
          stoppedFrequency: finiteOrNull(cell.stoppedFrequency),
          sampledHourCount: finiteOrNull(cell.sampledHourCount),
          requestedHourCount: finiteOrNull(response.requestedHourCount),
          resolution: String(response.resolution || "CURRENT")
        },
        geometry: { type: "LineString", coordinates: geometry }
      }];
    });
    return { type: "FeatureCollection", features };
  }

  function normalizedDirection(direction) {
    const normalized = String(direction || "COMBINED").trim().toUpperCase();
    return ({ N: "NORTHBOUND", S: "SOUTHBOUND", E: "EASTBOUND", W: "WESTBOUND" })[normalized]
      || normalized;
  }

  function lineCoordinates(geometry) {
    if (geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates)) return [];
    return geometry.coordinates.filter(validPoint);
  }

  function measuredRoute(coordinates) {
    const distances = [0];
    for (let index = 1; index < coordinates.length; index += 1) {
      distances.push(distances[index - 1] + distanceMiles(coordinates[index - 1], coordinates[index]));
    }
    return { coordinates, distances, length: distances.at(-1) || 0 };
  }

  function routeMarkerAnchors(feature, route) {
    const properties = feature?.properties || {};
    const configured = parseMarkerAnchors(properties.mileMarkerAnchorsJson)
      .map(anchor => ({ marker: anchor.mileMarker, distance: nearestRouteDistance(route, [anchor.longitude, anchor.latitude]) }))
      .filter(anchor => Number.isFinite(anchor.marker) && Number.isFinite(anchor.distance));
    const startMarker = finiteNumber(properties.startMileMarker);
    const endMarker = finiteNumber(properties.endMileMarker);
    const markerIncreasesWithRoute = markerDirection(properties.direction, configured);
    if (Number.isFinite(startMarker) && !configured.some(anchor => anchor.marker === startMarker)) {
      configured.push({ marker: startMarker, distance: markerIncreasesWithRoute ? 0 : route.length });
    }
    if (Number.isFinite(endMarker) && !configured.some(anchor => anchor.marker === endMarker)) {
      configured.push({ marker: endMarker, distance: markerIncreasesWithRoute ? route.length : 0 });
    }
    return configured
      .sort((left, right) => left.marker - right.marker)
      .filter((anchor, index, anchors) => index === 0 || anchor.marker !== anchors[index - 1].marker);
  }

  function markerDirection(direction, anchors) {
    if (anchors.length >= 2) {
      const byMarker = [...anchors].sort((left, right) => left.marker - right.marker);
      if (byMarker.at(-1).distance !== byMarker[0].distance) {
        return byMarker.at(-1).distance > byMarker[0].distance;
      }
    }
    return !["SOUTHBOUND", "WESTBOUND"].includes(normalizedDirection(direction));
  }

  function parseMarkerAnchors(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function nearestRouteDistance(route, point) {
    if (!validPoint(point)) return Number.NaN;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestRouteDistance = Number.NaN;
    for (let index = 1; index < route.coordinates.length; index += 1) {
      const start = route.coordinates[index - 1];
      const end = route.coordinates[index];
      const projection = segmentProjection(point, start, end);
      const distance = distanceMiles(point, projection.point);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRouteDistance = route.distances[index - 1]
          + (route.distances[index] - route.distances[index - 1]) * projection.ratio;
      }
    }
    return bestRouteDistance;
  }

  function segmentProjection(point, start, end) {
    const latitudeScale = Math.cos(((point[1] + start[1] + end[1]) / 3) * Math.PI / 180);
    const startX = start[0] * latitudeScale;
    const endX = end[0] * latitudeScale;
    const pointX = point[0] * latitudeScale;
    const dx = endX - startX;
    const dy = end[1] - start[1];
    const denominator = dx * dx + dy * dy;
    const rawRatio = denominator === 0 ? 0 : ((pointX - startX) * dx + (point[1] - start[1]) * dy) / denominator;
    const ratio = Math.max(0, Math.min(1, rawRatio));
    return { ratio, point: [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio] };
  }

  function markerDistance(marker, anchors) {
    if (!Number.isFinite(marker) || anchors.length === 0) return Number.NaN;
    if (marker <= anchors[0].marker) return anchors[0].distance;
    if (marker >= anchors.at(-1).marker) return anchors.at(-1).distance;
    for (let index = 1; index < anchors.length; index += 1) {
      const upper = anchors[index];
      const lower = anchors[index - 1];
      if (marker <= upper.marker) {
        const ratio = (marker - lower.marker) / (upper.marker - lower.marker);
        return lower.distance + (upper.distance - lower.distance) * ratio;
      }
    }
    return Number.NaN;
  }

  function routeSlice(route, firstDistance, secondDistance) {
    if (![firstDistance, secondDistance].every(Number.isFinite)) return [];
    const start = Math.max(0, Math.min(route.length, Math.min(firstDistance, secondDistance)));
    const end = Math.max(0, Math.min(route.length, Math.max(firstDistance, secondDistance)));
    if (end - start < 0.0001) return [];
    const points = [pointAtRouteDistance(route, start)];
    for (let index = 1; index < route.coordinates.length - 1; index += 1) {
      if (route.distances[index] > start && route.distances[index] < end) points.push(route.coordinates[index]);
    }
    points.push(pointAtRouteDistance(route, end));
    return firstDistance <= secondDistance ? points : points.reverse();
  }

  function pointAtRouteDistance(route, distance) {
    if (distance <= 0) return route.coordinates[0];
    if (distance >= route.length) return route.coordinates.at(-1);
    for (let index = 1; index < route.distances.length; index += 1) {
      if (distance <= route.distances[index]) {
        const segmentLength = route.distances[index] - route.distances[index - 1];
        const ratio = segmentLength === 0 ? 0 : (distance - route.distances[index - 1]) / segmentLength;
        const start = route.coordinates[index - 1];
        const end = route.coordinates[index];
        return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
      }
    }
    return route.coordinates.at(-1);
  }

  function postedSpeedForCell(feature, start, end) {
    const midpoint = (start + end) / 2;
    const segments = Array.isArray(feature?.properties?.speedLimitSegments)
      ? feature.properties.speedLimitSegments : [];
    const match = segments.find(segment => {
      const segmentStart = finiteNumber(segment.startMileMarker);
      const segmentEnd = finiteNumber(segment.endMileMarker);
      return Number.isFinite(segmentStart) && Number.isFinite(segmentEnd)
        && midpoint >= Math.min(segmentStart, segmentEnd)
        && midpoint <= Math.max(segmentStart, segmentEnd);
    });
    return finiteNumber(match?.speedLimitMph);
  }

  function trafficCondition(cell, speed, postedSpeed) {
    if (!Number.isFinite(speed)) return "UNKNOWN";
    if (speed <= 3 || String(cell?.closureEvidence || "NONE") === "FULL_REPORTED") return "STOPPED";
    const ratio = speedRatio(speed, postedSpeed);
    if (!Number.isFinite(ratio)) return "UNKNOWN";
    if (ratio >= 1.05) return "ABOVE_EXPECTED";
    if (ratio >= 0.8) return "EXPECTED";
    if (ratio >= 0.6) return "SLOWING";
    if (ratio >= 0.35) return "HEAVY";
    return "SEVERE";
  }

  function frequencyCondition(value) {
    if (!Number.isFinite(value)) return "UNKNOWN";
    if (value >= 0.8) return "PERSISTENT_SLOWDOWN";
    if (value >= 0.5) return "FREQUENT_SLOWDOWN";
    if (value >= 0.25) return "RECURRING_SLOWDOWN";
    if (value >= 0.1) return "OCCASIONAL_SLOWDOWN";
    return "RARE_SLOWDOWN";
  }

  function speedRatio(speed, postedSpeed) {
    return Number.isFinite(speed) && Number.isFinite(postedSpeed) && postedSpeed > 0
      ? speed / postedSpeed : Number.NaN;
  }

  function hourlyQuality(cell) {
    return Number(cell?.fullCellObservationCount) > 0 ? "FULL_CELL" : "PARTIAL_CELL";
  }

  function hourlyClosureEvidence(cell) {
    return Number(cell?.closureObservationCount) > 0 ? "REPORTED_DURING_HOUR" : "NONE";
  }

  function distanceMiles(first, second) {
    const radians = value => value * Math.PI / 180;
    const latitudeDelta = radians(second[1] - first[1]);
    const longitudeDelta = radians(second[0] - first[0]);
    const firstLatitude = radians(first[1]);
    const secondLatitude = radians(second[1]);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return 3958.7613 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return Number.NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function validPoint(coordinates) {
    return Array.isArray(coordinates)
      && Number.isFinite(coordinates[0])
      && Number.isFinite(coordinates[1])
      && Math.abs(coordinates[0]) <= 180
      && Math.abs(coordinates[1]) <= 90;
  }

  function showIncidentPopup(event) {
    const feature = event?.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!renderer?.Popup || !validPoint(coordinates)) return;
    const properties = feature.properties || {};
    const content = document.createElement("div");
    content.className = "corridor-map-popup";
    appendPopupText(content, "strong", incidentType(properties));
    appendPopupText(content, "span", String(properties.locationLabel || properties.referenceLabel || "Location unavailable"));
    appendPopupText(content, "span", incidentStatus(properties));
    new renderer.Popup({ closeButton: true, maxWidth: "18rem" })
      .setLngLat(coordinates)
      .setDOMContent(content)
      .addTo(map);
  }

  function showTrafficPopup(event) {
    const feature = event?.features?.[0];
    const properties = feature?.properties || {};
    const coordinates = event?.lngLat
      ? [event.lngLat.lng, event.lngLat.lat]
      : feature?.geometry?.coordinates?.[0];
    if (!renderer?.Popup || !validPoint(coordinates)) return;
    const content = document.createElement("div");
    content.className = "corridor-map-popup";
    if (properties.resolution === "SLOWDOWN_FREQUENCY") {
      appendFrequencyPopup(content, properties);
      new renderer.Popup({ closeButton: true, maxWidth: "19rem" })
        .setLngLat(coordinates)
        .setDOMContent(content)
        .addTo(map);
      return;
    }
    appendPopupText(content, "strong", `${conditionLabel(properties.condition)} · ${formatMileRange(properties)}`);
    const direction = properties.direction === "COMBINED" ? "Combined directions" : directionLabel(properties.direction);
    const speed = properties.speedMph === null ? Number.NaN : Number(properties.speedMph);
    appendPopupText(content, "span", Number.isFinite(speed)
      ? `${direction} · ${Math.round(speed)} mph observed`
      : `${direction} · observed speed unavailable`);
    const posted = properties.postedSpeedMph === null ? Number.NaN : Number(properties.postedSpeedMph);
    appendPopupText(content, "span", Number.isFinite(posted)
      ? `Compared with ${Math.round(posted)} mph posted speed`
      : "Posted-speed comparison unavailable");
    appendPopupText(content, "span", flowEvidenceLabel(properties));
    appendPopupText(content, "span", `Observed ${formatObservationTime(properties.observedAt)}`);
    new renderer.Popup({ closeButton: true, maxWidth: "19rem" })
      .setLngLat(coordinates)
      .setDOMContent(content)
      .addTo(map);
  }

  function appendFrequencyPopup(content, properties) {
    const slowdownFrequency = Number(properties.slowdownFrequency);
    const sampledHours = Number(properties.sampledHourCount);
    const requestedHours = Number(properties.requestedHourCount);
    const slowHours = Number.isFinite(slowdownFrequency) && Number.isFinite(sampledHours)
      ? Math.round(slowdownFrequency * sampledHours) : Number.NaN;
    appendPopupText(content, "strong", `${conditionLabel(properties.condition)} · ${formatMileRange(properties)}`);
    appendPopupText(content, "span", Number.isFinite(slowHours) && Number.isFinite(sampledHours)
      ? `${slowHours} of ${Math.round(sampledHours)} sampled hours below 80% of posted speed`
      : "Slowdown frequency unavailable");
    const stoppedFrequency = Number(properties.stoppedFrequency);
    const stoppedHours = Number.isFinite(stoppedFrequency) && Number.isFinite(sampledHours)
      ? Math.round(stoppedFrequency * sampledHours) : 0;
    if (stoppedHours > 0) {
      appendPopupText(content, "span", `${stoppedHours} sampled hours averaged 3 mph or less`);
    }
    const speed = Number(properties.speedMph);
    const posted = Number(properties.postedSpeedMph);
    appendPopupText(content, "span", Number.isFinite(speed) && Number.isFinite(posted)
      ? `${Math.round(speed)} mph average hourly speed · ${Math.round(posted)} mph posted`
      : "Average-speed comparison unavailable");
    const coverage = Number.isFinite(sampledHours) && Number.isFinite(requestedHours)
      ? `${Math.round(sampledHours)} of ${Math.round(requestedHours)} requested hours available`
      : "Historical coverage unavailable";
    appendPopupText(content, "span", `${coverage} · ${formatHistoryRange(properties.firstObservedAt, properties.observedAt)}`);
  }

  function appendPopupText(parent, tagName, value) {
    const element = document.createElement(tagName);
    element.textContent = value;
    parent.appendChild(element);
  }

  function incidentType(properties) {
    const label = String(properties.incidentDisplayLabel || properties.incidentTypeLabel || "").trim();
    if (label) return label;
    return String(properties.normalizedCategory || "Incident").toLowerCase().replaceAll("_", " ")
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  function incidentStatus(properties) {
    const state = properties.active === true || properties.active === "true" ? "Ongoing" : "Recently reported";
    const direction = String(properties.travelDirectionLabel || "").trim();
    const marker = Number(properties.closestMileMarker);
    const details = [direction, Number.isFinite(marker) ? `MM ${marker}` : ""].filter(Boolean).join(" · ");
    return `CDOT report · ${state}${details ? ` · ${details}` : ""}`;
  }

  function mapStatus(traffic, response, incidentStatusText, frequencyView) {
    const features = traffic.features;
    if (features.length === 0) {
      const unavailable = frequencyView
        ? "Slowdown history is unavailable for this range."
        : "Local flow is unavailable for current traffic.";
      return `USGS imagery · OSM-derived route · ${incidentStatusText} · ${unavailable}`;
    }
    if (response?.resolution === "SLOWDOWN_FREQUENCY") {
      const available = Number(response.availableHourCount);
      const requested = Number(response.requestedHourCount);
      const coverage = Number.isFinite(available) && Number.isFinite(requested)
        ? `${available} of ${requested} requested hours available`
        : "historical coverage unavailable";
      return `USGS imagery · ${features.length} one-mile slowdown-frequency intervals · ${coverage} · Slow means hourly average below 80% of posted speed · Through ${formatObservationTime(response.windowEnd)} · ${incidentStatusText}`;
    }
    const resolution = response?.resolution === "HOURLY" ? "hourly" : "current";
    const observedAt = response?.observedAt || response?.hourEnd || features[0]?.properties?.observedAt;
    const intervals = features.length === 1 ? "interval" : "intervals";
    const timeLabel = resolution === "current" ? "Current traffic as of" : "Traffic for the hour ending";
    return `USGS imagery · ${features.length} one-mile ${resolution} ${intervals} · ${timeLabel} ${formatObservationTime(observedAt)} · Combined directions · Compared with posted speeds · ${incidentStatusText}`;
  }

  function conditionLabel(condition) {
    if (condition === "PERSISTENT_SLOWDOWN") return "Persistent slowdown area";
    if (condition === "FREQUENT_SLOWDOWN") return "Frequent slowdown area";
    if (condition === "RECURRING_SLOWDOWN") return "Recurring slowdown area";
    if (condition === "OCCASIONAL_SLOWDOWN") return "Occasional slowdown area";
    if (condition === "RARE_SLOWDOWN") return "Rare slowdown area";
    if (condition === "ABOVE_EXPECTED") return "Above expected speed";
    if (condition === "EXPECTED") return "Expected traffic speed";
    if (condition === "SLOWING") return "Slowing traffic";
    if (condition === "HEAVY") return "Heavy traffic";
    if (condition === "SEVERE") return "Severe slowdown";
    if (condition === "STOPPED") return "Stopped traffic";
    return "Condition unavailable";
  }

  function formatMileRange(properties) {
    const start = Number(properties.startMileMarker);
    const end = Number(properties.endMileMarker);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "Mile marker unavailable";
    return `MM ${formatMarker(start)}–${formatMarker(end)}`;
  }

  function formatMarker(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  }

  function directionLabel(direction) {
    return ({
      N: "Northbound",
      S: "Southbound",
      E: "Eastbound",
      W: "Westbound",
      NORTHBOUND: "Northbound",
      SOUTHBOUND: "Southbound",
      EASTBOUND: "Eastbound",
      WESTBOUND: "Westbound"
    })[direction]
      || String(direction || "Direction unavailable");
  }

  function flowEvidenceLabel(properties) {
    const closure = String(properties.closureEvidence || "NONE");
    if (closure !== "NONE") {
      if (closure === "REPORTED_DURING_HOUR") return "TomTom reported closure evidence during part of this hour";
      if (closure === "FULL_REPORTED") return "TomTom reported a full-road closure in this interval";
      return closure === "ONE_SIDE_REPORTED" && properties.direction === "COMBINED"
        ? "TomTom reported a closure on one side; direction is not resolved"
        : "TomTom reported closure evidence for this interval";
    }
    const sourceSpan = properties.sourceSpanMiles === null ? Number.NaN : Number(properties.sourceSpanMiles);
    const quality = properties.quality === "PARTIAL_CELL" ? "Partial cell coverage" : "Full cell coverage";
    return Number.isFinite(sourceSpan)
      ? `${quality} · source evidence averages ${sourceSpan.toFixed(1)} mi`
      : quality;
  }

  function formatObservationTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "time unavailable";
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Denver", timeZoneName: "short"
    }).format(date);
  }

  function formatHistoryRange(first, last) {
    const firstDate = new Date(first);
    const lastDate = new Date(last);
    if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) return "dates unavailable";
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", timeZone: "America/Denver"
    });
    return `${formatter.format(firstDate)}–${formatter.format(lastDate)}`;
  }

  function geometryBounds(geometry) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    visitCoordinates(geometry?.coordinates, bounds);
    if (!bounds.every(Number.isFinite)) return null;
    return [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
  }

  function visitCoordinates(value, bounds) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      const [longitude, latitude] = value;
      if (Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90) {
        bounds[0] = Math.min(bounds[0], longitude);
        bounds[1] = Math.min(bounds[1], latitude);
        bounds[2] = Math.max(bounds[2], longitude);
        bounds[3] = Math.max(bounds[3], latitude);
      }
      return;
    }
    for (const child of value) visitCoordinates(child, bounds);
  }

  function corridorLabel(corridor) {
    return corridor === "I25" ? "I-25" : corridor === "I70" ? "I-70" : corridor;
  }

  function mapSubtitle(feature, frequencyView, selectedHours) {
    const range = String(feature?.properties?.mileMarkerRange || "").trim();
    const detail = frequencyView
      ? `Recurring slowdowns over ${Number(selectedHours) === 720 ? "30 days" : "7 days"}`
      : "Current one-mile traffic";
    return range ? `${range} · ${detail}` : detail;
  }

  function setLegendMode(frequencyView) {
    for (const item of document.querySelectorAll?.('[data-map-legend="current"]') || []) {
      item.hidden = frequencyView;
    }
    for (const item of document.querySelectorAll?.('[data-map-legend="frequency"]') || []) {
      item.hidden = !frequencyView;
    }
    if (legendNote) {
      legendNote.textContent = frequencyView
        ? "Slow hours below 80% of posted speed · black requires near-stops in at least 10% of sampled hours"
        : "Current traffic · combined directions · one-mile intervals";
    }
  }

  function setStatus(message) {
    status.textContent = message;
    status.title = message;
  }

  window.CorridorMapPanel = { hide, render, setTheme };
})();
