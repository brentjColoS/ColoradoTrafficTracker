(() => {
  const panel = document.getElementById("corridorMapPanel");
  const container = document.getElementById("corridorMap");
  const title = document.getElementById("corridorMapTitle");
  const subtitle = document.getElementById("corridorMapSubtitle");
  const status = document.getElementById("corridorMapStatus");
  const legendNote = document.getElementById("corridorMapLegendNote");
  const zoneReference = document.getElementById("corridorZoneReference");
  const zoneButtons = document.getElementById("corridorZoneButtons");
  const zoneReset = document.getElementById("corridorZoneReset");
  const emptyCollection = { type: "FeatureCollection", features: [] };
  const usgsBasemap = {
    provider: "USGS_IMAGERY",
    label: "USGS imagery",
    tileUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    overviewTileUrl: null,
    detailMinZoom: 0,
    maxZoom: 16,
    attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>'
  };
  const loadRenderer = window.CORRIDOR_MAP_RENDERER_LOADER
    || ((attempt) => attempt > 0
      ? import(`./vendor/maplibre-gl/6.10.0/maplibre-gl.mjs?retry=${attempt}`)
      : import("./vendor/maplibre-gl/6.10.0/maplibre-gl.mjs"));

  let renderer;
  let rendererReady;
  let rendererLoadAttempt = 0;
  let map;
  let mapReady;
  let renderVersion = 0;
  let focusedCorridor;
  let focusedHours;
  let mileMarkerCorridor;
  let mileMarkers = [];
  let speedBoundaryCorridor;
  let speedBoundaryMarkers = [];
  let speedReferenceMarkers = [];
  let variableSpeedMarkers = [];
  let variableSpeedSignature = "";
  let variableSpeedPopup = false;
  let activePopup;
  let basemap = usgsBasemap;
  let basemapUnavailable = false;
  let statusMessage = "";
  let zoneMode = false;
  let routeFeature;
  let zoneFeatureSignature = "";
  let zoneDefinitions = [];
  let zoneMarkers = [];
  let zoneSignature = "";
  let selectedZoneKey = null;
  let onZoneSelect;
  let zoneRoute;
  let zoneAnchors = [];
  let appliedZoneSelection;
  zoneReset?.addEventListener?.("click", () => selectZone(null, true));

  function hide() {
    renderVersion += 1;
    focusedCorridor = undefined;
    focusedHours = undefined;
    clearMileMarkers();
    clearSpeedBoundaryMarkers();
    clearVariableSpeedSigns();
    clearPopup();
    clearZones();
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
    const zoneModeChanged = zoneMode !== Boolean(payload.zoneMode);
    zoneMode = Boolean(payload.zoneMode);
    if (!zoneMode) clearZones();
    panel.hidden = false;
    title.textContent = zoneMode ? `${corridorLabel(corridor)} Zone Locator` : `${corridorLabel(corridor)} Corridor Traffic`;
    subtitle.textContent = zoneMode
      ? `${payload.corridorFeature?.properties?.mileMarkerRange || corridorLabel(corridor)} · Posted speed zones`
      : mapSubtitle(payload.corridorFeature, frequencyView, payload.selectedHours);
    setLegendMode(frequencyView);

    const feature = usableCorridorFeature(payload.corridorFeature);
    if (!feature) {
      setStatus("Route geometry is unavailable. The incident table remains available.");
      clearRoute();
      return;
    }

    setStatus("Loading map context and the tracked route…");
    try {
      await ensureMap();
      if (version !== renderVersion) return;
      if (zoneModeChanged || focusedCorridor !== corridor) setZoneLayerMode();
      if (focusedCorridor !== corridor || focusedHours !== Number(payload.selectedHours || 24)) clearPopup();
      map.getSource("corridor-route").setData({ type: "FeatureCollection", features: [feature] });
      const featureSignature = JSON.stringify([feature.geometry, feature.properties?.mileMarkerAnchorsJson,
        feature.properties?.speedLimitSegments, feature.properties?.startMileMarker, feature.properties?.endMileMarker]);
      if (featureSignature !== zoneFeatureSignature) {
        zoneFeatureSignature = featureSignature;
        zoneSignature = "";
      }
      routeFeature = feature;
      const traffic = trafficFeaturesForRoute(feature, oneMileCombinedCells(payload.flowCells), payload.flowCells);
      map.getSource("corridor-traffic").setData(traffic);
      const incidents = frequencyView
        ? incidentHotspotFeatures(feature, payload.incidentFeatures, corridor, payload.selectedHours)
        : usableIncidentFeatures(payload.incidentFeatures, corridor);
      map.getSource("corridor-incidents").setData({ type: "FeatureCollection", features: incidents });
      setVariableSpeedSigns(corridor === "I70" ? payload.variableSpeedSigns : null,
        payload.variableSpeedSignsConfirmed !== false);
      setMileMarkers(feature, corridor);
      if (zoneMode) clearSpeedBoundaryMarkers();
      else setSpeedBoundaryMarkers(feature, corridor);
      map.resize();
      if (focusedCorridor !== corridor || zoneModeChanged) {
        const bounds = geometryBounds(feature.geometry);
        if (bounds) map.fitBounds(bounds, { padding: zoneMode ? 48 : 34, maxZoom: 13, duration: 0 });
      }
      focusedCorridor = corridor;
      focusedHours = Number(payload.selectedHours || 24);
      setTheme(payload.theme);
      if (zoneMode) setZones(zoneDefinitions, selectedZoneKey, onZoneSelect);
      const incidentStatus = frequencyView
        ? incidents.length === 1 ? "1 incident hotspot"
          : incidents.length > 1 ? `${incidents.length} incident hotspots` : "No incident hotspots in this window"
        : incidents.length === 1 ? "1 mapped CDOT report"
          : incidents.length > 1 ? `${incidents.length} mapped CDOT reports` : "No mapped CDOT reports in this window";
      setStatus(zoneMode ? `Colors identify posted speed zones · ${incidentStatus}`
        : mapStatus(traffic, payload.flowCells, incidentStatus, frequencyView));
    } catch {
      if (version !== renderVersion) return;
      setStatus("The map renderer did not finish starting. Select Sync now to retry; reload if startup still fails. The incident table remains available.");
    }
  }

  async function ensureMap() {
    if (mapReady) return mapReady;
    mapReady = createMap().catch((error) => {
      clearMileMarkers();
      clearSpeedBoundaryMarkers();
      clearVariableSpeedSigns();
      try { map?.remove?.(); } catch { /* A partially initialized renderer may not support cleanup. */ }
      map = undefined;
      mapReady = undefined;
      throw error;
    });
    return mapReady;
  }

  async function preload() {
    try { await ensureRenderer(); } catch { /* A focused render can retry failed loading. */ }
  }

  async function ensureRenderer() {
    if (renderer) return renderer;
    if (!rendererReady) rendererReady = Promise.resolve()
      .then(() => loadRenderer(Math.min(rendererLoadAttempt++, 2)))
      .then(module => { renderer = module.default || module; return renderer; })
      .catch(error => { rendererReady = undefined; throw error; });
    return rendererReady;
  }

  async function createMap() {
    basemapUnavailable = false;
    await ensureRenderer();
    basemap = await loadBasemapConfig();
    map = new renderer.Map({
      container,
      cooperativeGestures: true,
      attributionControl: false,
      refreshExpiredTiles: false,
      style: mapStyle(document.documentElement.dataset.theme, basemap)
    });
    map.addControl(new renderer.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new renderer.AttributionControl({ compact: true }), "bottom-right");
    collapseAttribution();
    map.on("click", "corridor-incidents", showIncidentPopup);
    map.on("click", "corridor-traffic", showTrafficPopup);
    map.on("mouseenter", "corridor-incidents", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "corridor-incidents", () => { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "corridor-traffic", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "corridor-traffic", () => { map.getCanvas().style.cursor = ""; });
    map.on("zoom", updateMapMarkerVisibility);
    map.on("moveend", arrangeMapLabels);
    map.on("resize", arrangeMapLabels);
    map.on("error", (event) => {
      if (event?.sourceId === "base-map" || event?.sourceId === "base-map-overview") {
        basemapUnavailable = true;
        setStatus(statusMessage);
      }
    });
    await new Promise((resolve, reject) => {
      if (map.isStyleLoaded()) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => reject(new Error("Map style load timed out")), 15_000);
      map.once("style.load", () => {
        window.clearTimeout(timer);
        resolve();
      });
    });
    collapseAttribution();
    map.getCanvas().setAttribute("aria-label", "Interactive corridor traffic map");
  }

  function collapseAttribution() {
    const attribution = container.querySelector?.(".maplibregl-ctrl-attrib");
    attribution?.classList?.add?.("corridor-map-attribution-collapsed");
    enforceAttributionCollapse(attribution);
    const button = attribution?.querySelector?.(".maplibregl-ctrl-attrib-button");
    if (button && !button.dataset.corridorCollapseBound) {
      button.dataset.corridorCollapseBound = "true";
      button.addEventListener("click", (event) => {
        const initiallyCollapsed = attribution.classList.contains("corridor-map-attribution-collapsed");
        attribution.classList.remove("corridor-map-attribution-collapsed");
        if (initiallyCollapsed) {
          event.preventDefault();
          attribution.classList.add("maplibregl-compact-show");
          attribution.setAttribute("open", "");
        }
      });
    }
  }

  function enforceAttributionCollapse(attribution) {
    if (!attribution?.classList?.contains?.("corridor-map-attribution-collapsed")) return;
    attribution.classList.remove("maplibregl-compact-show");
    attribution.removeAttribute("open");
  }

  async function loadBasemapConfig() {
    if (typeof window.fetch !== "function") return usgsBasemap;
    const prefix = window.location.pathname.startsWith("/dashboard-experimental/")
      ? "/dashboard-experimental-api" : "/dashboard-api";
    try {
      const response = await window.fetch(`${prefix}/map/config`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!response.ok) return usgsBasemap;
      const config = await response.json();
      if (config?.provider !== "TRACESTRACK_TOPO"
          || !validTracestrackTileUrl(config.tileUrl)
          || !validTracestrackTileUrl(config.overviewTileUrl)) {
        return usgsBasemap;
      }
      const detailMinZoom = Number.isInteger(config.detailMinZoom) && config.detailMinZoom > 0
        ? config.detailMinZoom : 10;
      return {
        provider: config.provider,
        label: `Tracestrack overview · Topo detail at zoom ${detailMinZoom}+`,
        tileUrl: config.tileUrl,
        overviewTileUrl: config.overviewTileUrl,
        detailMinZoom,
        maxZoom: Number.isInteger(config.maxZoom) ? config.maxZoom : 19,
        attribution: String(config.attribution || "Maps © Tracestrack")
      };
    } catch {
      return usgsBasemap;
    }
  }

  function validTracestrackTileUrl(value) {
    if (typeof value !== "string" || !value.includes("{z}") || !value.includes("{x}") || !value.includes("{y}")) {
      return false;
    }
    try {
      const url = new URL(value.replace("{z}", "1").replace("{x}", "1").replace("{y}", "1"));
      return url.protocol === "https:" && url.hostname === "tile.tracestrack.com";
    } catch {
      return false;
    }
  }

  function clearRoute() {
    const source = map?.getSource?.("corridor-route");
    if (source) source.setData(emptyCollection);
    const incidents = map?.getSource?.("corridor-incidents");
    if (incidents) incidents.setData(emptyCollection);
    const traffic = map?.getSource?.("corridor-traffic");
    if (traffic) traffic.setData(emptyCollection);
    clearMileMarkers();
    clearSpeedBoundaryMarkers();
    clearVariableSpeedSigns();
    clearPopup();
    clearZones();
    routeFeature = undefined;
  }

  function clearZones() {
    for (const marker of zoneMarkers) marker.remove?.();
    zoneMarkers = [];
    zoneDefinitions = [];
    zoneSignature = "";
    selectedZoneKey = null;
    appliedZoneSelection = undefined;
    zoneRoute = undefined;
    zoneAnchors = [];
    if (zoneReference) zoneReference.hidden = true;
    map?.getSource?.("corridor-zone-highlight")?.setData(emptyCollection);
    map?.getSource?.("corridor-zones")?.setData(emptyCollection);
  }

  function setZoneLayerMode() {
    for (const layer of ["corridor-route", "corridor-traffic-casing", "corridor-traffic"]) {
      map.setLayoutProperty(layer, "visibility", zoneMode ? "none" : "visible");
    }
  }

  function setZones(groups, selection, callback) {
    if (!zoneMode) return;
    onZoneSelect = callback;
    zoneDefinitions = (Array.isArray(groups) ? groups : []).filter(group =>
      Number.isFinite(group.startMileMarker) && Number.isFinite(group.endMileMarker)
      && group.endMileMarker > group.startMileMarker)
      .map(group => ({...group, key: group.referenceKey || group.key}));
    selectedZoneKey = zoneDefinitions.some(group => group.key === selection) ? selection : null;
    if (!map?.getSource?.("corridor-zone-highlight") || !routeFeature) return;
    const signature = JSON.stringify([focusedCorridor, zoneDefinitions.map(group =>
      [group.key, group.referenceLabel, group.startMileMarker, group.endMileMarker, group.postedSpeedMph, group.referenceColor])]);
    if (signature !== zoneSignature) {
      for (const marker of zoneMarkers) marker.remove?.();
      zoneMarkers = [];
      zoneButtons?.replaceChildren?.();
      const route = measuredRoute(lineCoordinates(routeFeature.geometry));
      const anchors = routeMarkerAnchors(routeFeature, route);
      zoneRoute = route;
      zoneAnchors = anchors;
      appliedZoneSelection = undefined;
      const segments = routeFeature.properties?.speedLimitSegments || [];
      const zoneFeatures = [];
      for (const [index, group] of zoneDefinitions.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.zoneKey = group.key;
        const color = group.referenceColor || "#58c4e6";
        button.style.setProperty("--zone-color", color);
        const segment = segments.find(segment => Math.abs(Number(segment.startMileMarker) - group.startMileMarker) < 0.01
          && Math.abs(Number(segment.endMileMarker) - group.endMileMarker) < 0.01);
        const range = `MM ${formatMarker(group.startMileMarker)}–${formatMarker(group.endMileMarker)}`;
        const speed = Number.isFinite(group.postedSpeedMph) && group.postedSpeedMph > 0
          ? String(group.postedSpeedMph) : "—";
        button.title = `${group.referenceLabel} · ${segment?.description || range} · ${range} · ${speed === "—" ? "Posted limit unavailable" : `Posted limit ${speed} mph`}`;
        button.disabled = anchors.length < 2 || group.startMileMarker < anchors[0].marker
          || group.endMileMarker > anchors.at(-1).marker;
        const badge = document.createElement("b");
        badge.textContent = group.referenceLabel;
        const label = document.createElement("span");
        label.textContent = segment?.description || range;
        button.appendChild(badge);
        button.appendChild(label);
        button.setAttribute("aria-label", button.title);
        button.addEventListener("click", () => selectZone(group.key, true));
        zoneButtons?.appendChild?.(button);
        if (!renderer?.Marker || button.disabled) continue;
        const element = document.createElement("button");
        element.type = "button";
        element.className = "corridor-zone-marker";
        element.dataset.zoneKey = group.key;
        element.style.setProperty("--zone-color", color);
        element.textContent = `${group.referenceLabel} | ${speed}`;
        element.title = button.title;
        element.setAttribute("aria-label", button.title);
        element.addEventListener("click", event => { event.stopPropagation(); selectZone(group.key, true); });
        const distance = markerDistance((group.startMileMarker + group.endMileMarker) / 2, anchors);
        const offset = focusedCorridor === "I25" ? [index % 2 ? 44 : -44, 0] : [0, index % 2 ? 32 : -32];
        zoneMarkers.push(new renderer.Marker({element, anchor: "center", offset})
          .setLngLat(pointAtRouteDistance(route, distance)).addTo(map));
        const coordinates = routeSlice(route, markerDistance(group.startMileMarker, anchors), markerDistance(group.endMileMarker, anchors));
        if (coordinates.length >= 2) zoneFeatures.push({type: "Feature", properties: {zoneKey: group.key, color},
          geometry: {type: "LineString", coordinates}});
      }
      map.getSource("corridor-zones").setData({type: "FeatureCollection", features: zoneFeatures});
      arrangeZoneMarkers();
      zoneSignature = signature;
    }
    if (zoneReference) zoneReference.hidden = zoneDefinitions.length === 0;
    updateZoneSelection();
  }

  function arrangeZoneMarkers() {
    if (!zoneMode || !map?.project || !container.clientWidth || !container.clientHeight) return;
    const entries = zoneMarkers.map((marker, index) => ({marker, index,
      point: map.project(marker.getLngLat()), width: marker.getElement().offsetWidth || 70,
      height: marker.getElement().offsetHeight || 28}));
    const road = lineCoordinates(routeFeature?.geometry).map(coordinate => map.project(coordinate));
    const occupied = [];
    const moves = entries.map(({marker, index, point, width, height}) => {
      const preferred = focusedCorridor === "I25" ? [index % 2 ? 44 : -44, 0] : [0, index % 2 ? 32 : -32];
      const candidates = [preferred, [0, -32], [0, 32], [0, -64], [0, 64], [0, -96], [0, 96],
        [-44, 0], [44, 0], [-44, -64], [44, 64], [-88, -32], [88, -32], [-88, 32], [88, 32]];
      let chosen = preferred, bounds, fewestCrossings = Infinity;
      for (const offset of candidates) {
        const rect = {left: point.x + offset[0] - width / 2, right: point.x + offset[0] + width / 2,
          top: point.y + offset[1] - height / 2, bottom: point.y + offset[1] + height / 2};
        if (rect.left < 4 || rect.top < 4 || rect.right > container.clientWidth - 4 || rect.bottom > container.clientHeight - 4) continue;
        if (occupied.some(other => rect.left < other.right + 4 && rect.right > other.left - 4
          && rect.top < other.bottom + 4 && rect.bottom > other.top - 4)) continue;
        const clearance = {left: rect.left - 10, right: rect.right + 10,
          top: rect.top - 10, bottom: rect.bottom + 10};
        let crossings = 0;
        for (let i = 1; i < road.length; i++) {
          if (segmentCrossesBox(road[i - 1], road[i], clearance)) crossings++;
        }
        if (crossings >= fewestCrossings) continue;
        chosen = offset; bounds = rect; fewestCrossings = crossings;
        if (!crossings) break;
      }
      occupied.push(bounds || {left: point.x + chosen[0] - width / 2, right: point.x + chosen[0] + width / 2,
        top: point.y + chosen[1] - height / 2, bottom: point.y + chosen[1] + height / 2});
      return {marker, chosen};
    });
    for (const {marker, chosen} of moves) marker.setOffset(chosen);
  }

  function segmentCrossesBox(start, end, box) {
    if (Math.max(start.x, end.x) < box.left || Math.min(start.x, end.x) > box.right
        || Math.max(start.y, end.y) < box.top || Math.min(start.y, end.y) > box.bottom) return false;
    let near = 0, far = 1;
    for (const [axis, low, high] of [["x", box.left, box.right], ["y", box.top, box.bottom]]) {
      const delta = end[axis] - start[axis];
      if (!delta) {
        if (start[axis] < low || start[axis] > high) return false;
        continue;
      }
      const first = (low - start[axis]) / delta, last = (high - start[axis]) / delta;
      near = Math.max(near, Math.min(first, last));
      far = Math.min(far, Math.max(first, last));
      if (near > far) return false;
    }
    return true;
  }

  function updateZoneSelection() {
    if (appliedZoneSelection === selectedZoneKey) return;
    appliedZoneSelection = selectedZoneKey;
    for (const button of zoneButtons?.children || []) {
      button.setAttribute("aria-pressed", String(button.dataset.zoneKey === selectedZoneKey));
    }
    for (const marker of zoneMarkers) {
      const element = marker.getElement();
      element.setAttribute("aria-pressed", String(element.dataset.zoneKey === selectedZoneKey));
    }
    const selected = zoneDefinitions.find(group => group.key === selectedZoneKey);
    const source = map?.getSource?.("corridor-zone-highlight");
    if (!source || !routeFeature) return;
    const route = zoneRoute;
    const anchors = zoneAnchors;
    if (!selected || anchors.length < 2 || selected.startMileMarker < anchors[0].marker
        || selected.endMileMarker > anchors.at(-1).marker) {
      source.setData(emptyCollection);
      return;
    }
    const coordinates = routeSlice(route, markerDistance(selected.startMileMarker, anchors),
      markerDistance(selected.endMileMarker, anchors));
    source.setData({type: "FeatureCollection", features: coordinates.length < 2 ? [] : [{type: "Feature",
      properties: {zoneKey: selected.key}, geometry: {type: "LineString", coordinates}}]});
  }

  function selectZone(key, locate = false) {
    if (!zoneMode || (key !== null && !zoneDefinitions.some(group => group.key === key))) return;
    selectedZoneKey = key;
    updateZoneSelection();
    onZoneSelect?.(key);
    if (!locate || !map || !routeFeature) return;
    const selected = zoneDefinitions.find(group => group.key === key);
    const route = zoneRoute;
    const anchors = zoneAnchors;
    if (selected && (anchors.length < 2 || selected.startMileMarker < anchors[0].marker
        || selected.endMileMarker > anchors.at(-1).marker)) return;
    const geometry = selected && anchors.length >= 2 ? {type: "LineString", coordinates: routeSlice(route,
      markerDistance(selected.startMileMarker, anchors), markerDistance(selected.endMileMarker, anchors))} : routeFeature.geometry;
    const bounds = geometryBounds(geometry);
    if (bounds) map.fitBounds(bounds, {padding: 48, maxZoom: 12, duration: 0});
  }

  function setMileMarkers(routeFeature, corridor) {
    if (!renderer?.Marker || !map) return;
    if (mileMarkerCorridor === corridor && mileMarkers.length > 0) {
      updateMapMarkerVisibility();
      return;
    }
    clearMileMarkers();
    const coordinates = lineCoordinates(routeFeature?.geometry);
    if (coordinates.length < 2) return;
    const route = measuredRoute(coordinates);
    const anchors = routeMarkerAnchors(routeFeature, route);
    if (anchors.length < 2) return;
    const firstMarker = Math.ceil(Math.min(anchors[0].marker, anchors.at(-1).marker));
    const lastMarker = Math.floor(Math.max(anchors[0].marker, anchors.at(-1).marker));
    for (let marker = firstMarker; marker <= lastMarker; marker += 1) {
      const distance = markerDistance(marker, anchors);
      if (!Number.isFinite(distance)) continue;
      const element = document.createElement("span");
      element.className = "corridor-mile-marker";
      element.textContent = `MM ${marker}`;
      element.setAttribute("aria-label", `${corridorLabel(corridor)} mile marker ${marker}`);
      const instance = new renderer.Marker({ element, anchor: "center" })
        .setLngLat(pointAtRouteDistance(route, distance))
        .addTo(map);
      mileMarkers.push(instance);
    }
    mileMarkerCorridor = corridor;
    updateMapMarkerVisibility();
  }

  function updateMapMarkerVisibility() {
    if (!map?.getZoom) return;
    const visible = map.getZoom() >= 12;
    for (const marker of mileMarkers) {
      const element = marker.getElement?.();
      if (element) element.hidden = !visible;
    }
    for (const entry of variableSpeedMarkers) {
      entry.element.hidden = map.getZoom() < 11 && entry.regular && !entry.directionDifference;
    }
    for (const entry of speedReferenceMarkers) {
      entry.element.hidden = variableSpeedMarkers.some(sign => !sign.element.hidden && sign.confirmed
        && sign.mileMarker >= entry.startMileMarker && sign.mileMarker < entry.endMileMarker);
    }
    arrangeSpeedSigns();
  }

  function arrangeMapLabels() {
    arrangeZoneMarkers();
    arrangeSpeedSigns();
  }

  function speedSignContent(element, speed, label) {
    const value = document.createElement("strong");
    value.className = "corridor-speed-sign-value";
    value.textContent = speed === null ? "—" : String(speed);
    const footer = document.createElement("span");
    footer.className = "corridor-speed-sign-direction";
    footer.textContent = label;
    element.appendChild(value);
    element.appendChild(footer);
  }

  function speedSignMarkers(element, coordinates, offset) {
    const connector = document.createElement("span");
    connector.className = "corridor-speed-connector " + element.className.split(" ")
      .filter(name => ["is-above", "is-below", "is-right"].includes(name)).join(" ")
      + (element.className.includes("corridor-speed-reference") ? " is-reference" : "");
    connector.setAttribute("aria-hidden", "true");
    const connectorMarker = new renderer.Marker({element:connector, anchor:"center", offset})
      .setLngLat(coordinates).addTo(map);
    const marker = new renderer.Marker({element, anchor:"center", offset})
      .setLngLat(coordinates).addTo(map);
    return {marker, connector, connectorMarker};
  }

  function arrangeSpeedSigns() {
    const allEntries = [...variableSpeedMarkers, ...speedReferenceMarkers];
    for (const entry of allEntries) entry.connector.hidden = entry.element.hidden;
    if (!map?.project || !container.clientWidth || !container.clientHeight) return;
    const entries = allEntries.filter(entry => !entry.element.hidden);
    const horizontal = entries.some(entry => entry.horizontal);
    const viewportWidth = horizontal ? container.clientHeight : container.clientWidth;
    const viewportHeight = horizontal ? container.clientWidth : container.clientHeight;
    const road = lineCoordinates(routeFeature?.geometry).map(coordinate => {
      const point = map.project(coordinate);
      return horizontal ? {x:point.y, y:point.x} : point;
    });
    const occupied = [];
    for (const entry of entries) {
      const {marker, element, side, connector, connectorMarker} = entry;
      const projected = map.project(marker.getLngLat());
      const point = horizontal ? {x:projected.y, y:projected.x} : projected;
      element.style.visibility = connector.style.visibility = "";
      if (point.x < 0 || point.x > viewportWidth || point.y < 0 || point.y > viewportHeight) {
        element.style.visibility = connector.style.visibility = "hidden";
        continue;
      }
      const reference = element.className.includes("corridor-speed-reference");
      const faceWidth = element.offsetWidth || (reference ? 40 : 54);
      const faceHeight = element.offsetHeight || (reference ? 24 : 26);
      const width = horizontal ? faceHeight : faceWidth, height = horizontal ? faceWidth : faceHeight;
      const center = Math.max(width / 2 + 8, Math.min(viewportWidth - width / 2 - 8, point.x));
      const crossOffset = center - point.x;
      const preferred = side * (height / 2 + 10);
      const edgeOffset = Math.max(height / 2 + 8,
        Math.min(viewportHeight - height / 2 - 8, point.y + preferred)) - point.y;
      const roadSegments = [], roadOffsets = [];
      const left = center - width / 2 - 10, right = center + width / 2 + 10;
      for (let index = 1; index < road.length; index++) {
        const start = road[index - 1], end = road[index];
        if (Math.max(start.x, end.x) < left || Math.min(start.x, end.x) > right) continue;
        roadSegments.push([start, end]);
        let first = 0, last = 1;
        if (end.x !== start.x) {
          const a = (left - start.x) / (end.x - start.x), b = (right - start.x) / (end.x - start.x);
          first = Math.max(0, Math.min(a,b));
          last = Math.min(1, Math.max(a,b));
        }
        const firstY = start.y + first * (end.y - start.y), lastY = start.y + last * (end.y - start.y);
        roadOffsets.push(side < 0 ? Math.min(firstY,lastY) - 12 - height / 2 - point.y
          : Math.max(firstY,lastY) + 12 + height / 2 - point.y);
      }
      const candidates = [preferred, edgeOffset, ...roadOffsets, ...occupied.filter(other =>
        center - width / 2 < other.right + 8 && center + width / 2 > other.left - 8)
        .map(other => side < 0 ? other.top - 8 - height / 2 - point.y
          : other.bottom + 8 + height / 2 - point.y)]
        .filter(offset => side * offset >= height / 2 + 2).sort((a,b) => Math.abs(a) - Math.abs(b));
      let chosen = null;
      for (const offset of candidates) {
        const bounds = {left:center - width / 2, right:center + width / 2,
          top:point.y + offset - height / 2, bottom:point.y + offset + height / 2};
        if (bounds.top < 8 || bounds.bottom > viewportHeight - 8) continue;
        if (occupied.some(other => bounds.left < other.right + 6 && bounds.right > other.left - 6
          && bounds.top < other.bottom + 6 && bounds.bottom > other.top - 6)) continue;
        const clearance = {left:bounds.left - 10, right:bounds.right + 10,
          top:bounds.top - 10, bottom:bounds.bottom + 10};
        if (roadSegments.some(([start,end]) => segmentCrossesBox(start,end,clearance))) continue;
        chosen = offset;
        break;
      }
      if (chosen === null) {
        element.style.visibility = connector.style.visibility = "hidden";
        continue;
      }
      marker.setOffset(horizontal ? [chosen, crossOffset] : [crossOffset, chosen]);
      connectorMarker.setOffset(horizontal ? [chosen, crossOffset] : [crossOffset, chosen]);
      connector.style.width = `${faceWidth}px`;
      connector.style.height = `${faceHeight}px`;
      connector.style.setProperty("--sign-stem", `${Math.abs(chosen) - height / 2}px`);
      connector.style.setProperty("--sign-cross-offset", `${crossOffset}px`);
      occupied.push({left:center - width / 2, right:center + width / 2,
        top:point.y + chosen - height / 2, bottom:point.y + chosen + height / 2});
    }
  }

  function clearVariableSpeedSigns() {
    for (const entry of variableSpeedMarkers) { entry.marker.remove?.(); entry.connectorMarker.remove?.(); }
    variableSpeedMarkers = [];
    variableSpeedSignature = "";
    const note = document.getElementById("corridorVariableLimitStatus");
    const legend = document.getElementById("variableLimitLegend");
    if (note) note.hidden = true;
    if (legend) legend.hidden = true;
  }

  function setVariableSpeedSigns(snapshot, confirmed) {
    if (!renderer?.Marker || !map || !window.VariableSpeedSigns) return;
    const summary = window.VariableSpeedSigns.summary(snapshot, confirmed);
    const signature = JSON.stringify(summary.locations);
    if (signature === variableSpeedSignature) return;
    if (variableSpeedPopup) clearPopup();
    clearVariableSpeedSigns();
    variableSpeedSignature = signature;
    if (!snapshot || snapshot.corridor !== "I70") return;
    const note = document.getElementById("corridorVariableLimitStatus");
    const legend = document.getElementById("variableLimitLegend");
    if (note) {
      note.hidden = false;
      note.textContent = `Current CDOT limits · ${summary.locations.length} sign locations · ${summary.changed.length} different from regular reference · ${summary.unavailable.length} unconfirmed. Select a badge for direction and update time; zoom in for regular limits.`;
    }
    if (legend) legend.hidden = false;
    for (const group of summary.locations) {
      if (group.speed === null) continue;
      const element = document.createElement("button");
      element.type = "button";
      const side = group.direction === "EAST" ? -1 : 1;
      element.className = `corridor-variable-speed-sign corridor-speed-sign ${side < 0 ? "is-above" : "is-below"}`
        + (group.error ? " is-error" : group.uncertain ? " is-unavailable" : group.changed ? " is-reduced" : "");
      speedSignContent(element, group.speed, group.direction === "EAST" ? "E→" : "←W");
      if (group.uncertain) {
        const warning = document.createElement("span");
        warning.className = "corridor-speed-sign-warning";
        warning.textContent = "!";
        element.appendChild(warning);
      }
      element.setAttribute("aria-label", `I-70 ${group.direction.toLowerCase()}bound MM ${group.mileMarker}: ${group.speed === null ? "limit unavailable" : `${group.speed} mph`}${group.uncertain ? ", some sign reports unconfirmed" : ""}`);
      element.addEventListener("click", event => {
        event.stopPropagation?.();
        showVariableSpeedPopup(group);
      });
      const directionDifference = group.speed !== null && !group.uncertain && summary.locations.some(other =>
        other.direction !== group.direction && Math.abs(other.mileMarker - group.mileMarker) <= 1
        && other.speed !== null && !other.uncertain && other.speed !== group.speed);
      const markers = speedSignMarkers(element, [group.longitude, group.latitude], [0, side * 23]);
      variableSpeedMarkers.push({...markers, element, side, mileMarker:group.mileMarker, directionDifference,
        confirmed:group.speed !== null && !group.uncertain,
        regular:!group.changed && (!group.uncertain || group.signs.every(sign => sign.status === "NOT_OBSERVED"))});
    }
    updateMapMarkerVisibility();
  }

  function showVariableSpeedPopup(group) {
    const content = document.createElement("div");
    content.className = "corridor-map-popup";
    appendPopupText(content, "strong", `I-70 ${group.direction === "EAST" ? "eastbound" : "westbound"} · MM ${group.mileMarker}`);
    for (const sign of group.signs) {
      appendPopupText(content, "strong", sign.status === "AVAILABLE"
        ? `${sign.reportedLimitMph} mph · CDOT-reported posted limit`
        : window.VariableSpeedSigns.statusLabel(sign.status));
      if (sign.status !== "AVAILABLE" && sign.reportedLimitMph !== null) {
        appendPopupText(content, "span", `Last reported ${sign.reportedLimitMph} mph — unconfirmed`);
      }
      appendPopupText(content, "span", sign.location);
      appendPopupText(content, "span", `Source update: ${sign.sourceUpdatedAt ? formatObservationTime(sign.sourceUpdatedAt) : "unavailable"}`);
      appendPopupText(content, "span", `Last successful read: ${sign.fetchedAt ? formatObservationTime(sign.fetchedAt) : "unavailable"}`);
      if (sign.communicationStatus) appendPopupText(content, "span", `Communication: ${sign.communicationStatus} · display ${sign.displayStatus || "unknown"}`);
      appendPopupText(content, "span", `Regular road reference: ${sign.regularLimitMph ?? "unavailable"}${sign.regularLimitMph == null ? "" : " mph"}`);
    }
    appendPopupText(content, "small", "Sign locations only. The regular reference comes from configured road limits; CDOT does not supply a per-sign clear-weather maximum in this feed.");
    openPopup([group.longitude, group.latitude], content, "21rem");
    variableSpeedPopup = true;
  }

  function setSpeedBoundaryMarkers(routeFeature, corridor) {
    if (!renderer?.Marker || !map) return;
    const signature = `${corridor}:${zoneFeatureSignature}`;
    if (speedBoundaryCorridor === signature) return;
    clearSpeedBoundaryMarkers();
    const coordinates = lineCoordinates(routeFeature?.geometry);
    if (coordinates.length < 2) return;
    const route = measuredRoute(coordinates);
    const anchors = routeMarkerAnchors(routeFeature, route);
    if (anchors.length < 2) return;
    for (const boundary of speedBoundaries(routeFeature)) {
      const distance = markerDistance(boundary.marker, anchors);
      if (!Number.isFinite(distance)) continue;
      const element = document.createElement("span");
      element.className = "corridor-speed-boundary";
      element.style.setProperty("--boundary-rotation", corridor === "I25" ? "90deg" : "0deg");
      const markerLabel = formatMarker(boundary.marker);
      element.title = `Reference limit changes near MM ${markerLabel}: ${boundary.firstSpeed}–${boundary.secondSpeed} mph`;
      element.setAttribute(
        "aria-label",
        `${corridorLabel(corridor)} configured reference boundary near mile marker ${markerLabel}: ${boundary.firstSpeed} and ${boundary.secondSpeed} miles per hour`
      );
      const instance = new renderer.Marker({ element, anchor: "center" })
        .setLngLat(pointAtRouteDistance(route, distance))
        .addTo(map);
      speedBoundaryMarkers.push(instance);
    }
    const segments = (routeFeature.properties?.speedLimitSegments || [])
      .map(segment => ({startMileMarker:finiteNumber(segment.startMileMarker),
        endMileMarker:finiteNumber(segment.endMileMarker), speed:finiteNumber(segment.speedLimitMph)}))
      .filter(segment => Object.values(segment).every(Number.isFinite) && segment.speed > 0
        && segment.startMileMarker !== segment.endMileMarker)
      .map(segment => ({...segment, startMileMarker:Math.min(segment.startMileMarker, segment.endMileMarker),
        endMileMarker:Math.max(segment.startMileMarker, segment.endMileMarker)}))
      .sort((first, second) => first.startMileMarker - second.startMileMarker);
    const references = [];
    for (const segment of segments) {
      const previous = references.at(-1);
      if (previous && previous.speed === segment.speed && Math.abs(previous.endMileMarker - segment.startMileMarker) < 0.01) {
        previous.endMileMarker = segment.endMileMarker;
      } else references.push({...segment});
    }
    for (const segment of references) {
      if (segment.startMileMarker < anchors[0].marker || segment.endMileMarker > anchors.at(-1).marker) continue;
      const element = document.createElement("span");
      const horizontal = corridor === "I25";
      element.className = `corridor-speed-reference corridor-speed-sign ${horizontal ? "is-right" : "is-above"}`;
      speedSignContent(element, segment.speed, "ref");
      element.title = `${corridorLabel(corridor)} configured reference ${segment.speed} mph · MM ${formatMarker(segment.startMileMarker)}–${formatMarker(segment.endMileMarker)}; not a live sign reading`;
      element.setAttribute("aria-label", element.title);
      const distance = markerDistance((segment.startMileMarker + segment.endMileMarker) / 2, anchors);
      const markers = speedSignMarkers(element, pointAtRouteDistance(route, distance), horizontal ? [30, 0] : [0, -22]);
      speedReferenceMarkers.push({...markers, element, side:horizontal ? 1 : -1, horizontal, ...segment});
    }
    speedBoundaryCorridor = signature;
    updateMapMarkerVisibility();
  }

  function speedBoundaries(routeFeature) {
    const segments = (Array.isArray(routeFeature?.properties?.speedLimitSegments)
      ? routeFeature.properties.speedLimitSegments : [])
      .map(segment => {
        const start = finiteNumber(segment.startMileMarker);
        const end = finiteNumber(segment.endMileMarker);
        const speed = finiteNumber(segment.speedLimitMph);
        return { low: Math.min(start, end), high: Math.max(start, end), speed };
      })
      .filter(segment => [segment.low, segment.high, segment.speed].every(Number.isFinite))
      .sort((first, second) => first.low - second.low);
    const boundaries = [];
    for (let index = 1; index < segments.length; index += 1) {
      const first = segments[index - 1];
      const second = segments[index];
      if (first.speed === second.speed || Math.abs(second.low - first.high) > 0.1) continue;
      boundaries.push({
        marker: (first.high + second.low) / 2,
        firstSpeed: Math.round(first.speed),
        secondSpeed: Math.round(second.speed)
      });
    }
    return boundaries;
  }

  function clearMileMarkers() {
    for (const marker of mileMarkers) marker.remove?.();
    mileMarkers = [];
    mileMarkerCorridor = undefined;
  }

  function clearSpeedBoundaryMarkers() {
    for (const marker of speedBoundaryMarkers) marker.remove?.();
    for (const entry of speedReferenceMarkers) { entry.marker.remove?.(); entry.connectorMarker.remove?.(); }
    speedBoundaryMarkers = [];
    speedReferenceMarkers = [];
    speedBoundaryCorridor = undefined;
  }

  function setTheme(theme) {
    if (!map?.isStyleLoaded?.()) return;
    const dark = theme === "dark" || (!theme && document.documentElement.dataset.theme === "dark");
    if (map.getLayer("map-background")) {
      map.setPaintProperty("map-background", "background-color", dark ? "#17221c" : "#efece2");
    }
    if (map.getLayer("corridor-casing")) {
      map.setPaintProperty("corridor-casing", "line-color", dark ? "#f7f2df" : "#10251a");
    }
  }

  function mapStyle(theme, selectedBasemap = usgsBasemap) {
    const dark = theme === "dark";
    const splitBasemap = Boolean(selectedBasemap.overviewTileUrl && selectedBasemap.detailMinZoom > 0);
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
        ...(splitBasemap ? {
          "base-map-overview": {
            type: "raster",
            tiles: [selectedBasemap.overviewTileUrl],
            tileSize: 256,
            maxzoom: selectedBasemap.maxZoom,
            attribution: selectedBasemap.attribution
          }
        } : {}),
        "base-map": {
          type: "raster",
          tiles: [selectedBasemap.tileUrl],
          tileSize: 256,
          maxzoom: selectedBasemap.maxZoom,
          attribution: selectedBasemap.attribution
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
        },
        "corridor-zone-highlight": {
          type: "geojson", data: emptyCollection
        },
        "corridor-zones": {
          type: "geojson", data: emptyCollection
        }
      },
      layers: [
        { id: "map-background", type: "background", paint: { "background-color": dark ? "#17221c" : "#efece2" } },
        ...(splitBasemap ? [{
          id: "base-map-overview",
          type: "raster",
          source: "base-map-overview",
          maxzoom: selectedBasemap.detailMinZoom,
          paint: { "raster-opacity": 0.94 }
        }] : []),
        {
          id: "base-map",
          type: "raster",
          source: "base-map",
          ...(splitBasemap ? { minzoom: selectedBasemap.detailMinZoom } : {}),
          paint: { "raster-opacity": 0.94 }
        },
        {
          id: "corridor-casing",
          type: "line",
          source: "corridor-route",
          paint: { "line-color": dark ? "#f7f2df" : "#10251a", "line-width": 8, "line-opacity": 0.9 }
        },
        {
          id: "corridor-zone-highlight", type: "line", source: "corridor-zone-highlight",
          paint: {"line-color": "#fffdf2", "line-width": 13, "line-opacity": 1}
        },
        {
          id: "corridor-zones", type: "line", source: "corridor-zones",
          layout: {"line-cap": "butt", "line-join": "round"},
          paint: {"line-color": ["get", "color"], "line-width": 7, "line-opacity": 1}
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
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              7, [
                "case",
                ["==", ["get", "isHotspot"], true],
                ["interpolate", ["linear"], ["coalesce", ["get", "incidentCount"], 1], 1, 6, 5, 10, 20, 14],
                4
              ],
              13, [
                "case",
                ["==", ["get", "isHotspot"], true],
                ["interpolate", ["linear"], ["coalesce", ["get", "incidentCount"], 1], 1, 6, 5, 10, 20, 14],
                7
              ]
            ],
            "circle-color": [
              "case",
              ["==", ["get", "isHotspot"], true], "#7e343c",
              [
                "match", ["get", "normalizedCategory"],
                "CONSTRUCTION", "#d89b00",
                "DISABLED_VEHICLE", "#2f7a55",
                "CLOSURE", "#7e343c",
                "CRASH", "#9c4f59",
                "#6b6660"
              ]
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

  function incidentHotspotFeatures(routeFeature, features, corridor, selectedHours) {
    const coordinates = lineCoordinates(routeFeature?.geometry);
    if (coordinates.length < 2) return [];
    const route = measuredRoute(coordinates);
    const anchors = routeMarkerAnchors(routeFeature, route);
    if (anchors.length < 2) return [];

    const lowerMarker = Math.min(anchors[0].marker, anchors.at(-1).marker);
    const upperMarker = Math.max(anchors[0].marker, anchors.at(-1).marker);
    const groups = new Map();
    for (const feature of usableIncidentFeatures(features, corridor)) {
      const properties = feature.properties || {};
      const marker = finiteNumber(properties.closestMileMarker);
      if (!Number.isFinite(marker) || marker < lowerMarker || marker > upperMarker) continue;
      const bandStart = Math.min(
        Math.floor(upperMarker - 1e-9),
        Math.max(Math.floor(lowerMarker), Math.floor(marker))
      );
      const key = incidentIdentity(feature);
      const group = groups.get(bandStart) || {
        eventKeys: new Set(),
        activeEventKeys: new Set(),
        typeCounts: new Map(),
        firstSeenAt: "",
        lastSeenAt: ""
      };
      if (group.eventKeys.has(key)) continue;
      group.eventKeys.add(key);
      if (properties.active === true || properties.active === "true") group.activeEventKeys.add(key);
      const type = incidentType(properties);
      group.typeCounts.set(type, (group.typeCounts.get(type) || 0) + 1);
      group.firstSeenAt = earliestTimestamp(group.firstSeenAt, properties.firstSeenAt);
      group.lastSeenAt = latestTimestamp(group.lastSeenAt, properties.lastSeenAt);
      groups.set(bandStart, group);
    }

    return [...groups.entries()]
      .sort((left, right) => right[1].eventKeys.size - left[1].eventKeys.size
        || right[1].activeEventKeys.size - left[1].activeEventKeys.size
        || (Date.parse(right[1].lastSeenAt) || 0) - (Date.parse(left[1].lastSeenAt) || 0)
        || left[0] - right[0])
      .slice(0, 5)
      .flatMap(([bandStart, group]) => {
        const midpoint = Math.min(upperMarker, bandStart + 0.5);
        const distance = markerDistance(midpoint, anchors);
        if (!Number.isFinite(distance)) return [];
        const commonTypes = [...group.typeCounts.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .slice(0, 2)
          .map(([type]) => type)
          .join(" and ");
        return [{
          type: "Feature",
          id: `incident-hotspot-${corridor}-${bandStart}`,
          geometry: { type: "Point", coordinates: pointAtRouteDistance(route, distance) },
          properties: {
            corridor,
            isHotspot: true,
            incidentTypeLabel: "Incident hotspot",
            locationLabel: `MM ${formatMarker(bandStart)}–${formatMarker(Math.min(upperMarker, bandStart + 1))}`,
            incidentCount: group.eventKeys.size,
            activeIncidentCount: group.activeEventKeys.size,
            commonIncidentTypes: commonTypes,
            firstSeenAt: group.firstSeenAt,
            lastSeenAt: group.lastSeenAt,
            selectedHours: Number(selectedHours)
          }
        }];
      });
  }

  function incidentIdentity(feature) {
    const properties = feature?.properties || {};
    return [
      properties.incidentProvider || "unknown",
      properties.providerEventId || properties.referenceKey || properties.incidentRefId || feature?.id || "unknown"
    ].join("|");
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
    const markerIncreasesWithRoute = markerDirection(properties.direction || properties.primaryDirection, configured);
    const startIsLowerMarker = !Number.isFinite(startMarker) || !Number.isFinite(endMarker) || startMarker <= endMarker;
    const startAtBeginning = markerIncreasesWithRoute === startIsLowerMarker;
    if (Number.isFinite(startMarker) && !configured.some(anchor => anchor.marker === startMarker)) {
      configured.push({ marker: startMarker, distance: startAtBeginning ? 0 : route.length });
    }
    if (Number.isFinite(endMarker) && !configured.some(anchor => anchor.marker === endMarker)) {
      configured.push({ marker: endMarker, distance: startAtBeginning ? route.length : 0 });
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
    if (properties.isHotspot === true || properties.isHotspot === "true") {
      const incidentCount = Number(properties.incidentCount);
      const activeCount = Number(properties.activeIncidentCount);
      const range = Number(properties.selectedHours) === 720 ? "30 days" : "7 days";
      appendPopupText(content, "strong", `${Number.isFinite(incidentCount) ? incidentCount : "Multiple"} ${incidentCount === 1 ? "incident" : "incidents"} · ${properties.locationLabel || "Mile marker unavailable"}`);
      appendPopupText(content, "span", `One of the most frequent incident areas in the selected ${range}`);
      if (properties.commonIncidentTypes) {
        appendPopupText(content, "span", `Most often: ${properties.commonIncidentTypes}`);
      }
      if (Number.isFinite(activeCount) && activeCount > 0) {
        appendPopupText(content, "span", `${activeCount} currently listed by CDOT`);
      }
      openPopup(coordinates, content, "19rem");
      return;
    }
    appendPopupText(content, "strong", incidentType(properties));
    appendPopupText(content, "span", String(properties.locationLabel || properties.referenceLabel || "Location unavailable"));
    if (properties.incidentImpactLabel) {
      appendPopupText(content, "span", `Impact: ${properties.incidentImpactLabel}`);
    }
    if (properties.incidentNote && String(properties.incidentNote).toLowerCase() !== incidentType(properties).toLowerCase()) {
      appendPopupText(content, "span", String(properties.incidentNote));
    }
    appendPopupText(content, "span", incidentStatus(properties));
    openPopup(coordinates, content, "18rem");
  }

  function showTrafficPopup(event) {
    if (event?.point && map?.queryRenderedFeatures?.(event.point, { layers: ["corridor-incidents"] })?.length) {
      return;
    }
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
      openPopup(coordinates, content, "19rem");
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
    openPopup(coordinates, content, "19rem");
  }

  function openPopup(coordinates, content, maxWidth) {
    clearPopup();
    activePopup = new renderer.Popup({ closeButton: true, maxWidth })
      .setLngLat(coordinates)
      .setDOMContent(content)
      .addTo(map);
  }

  function clearPopup() {
    activePopup?.remove?.();
    activePopup = undefined;
    variableSpeedPopup = false;
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
    const label = String(properties.incidentTypeLabel || properties.sourceType || "").trim();
    if (label) return label;
    return String(properties.normalizedCategory || "Incident").toLowerCase().replaceAll("_", " ")
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  function incidentStatus(properties) {
    const status = String(properties.normalizedStatus || "").toLowerCase();
    const planned = status.includes("planned") || status.includes("scheduled");
    const state = planned ? "Planned"
      : properties.active === true || properties.active === "true" ? "Ongoing" : "Recently reported";
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
        : "Local flow is unavailable for this time.";
      return `${unavailable} · ${incidentStatusText}`;
    }
    if (response?.resolution === "SLOWDOWN_FREQUENCY") {
      return `Slowdown history through ${formatObservationTime(response.windowEnd)} · ${incidentStatusText}`;
    }
    const resolution = response?.resolution === "HOURLY" ? "hourly" : "current";
    const observedAt = response?.observedAt || features[0]?.properties?.observedAt || response?.hourEnd;
    const timeLabel = resolution === "current" ? "Current traffic as of" : "Hourly traffic observed";
    return `${timeLabel} ${formatObservationTime(observedAt)} · ${incidentStatusText}`;
  }

  function conditionLabel(condition) {
    if (condition === "PERSISTENT_SLOWDOWN") return "Very high slowdown rate";
    if (condition === "FREQUENT_SLOWDOWN") return "High slowdown rate";
    if (condition === "RECURRING_SLOWDOWN") return "Moderate slowdown rate";
    if (condition === "OCCASIONAL_SLOWDOWN") return "Low slowdown rate";
    if (condition === "RARE_SLOWDOWN") return "Low slowdown rate";
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
      item.hidden = zoneMode || frequencyView;
    }
    for (const item of document.querySelectorAll?.('[data-map-legend="frequency"]') || []) {
      item.hidden = zoneMode || !frequencyView;
    }
    if (legendNote) {
      legendNote.textContent = zoneMode
        ? "Zone colors match graph badges · bubbles show Z number | posted mph, not traffic speed"
        : frequencyView
        ? "Slow hours below 80% of posted speed · black requires near-stops in at least 10% of sampled hours"
        : "Current traffic · combined directions · one-mile intervals";
      if (!zoneMode) legendNote.textContent += " · limits in mph; ref = configured limit";
    }
  }

  function setStatus(message) {
    statusMessage = message;
    const visibleMessage = basemapUnavailable
      ? `${basemap.label} tiles could not load. Reload to retry. · ${message}`
      : message;
    status.textContent = visibleMessage;
    status.title = visibleMessage;
  }

  window.CorridorMapPanel = { hide, preload, render, setTheme, setZones, selectZone };
})();
