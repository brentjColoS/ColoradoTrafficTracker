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
  const mapData = window.CorridorMapData.create({ types: window.IncidentTypes, emptyCollection });
  const usgsBasemap = {
    provider: "USGS_IMAGERY",
    label: "USGS imagery",
    tileUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    overviewTileUrl: null,
    detailMinZoom: 0,
    maxZoom: 16,
    attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>'
  };
  const mapStyleDefinition = window.CorridorMapStyle.create({ emptyCollection, usgsBasemap });
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
  let variableSpeedAreas = [];
  let variableSpeedAreaSignature = "";
  let variableSpeedSignature = "";
  let variableSpeedPopup = false;
  let mapIncidentFeatures = [];
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

    const feature = mapData.usableCorridorFeature(payload.corridorFeature);
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
      const traffic = mapData.trafficFeaturesForRoute(feature, mapData.oneMileCombinedCells(payload.flowCells), payload.flowCells);
      map.getSource("corridor-traffic").setData(traffic);
      const incidents = frequencyView
        ? mapData.incidentHotspotFeatures(feature, payload.incidentFeatures, corridor, payload.selectedHours)
        : mapData.usableIncidentFeatures(payload.incidentFeatures, corridor);
      mapIncidentFeatures = incidents;
      map.getSource("corridor-incidents").setData({ type: "FeatureCollection", features: incidents });
      setVariableSpeedSigns(corridor === "I70" ? payload.variableSpeedSigns : null,
        payload.variableSpeedSignsConfirmed !== false);
      setMileMarkers(feature, corridor);
      if (zoneMode) clearSpeedBoundaryMarkers();
      else setSpeedBoundaryMarkers(feature, corridor);
      map.resize();
      if (focusedCorridor !== corridor || zoneModeChanged) {
        const bounds = mapData.geometryBounds(feature.geometry);
        if (bounds) map.fitBounds(bounds, { padding: zoneMode ? 48 : 34, maxZoom: 13, duration: 0 });
      }
      focusedCorridor = corridor;
      focusedHours = Number(payload.selectedHours || 24);
      setTheme(payload.theme);
      if (zoneMode) {
        setZones(zoneDefinitions, selectedZoneKey, onZoneSelect);
        arrangeSpeedSigns();
      }
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
      style: mapStyleDefinition.mapStyle(document.documentElement.dataset.theme, basemap)
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
    map.on("zoom", arrangeMapLabels);
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
    mapIncidentFeatures = [];
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
      const route = mapData.measuredRoute(mapData.lineCoordinates(routeFeature.geometry));
      const anchors = mapData.routeMarkerAnchors(routeFeature, route);
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
        const range = `MM ${mapData.formatMarker(group.startMileMarker)}–${mapData.formatMarker(group.endMileMarker)}`;
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
        const distance = mapData.markerDistance((group.startMileMarker + group.endMileMarker) / 2, anchors);
        const offset = focusedCorridor === "I25" ? [index % 2 ? 44 : -44, 0] : [0, index % 2 ? 32 : -32];
        zoneMarkers.push(new renderer.Marker({element, anchor: "center", offset})
          .setLngLat(mapData.pointAtRouteDistance(route, distance)).addTo(map));
        const coordinates = mapData.routeSlice(route, mapData.markerDistance(group.startMileMarker, anchors), mapData.markerDistance(group.endMileMarker, anchors));
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
    const road = mapData.lineCoordinates(routeFeature?.geometry).map(coordinate => map.project(coordinate));
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
    const coordinates = mapData.routeSlice(route, mapData.markerDistance(selected.startMileMarker, anchors),
      mapData.markerDistance(selected.endMileMarker, anchors));
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
    const geometry = selected && anchors.length >= 2 ? {type: "LineString", coordinates: mapData.routeSlice(route,
      mapData.markerDistance(selected.startMileMarker, anchors), mapData.markerDistance(selected.endMileMarker, anchors))} : routeFeature.geometry;
    const bounds = mapData.geometryBounds(geometry);
    if (bounds) map.fitBounds(bounds, {padding: 48, maxZoom: 12, duration: 0});
  }

  function setMileMarkers(routeFeature, corridor) {
    if (!renderer?.Marker || !map) return;
    if (mileMarkerCorridor === corridor && mileMarkers.length > 0) {
      updateMapMarkerVisibility();
      return;
    }
    clearMileMarkers();
    const coordinates = mapData.lineCoordinates(routeFeature?.geometry);
    if (coordinates.length < 2) return;
    const route = mapData.measuredRoute(coordinates);
    const anchors = mapData.routeMarkerAnchors(routeFeature, route);
    if (anchors.length < 2) return;
    const firstMarker = Math.ceil(Math.min(anchors[0].marker, anchors.at(-1).marker));
    const lastMarker = Math.floor(Math.max(anchors[0].marker, anchors.at(-1).marker));
    for (let marker = firstMarker; marker <= lastMarker; marker += 1) {
      const distance = mapData.markerDistance(marker, anchors);
      if (!Number.isFinite(distance)) continue;
      const element = document.createElement("span");
      element.className = "corridor-mile-marker";
      element.textContent = `MM ${marker}`;
      element.setAttribute("aria-label", `${corridorLabel(corridor)} mile marker ${marker}`);
      const instance = new renderer.Marker({ element, anchor: "center" })
        .setLngLat(mapData.pointAtRouteDistance(route, distance))
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
      entry.element.hidden = false;
    }
    updateSpeedAreas();
    for (const entry of speedReferenceMarkers) {
      entry.element.hidden = false;
    }
    arrangeSpeedSigns();
  }

  function arrangeMapLabels() {
    arrangeZoneMarkers();
    updateMapMarkerVisibility();
  }

  function updateSpeedAreas() {
    if (!map?.project) return;
    const overview = map.getZoom() < 11;
    const clusters = variableSpeedMarkers.filter(entry => !entry.element.hidden).filter(entry => {
      const point = map.project(entry.marker.getLngLat());
      return point.x >= 0 && point.y >= 0 && point.x <= container.clientWidth && point.y <= container.clientHeight;
    }).map(entry => [entry]);
    const center = entries => ["longitude", "latitude"].map(key =>
      entries.reduce((total, entry) => total + entry.group[key], 0) / entries.length);
    const bounds = entries => {
      const point = map.project(entries.length === 1 ? entries[0].marker.getLngLat() : center(entries));
      const area = overview || entries.length > 1;
      const width = area ? 146 : 54, height = area ? 32 : 26;
      const side = area ? -1 : entries[0].side;
      const x = Math.max(width / 2 + 8, Math.min(container.clientWidth - width / 2 - 8, point.x));
      const y = point.y + side * (height / 2 + 10);
      return {left:x-width/2, right:x+width/2, top:y-height/2, bottom:y+height/2};
    };
    // Recheck the merged badge's bounds: its center and width can create a new collision.
    for (let first = 0; first < clusters.length; first += 1) {
      const a = bounds(clusters[first]);
      const next = clusters.findIndex((entries, index) => {
        if (index <= first) return false;
        const b = bounds(entries);
        return a.left < b.right + 10 && a.right + 10 > b.left && a.top < b.bottom + 10 && a.bottom + 10 > b.top;
      });
      if (next < 0) continue;
      clusters[first].push(...clusters.splice(next, 1)[0]);
      first = -1;
    }
    const areas = clusters.filter(entries => overview || entries.length > 1);
    for (const entry of variableSpeedMarkers) entry.inArea = false;
    for (const entries of areas) for (const entry of entries) {
      entry.inArea = true;
      entry.element.hidden = true;
    }
    const signature = JSON.stringify(areas.map(entries => entries.map(entry => entry.group.signs.map(sign => sign.id))));
    if (signature === variableSpeedAreaSignature) return;
    for (const entry of variableSpeedAreas) { entry.marker.remove?.(); entry.connectorMarker.remove?.(); }
    variableSpeedAreas = [];
    variableSpeedAreaSignature = signature;
    if (variableSpeedPopup) clearPopup();
    for (const entries of areas) {
      const groups = entries.map(entry => entry.group).sort((a,b) => a.mileMarker-b.mileMarker);
      const label = groups.some(group => group.reduced) ? "Speed Limit Reduced"
        : groups.some(group => group.changed) ? "Speed Limits Changed" : "Posted Speed Limits";
      const element = document.createElement("button");
      element.type = "button";
      element.className = "corridor-speed-area corridor-speed-sign is-above";
      element.textContent = label;
      const first = mapData.formatMarker(groups[0].mileMarker), last = mapData.formatMarker(groups.at(-1).mileMarker);
      element.setAttribute("aria-label", `${label} near I-70 MM ${first === last ? first : `${first}–${last}`}; ${groups.length} sign location${groups.length === 1 ? "" : "s"}. Select for details`);
      const coordinates = center(entries);
      element.addEventListener("click", event => {
        event.stopPropagation?.();
        showSpeedAreaPopup(groups, coordinates, label, variableSpeedAreas.find(entry => entry.element === element));
      });
      const markers = speedSignMarkers(element, coordinates, [0, -26]);
      variableSpeedAreas.push({...markers, element, side:-1});
    }
  }

  function showSpeedAreaPopup(groups, coordinates, label, entry) {
    const content = document.createElement("div");
    content.className = "corridor-map-popup corridor-speed-area-popup";
    appendPopupText(content, "strong", label);
    for (const direction of ["EAST", "WEST"]) {
      const locations = groups.filter(group => group.direction === direction);
      if (!locations.length) continue;
      const speeds = locations.map(group => group.speed);
      const range = Math.min(...speeds) === Math.max(...speeds) ? `${speeds[0]}` : `${Math.min(...speeds)}–${Math.max(...speeds)}`;
      appendPopupText(content, "span", `${direction === "EAST" ? "Eastbound" : "Westbound"}: ${range} mph · ${locations.length} sign location${locations.length === 1 ? "" : "s"}`);
    }
    appendPopupText(content, "small", "Compared with regular sign/road references. Reports identify sign locations; the gaps between signs are not a verified continuous restriction. Zoom in for individual signs.");
    for (const group of groups) {
      const details = document.createElement("details");
      appendPopupText(details, "summary", `${group.direction === "EAST" ? "Eastbound" : "Westbound"} · MM ${mapData.formatMarker(group.mileMarker)} · ${group.speed} mph`);
      appendVariableSpeedDetails(details, group);
      content.appendChild(details);
    }
    const offset = entry?.marker.getOffset?.() || {x:0,y:-40};
    const point = map.project(coordinates);
    const side = offset.y < 0 ? -1 : 1;
    const available = side < 0 ? point.y + offset.y : container.clientHeight - point.y - offset.y;
    content.style.maxHeight = `${Math.max(24, Math.min(230, available - 72))}px`;
    const width = Math.min(336, container.clientWidth - 24);
    const x = point.x + offset.x;
    const edge = x < width / 2 + 12 ? "-left" : x > container.clientWidth - width / 2 - 12 ? "-right" : "";
    openPopup(coordinates, content, `${width}px`, {
      anchor:`${side < 0 ? "bottom" : "top"}${edge}`, offset:[offset.x, offset.y + side * 24]
    });
    variableSpeedPopup = true;
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
      + (element.className.includes("corridor-speed-reference") ? " is-reference" : "")
      + (element.className.includes("corridor-speed-area") ? " is-area" : "");
    connector.setAttribute("aria-hidden", "true");
    const connectorMarker = new renderer.Marker({element:connector, anchor:"center", offset})
      .setLngLat(coordinates).addTo(map);
    const marker = new renderer.Marker({element, anchor:"center", offset})
      .setLngLat(coordinates).addTo(map);
    return {marker, connector, connectorMarker};
  }

  function speedSignObstacles(horizontal) {
    const boxes = [];
    const add = (point, width, height) => {
      if (horizontal) { point = {x:point.y, y:point.x}; [width,height] = [height,width]; }
      boxes.push({left:point.x-width/2, right:point.x+width/2, top:point.y-height/2, bottom:point.y+height/2});
    };
    for (const feature of mapIncidentFeatures) {
      if (feature.geometry?.type !== "Point") continue;
      const zoomFraction = Math.max(0, Math.min(1, (map.getZoom() - 7) / 6));
      const diameter = feature.properties?.isHotspot ? 32 : 2 * (4 + 3 * zoomFraction + 2);
      add(map.project(feature.geometry.coordinates), diameter, diameter);
    }
    for (const marker of [...mileMarkers, ...zoneMarkers]) {
      const element = marker.getElement?.();
      if (!element || element.hidden || element.style?.visibility === "hidden") continue;
      const point = map.project(marker.getLngLat());
      const offset = marker.getOffset?.() || {x:0,y:0};
      add({x:point.x+offset.x,y:point.y+offset.y}, element.offsetWidth || 70, element.offsetHeight || 24);
    }
    return boxes;
  }

  function arrangeSpeedSigns() {
    const allEntries = [...speedReferenceMarkers, ...variableSpeedMarkers, ...variableSpeedAreas];
    for (const entry of allEntries) entry.connector.hidden = entry.element.hidden;
    if (!map?.project || !container.clientWidth || !container.clientHeight) return;
    const entries = allEntries.filter(entry => !entry.element.hidden);
    const horizontal = entries.some(entry => entry.horizontal);
    const viewportWidth = horizontal ? container.clientHeight : container.clientWidth;
    const viewportHeight = horizontal ? container.clientWidth : container.clientHeight;
    const road = mapData.lineCoordinates(routeFeature?.geometry).map(coordinate => {
      const point = map.project(coordinate);
      return horizontal ? {x:point.y, y:point.x} : point;
    });
    const occupied = speedSignObstacles(horizontal);
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
      const area = element.className.includes("corridor-speed-area");
      const faceWidth = element.offsetWidth || (area ? 146 : reference ? 40 : 54);
      const faceHeight = element.offsetHeight || (area ? 32 : reference ? 24 : 26);
      const width = horizontal ? faceHeight : faceWidth, height = horizontal ? faceWidth : faceHeight;
      const center = Math.max(width / 2 + 8, Math.min(viewportWidth - width / 2 - 8, point.x));
      const crossOffset = center - point.x;
      const roadSegments = [];
      const left = center - width / 2 - 7, right = center + width / 2 + 7;
      for (let index = 1; index < road.length; index++) {
        const start = road[index - 1], end = road[index];
        if (Math.max(start.x, end.x) < left || Math.min(start.x, end.x) > right) continue;
        let first = 0, last = 1;
        if (end.x !== start.x) {
          const a = (left - start.x) / (end.x - start.x), b = (right - start.x) / (end.x - start.x);
          first = Math.max(0, Math.min(a,b));
          last = Math.min(1, Math.max(a,b));
        }
        roadSegments.push([{x: start.x + first * (end.x - start.x), y:start.y + first * (end.y - start.y)},
          {x:start.x + last * (end.x - start.x), y:start.y + last * (end.y - start.y)}]);
      }
      const minimum = height / 2 + (area ? 24 : 2);
      const candidates = (area ? (point.y < viewportHeight / 2 ? [1, -1] : [-1, 1]) : [side]).flatMap(candidateSide => {
        const preferred = candidateSide * (height / 2 + (area ? 24 : 8));
        const edgeOffset = Math.max(height / 2 + 8,
          Math.min(viewportHeight - height / 2 - 8, point.y + preferred)) - point.y;
        return [preferred, edgeOffset, ...roadSegments.map(([start,end]) => candidateSide < 0
          ? Math.min(start.y,end.y) - 8 - height / 2 - point.y
          : Math.max(start.y,end.y) + 8 + height / 2 - point.y), ...occupied.filter(other =>
          center - width / 2 < other.right + 8 && center + width / 2 > other.left - 8)
          .map(other => candidateSide < 0 ? other.top - 8 - height / 2 - point.y
            : other.bottom + 8 + height / 2 - point.y)]
          .filter(offset => candidateSide * offset >= minimum);
      }).sort((a,b) => {
        const cramped = offset => (offset < 0 ? point.y + offset : viewportHeight - point.y - offset) < 140;
        return (area ? Number(cramped(a)) - Number(cramped(b)) : 0) || Math.abs(a) - Math.abs(b);
      });
      let chosen = null;
      for (const offset of candidates) {
        const bounds = {left:center - width / 2, right:center + width / 2,
          top:point.y + offset - height / 2, bottom:point.y + offset + height / 2};
        if (bounds.top < 8 || bounds.bottom > viewportHeight - 8) continue;
        if (occupied.some(other => bounds.left < other.right + 6 && bounds.right > other.left - 6
          && bounds.top < other.bottom + 6 && bounds.bottom > other.top - 6)) continue;
        const clearance = {left:bounds.left - 7, right:bounds.right + 7,
          top:bounds.top - 7, bottom:bounds.bottom + 7};
        if (roadSegments.some(([start,end]) => segmentCrossesBox(start,end,clearance))) continue;
        chosen = offset;
        break;
      }
      if (chosen === null) {
        element.style.visibility = connector.style.visibility = "hidden";
        continue;
      }
      if (area) {
        for (const node of [element, connector]) {
          node.className = node.className.replace(/is-above|is-below/g, chosen < 0 ? "is-above" : "is-below");
        }
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
    for (const entry of variableSpeedAreas) { entry.marker.remove?.(); entry.connectorMarker.remove?.(); }
    variableSpeedMarkers = [];
    variableSpeedAreas = [];
    variableSpeedAreaSignature = "";
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
      const reportsOpen = note.querySelector?.(".corridor-last-reported")?.open === true;
      note.replaceChildren();
      note.textContent = `CDOT sign reports · ${summary.locations.length} locations · ${summary.changed.length} confirmed differences from regular reference · ${summary.unavailable.length} unconfirmed (not mapped as current). Devices normally refresh every six hours.`;
      if (summary.lastReported.length) {
        const details = document.createElement("details");
        details.className = "corridor-last-reported";
        details.open = reportsOpen;
        appendPopupText(details, "summary", `Last-reported limits (${summary.lastReported.length} unconfirmed)`);
        const list = document.createElement("div");
        list.className = "corridor-last-reported-list";
        for (const group of window.VariableSpeedSigns.groups(summary.lastReported)) {
          const speeds = [...new Set(group.signs.map(sign => sign.reportedLimitMph))];
          const read = group.signs.reduce((oldest, sign) => !oldest || Date.parse(sign.fetchedAt) < Date.parse(oldest) ? sign.fetchedAt : oldest, null);
          appendPopupText(list, "span", `${group.direction === "EAST" ? "Eastbound" : "Westbound"} MM ${mapData.formatMarker(group.mileMarker)} · ${speeds.join(" / ")} mph · read ${formatObservationTime(read)} · unconfirmed`);
        }
        details.appendChild(list);
        note.appendChild(details);
      }
    }
    if (legend) legend.hidden = false;
    const locations = window.VariableSpeedSigns.groups(summary.available)
      .filter(group => group.changed && !group.uncertain)
      .map(group => ({...group, signs:group.signs.filter(sign => sign.differentFromRegular)}));
    for (const group of locations) {
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
      const markers = speedSignMarkers(element, [group.longitude, group.latitude], [0, side * 23]);
      variableSpeedMarkers.push({...markers, element, side, group, mileMarker:group.mileMarker, confirmed:true});
    }
    updateMapMarkerVisibility();
  }

  function showVariableSpeedPopup(group) {
    const content = document.createElement("div");
    content.className = "corridor-map-popup";
    appendPopupText(content, "strong", `I-70 ${group.direction === "EAST" ? "eastbound" : "westbound"} · MM ${group.mileMarker}`);
    appendVariableSpeedDetails(content, group);
    openPopup([group.longitude, group.latitude], content, "21rem");
    variableSpeedPopup = true;
  }

  function appendVariableSpeedDetails(content, group) {
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
      appendPopupText(content, "span", `Regular ${sign.referenceSource === "cdot-inventory" ? "sign" : "road"} reference: ${sign.regularLimitMph ?? "unavailable"}${sign.regularLimitMph == null ? "" : " mph"}`);
      if (sign.referenceSource === "cdot-inventory") appendPopupText(content, "small",
        `CDOT OTIS lists 65 mph westbound here. Configured combined-direction segment reference: ${sign.roadReferenceMph ?? "unavailable"} mph.`);
    }
    appendPopupText(content, "small", "Sign locations only. Regular references use configured road limits with CDOT directional sign-location defaults where available; CDOT does not supply a per-sign clear-weather maximum in this feed.");
  }

  function setSpeedBoundaryMarkers(routeFeature, corridor) {
    if (!renderer?.Marker || !map) return;
    const signature = `${corridor}:${zoneFeatureSignature}`;
    if (speedBoundaryCorridor === signature) return;
    clearSpeedBoundaryMarkers();
    const coordinates = mapData.lineCoordinates(routeFeature?.geometry);
    if (coordinates.length < 2) return;
    const route = mapData.measuredRoute(coordinates);
    const anchors = mapData.routeMarkerAnchors(routeFeature, route);
    if (anchors.length < 2) return;
    for (const boundary of speedBoundaries(routeFeature)) {
      const distance = mapData.markerDistance(boundary.marker, anchors);
      if (!Number.isFinite(distance)) continue;
      const element = document.createElement("span");
      element.className = "corridor-speed-boundary";
      element.style.setProperty("--boundary-rotation", corridor === "I25" ? "90deg" : "0deg");
      const markerLabel = mapData.formatMarker(boundary.marker);
      element.title = `Reference limit changes near MM ${markerLabel}: ${boundary.firstSpeed}–${boundary.secondSpeed} mph`;
      element.setAttribute(
        "aria-label",
        `${corridorLabel(corridor)} configured reference boundary near mile marker ${markerLabel}: ${boundary.firstSpeed} and ${boundary.secondSpeed} miles per hour`
      );
      const instance = new renderer.Marker({ element, anchor: "center" })
        .setLngLat(mapData.pointAtRouteDistance(route, distance))
        .addTo(map);
      speedBoundaryMarkers.push(instance);
    }
    const segments = (routeFeature.properties?.speedLimitSegments || [])
      .map(segment => ({startMileMarker:mapData.finiteNumber(segment.startMileMarker),
        endMileMarker:mapData.finiteNumber(segment.endMileMarker), speed:mapData.finiteNumber(segment.speedLimitMph)}))
      .filter(segment => Object.values(segment).every(Number.isFinite) && segment.speed > 0
        && segment.startMileMarker !== segment.endMileMarker)
      .map(segment => ({...segment, startMileMarker:Math.min(segment.startMileMarker, segment.endMileMarker),
        endMileMarker:Math.max(segment.startMileMarker, segment.endMileMarker)}))
      .sort((first, second) => first.startMileMarker - second.startMileMarker);
    const references = [];
    for (const segment of segments) {
      const previous = references.at(-1);
      if (corridor !== "I70" && previous && previous.speed === segment.speed && Math.abs(previous.endMileMarker - segment.startMileMarker) < 0.01) {
        previous.endMileMarker = segment.endMileMarker;
      } else references.push({...segment});
    }
    for (const segment of references) {
      if (segment.startMileMarker < anchors[0].marker || segment.endMileMarker > anchors.at(-1).marker) continue;
      const element = document.createElement("span");
      const horizontal = corridor === "I25";
      element.className = `corridor-speed-reference corridor-speed-sign ${horizontal ? "is-right" : "is-above"}`;
      speedSignContent(element, segment.speed, "ref");
      element.title = `${corridorLabel(corridor)} configured reference ${segment.speed} mph · MM ${mapData.formatMarker(segment.startMileMarker)}–${mapData.formatMarker(segment.endMileMarker)}; not a live sign reading`;
      element.setAttribute("aria-label", element.title);
      const distance = mapData.markerDistance((segment.startMileMarker + segment.endMileMarker) / 2, anchors);
      const markers = speedSignMarkers(element, mapData.pointAtRouteDistance(route, distance), horizontal ? [30, 0] : [0, -22]);
      speedReferenceMarkers.push({...markers, element, side:horizontal ? 1 : -1, horizontal, ...segment});
    }
    speedBoundaryCorridor = signature;
    updateMapMarkerVisibility();
  }

  function speedBoundaries(routeFeature) {
    const segments = (Array.isArray(routeFeature?.properties?.speedLimitSegments)
      ? routeFeature.properties.speedLimitSegments : [])
      .map(segment => {
        const start = mapData.finiteNumber(segment.startMileMarker);
        const end = mapData.finiteNumber(segment.endMileMarker);
        const speed = mapData.finiteNumber(segment.speedLimitMph);
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

  function showIncidentPopup(event) {
    const feature = event?.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!renderer?.Popup || !mapData.validPoint(coordinates)) return;
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
    appendPopupText(content, "strong", mapData.incidentType(properties));
    appendPopupText(content, "span", String(properties.locationLabel || properties.referenceLabel || "Location unavailable"));
    const inference = window.IncidentTypes.sunGlareInference(properties);
    if (inference) appendPopupText(content, "span", inference);
    const restriction = window.IncidentTypes.chainLaw(properties);
    if (restriction) appendPopupText(content, "span", restriction.detail);
    if (properties.incidentImpactLabel) {
      appendPopupText(content, "span", `Impact: ${properties.incidentImpactLabel}`);
    }
    if (properties.incidentNote && String(properties.incidentNote).toLowerCase() !== mapData.incidentType(properties).toLowerCase()) {
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
    if (!renderer?.Popup || !mapData.validPoint(coordinates)) return;
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

  function openPopup(coordinates, content, maxWidth, options = {}) {
    clearPopup();
    activePopup = new renderer.Popup({ closeButton: true, maxWidth, ...options })
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

  function incidentStatus(properties) {
    const status = String(properties.normalizedStatus || "").toLowerCase();
    const ended = properties.archived === true || properties.archived === "true"
      || ["cleared", "closed", "ended", "inactive", "resolved", "cancel"].some(value => status.includes(value));
    const planned = !ended && (status.includes("planned") || status.includes("scheduled"));
    const now = new Date();
    const nextStart = window.IncidentTypes.nextContinuationStart(properties, now);
    const futureStart = !ended && properties.sourceStartedAt && new Date(properties.sourceStartedAt) > now;
    const active = !ended && !futureStart && (properties.active === true || properties.active === "true");
    const state = ended ? "Cleared" : nextStart ? window.IncidentTypes.continuationLabel(nextStart, now)
      : planned || futureStart ? "Planned"
      : active ? window.IncidentTypes.longTermSpan(properties) ? "Active · Long-term" : "Active" : "Recently reported";
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
    return `MM ${mapData.formatMarker(start)}–${mapData.formatMarker(end)}`;
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
