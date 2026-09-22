(() => {
  const panel = document.getElementById("corridorMapPanel");
  const container = document.getElementById("corridorMap");
  const title = document.getElementById("corridorMapTitle");
  const subtitle = document.getElementById("corridorMapSubtitle");
  const status = document.getElementById("corridorMapStatus");
  const emptyCollection = { type: "FeatureCollection", features: [] };
  const loadRenderer = window.CORRIDOR_MAP_RENDERER_LOADER
    || (() => import("/dashboard/vendor/maplibre-gl/6.10.0/maplibre-gl.mjs"));

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
    panel.hidden = false;
    title.textContent = `${corridorLabel(corridor)} Corridor Imagery`;
    subtitle.textContent = mapSubtitle(payload.corridorFeature);

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
      setStatus(`USGS imagery · OSM-derived route outline · ${incidentStatus} · No traffic condition shown.`);
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
    map.on("mouseenter", "corridor-incidents", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "corridor-incidents", () => { map.getCanvas().style.cursor = ""; });
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

  function mapSubtitle(feature) {
    const range = String(feature?.properties?.mileMarkerRange || "").trim();
    return range ? `${range} · selected route outline` : "Selected route outline";
  }

  function setStatus(message) {
    status.textContent = message;
    status.title = message;
  }

  window.CorridorMapPanel = { hide, render, setTheme };
})();
