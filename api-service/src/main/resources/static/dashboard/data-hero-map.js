(() => {
  const container = document.getElementById("dataHeroMap");
  const status = document.getElementById("dataHeroMapStatus");
  if (!container || !status) return;

  const usgsBasemap = {
    tileUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    overviewTileUrl: null,
    detailMinZoom: 0,
    maxZoom: 16,
    attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>'
  };
  const apiBase = String(window.location.pathname || "").startsWith("/dashboard-experimental/")
    ? "/dashboard-experimental-api" : "/dashboard-api";
  let map;
  let disposed = false;
  let resizeFrame;
  let cancelStyleWait;
  let cancelRendererWait;
  const observers = [];
  let overviewBounds;
  const pulsePaths = [];
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const paceLifetime = new AbortController();
  let mapVisible = typeof window.IntersectionObserver !== "function";
  let pageActive = true;
  let refreshing = false;
  let refreshTimer;
  let lastRefresh = 0;

  initialize().catch(() => {
    if (disposed) return;
    map?.remove?.();
    map = undefined;
    status.textContent = "Geometry could not be loaded. Refresh this page to retry.";
    container.classList.add("is-unavailable");
  });

  async function initialize() {
    const [module, corridorResponse, basemap] = await Promise.all([
      loadRenderer(),
      window.fetch(`${apiBase}/traffic/map/corridors`, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      loadBasemapConfig()
    ]);
    if (disposed) return;
    if (!corridorResponse.ok) throw new Error("Corridor geometry request failed");
    const corridorData = await corridorResponse.json();
    if (disposed) return;
    const features = usableCorridors(corridorData);
    if (features.length === 0) throw new Error("Corridor geometry is empty");

    overviewBounds = geometryBounds(features);
    if (!overviewBounds) throw new Error("No valid corridor coordinates");
    const renderer = module.default || module;
    map = new renderer.Map({
      container,
      attributionControl: false,
      interactive: false,
      refreshExpiredTiles: false,
      style: mapStyle({ type: "FeatureCollection", features }, basemap)
    });
    map.addControl(new renderer.AttributionControl({ compact: true }), "bottom-right");
    let basemapUnavailable = false;
    map.on("error", event => {
      if (event?.sourceId === "base-map" || event?.sourceId === "base-map-overview") {
        basemapUnavailable = true;
        status.textContent = "Basemap unavailable; tracked geometry remains visible.";
      }
    });
    await styleReady(map);
    if (disposed) return;
    collapseAttribution();
    map.getCanvas().setAttribute("aria-label", "Tracked I-25 and I-70 corridor geometry map");
    initializePulseOverlay(features);
    fitOverview();
    resizeFrame = window.requestAnimationFrame(fitOverview);
    if (!basemapUnavailable) status.textContent = `${features.length} corridors · ${mappedMiles(features)} mapped miles`;
    applyTheme();
    observeTheme();
    observeSize();
    observeVisibility();
    reducedMotion?.addEventListener?.("change", syncPulseMotion);
    document.addEventListener("visibilitychange", () => {
      syncPulseMotion();
      schedulePaceRefresh();
    });
    void refreshPaces();
  }

  function fitOverview() {
    resizeFrame = undefined;
    if (disposed || !map || !overviewBounds) return;
    map.resize();
    map.fitBounds(overviewBounds, {
      padding: container.clientWidth < 420 ? 20 : 30,
      maxZoom: 8.7,
      duration: 0
    });
    projectPulsePaths();
  }

  function collapseAttribution() {
    const attribution = container.querySelector?.(".maplibregl-ctrl-attrib");
    attribution?.classList?.add?.("data-hero-map-attribution-collapsed");
    attribution?.classList?.remove?.("maplibregl-compact-show");
    attribution?.removeAttribute?.("open");
    const button = attribution?.querySelector?.(".maplibregl-ctrl-attrib-button");
    button?.addEventListener?.("click", () => {
      attribution.classList.remove("data-hero-map-attribution-collapsed");
    }, { once: true });
  }

  async function loadRenderer() {
    let timeout;
    try {
      const loader = window.DATA_HERO_RENDERER_LOADER
        || (() => import("./vendor/maplibre-gl/6.10.0/maplibre-gl.mjs"));
      return await Promise.race([
        loader(),
        new Promise((resolve, reject) => {
          timeout = window.setTimeout(() => reject(new Error("Map renderer load timed out")), 8000);
          cancelRendererWait = () => reject(new Error("Map renderer load cancelled"));
        })
      ]);
    } finally {
      window.clearTimeout(timeout);
      cancelRendererWait = undefined;
    }
  }

  async function loadBasemapConfig() {
    try {
      const response = await window.fetch(`${apiBase}/map/config`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) return usgsBasemap;
      const config = await response.json();
      if (!validTileUrl(config?.tileUrl)) return usgsBasemap;
      const overviewTileUrl = validTileUrl(config?.overviewTileUrl) ? config.overviewTileUrl : null;
      return {
        tileUrl: config.tileUrl,
        overviewTileUrl,
        detailMinZoom: overviewTileUrl && Number.isInteger(config.detailMinZoom)
          ? config.detailMinZoom : 0,
        maxZoom: Number.isInteger(config.maxZoom) ? config.maxZoom : 19,
        attribution: String(config.attribution || "Map data")
      };
    } catch {
      return usgsBasemap;
    }
  }

  function validTileUrl(value) {
    if (typeof value !== "string" || !value.includes("{z}") || !value.includes("{x}") || !value.includes("{y}")) return false;
    try {
      return new URL(value.replace("{z}", "1").replace("{x}", "1").replace("{y}", "1")).protocol === "https:";
    } catch {
      return false;
    }
  }

  function usableCorridors(data) {
    return Array.isArray(data?.features) ? data.features.filter(feature => {
      const corridor = feature?.properties?.corridor || feature?.id;
      return (corridor === "I25" || corridor === "I70")
        && validGeometry(feature?.geometry);
    }) : [];
  }

  function validGeometry(geometry) {
    const validLine = line => Array.isArray(line) && line.length >= 2 && line.every(point =>
      Array.isArray(point) && point.length >= 2
      && Number.isFinite(point[0]) && Math.abs(point[0]) <= 180
      && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90);
    if (geometry?.type === "LineString") return validLine(geometry.coordinates);
    return geometry?.type === "MultiLineString" && Array.isArray(geometry.coordinates)
      && geometry.coordinates.length > 0 && geometry.coordinates.every(validLine);
  }

  function mapStyle(data, basemap) {
    const splitBasemap = Boolean(basemap.overviewTileUrl && basemap.detailMinZoom > 0);
    const rasterPaint = {
      "raster-opacity": 0.8,
      "raster-saturation": 0.18,
      "raster-contrast": 0.05,
      "raster-brightness-min": 0.08,
      "raster-brightness-max": 0.9
    };
    return {
      version: 8,
      sources: {
        ...(splitBasemap ? {
          "base-map-overview": {
            type: "raster",
            tiles: [basemap.overviewTileUrl],
            tileSize: 256,
            maxzoom: basemap.maxZoom,
            attribution: basemap.attribution
          }
        } : {}),
        "base-map": {
          type: "raster",
          tiles: [basemap.tileUrl],
          tileSize: 256,
          maxzoom: basemap.maxZoom,
          attribution: basemap.attribution
        },
        corridors: {
          type: "geojson",
          data,
          attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
        }
      },
      layers: [
        { id: "hero-map-background", type: "background", paint: { "background-color": "#10251a" } },
        ...(splitBasemap ? [{
          id: "hero-base-map-overview",
          type: "raster",
          source: "base-map-overview",
          maxzoom: basemap.detailMinZoom,
          paint: { ...rasterPaint }
        }] : []),
        {
          id: "hero-base-map",
          type: "raster",
          source: "base-map",
          ...(splitBasemap ? { minzoom: basemap.detailMinZoom } : {}),
          paint: { ...rasterPaint }
        },
        { id: "hero-corridor-casing", type: "line", source: "corridors", paint: {
          "line-color": "#f7f2df",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 5, 10, 9],
          "line-opacity": 0.82
        } },
        corridorLayer("hero-i25", "I25", "#4fbe7d", 3.2),
        corridorLayer("hero-i70", "I70", "#df7680", 3.2)
      ]
    };
  }

  function corridorLayer(id, corridor, color, width, opacity = 1) {
    return {
      id,
      type: "line",
      source: "corridors",
      filter: ["==", ["coalesce", ["get", "corridor"], ["id"]], corridor],
      paint: {
        "line-color": color,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, width, 10, width * 1.55],
        "line-opacity": opacity,
        "line-blur": opacity < 1 ? 2.4 : 0
      }
    };
  }

  function styleReady(activeMap) {
    if (activeMap.isStyleLoaded()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = callback => {
        window.clearTimeout(timeout);
        cancelStyleWait = undefined;
        callback();
      };
      const timeout = window.setTimeout(() => finish(() => reject(new Error("Map style load timed out"))), 15_000);
      cancelStyleWait = () => finish(() => reject(new Error("Map initialization cancelled")));
      activeMap.once("style.load", () => finish(resolve));
    });
  }

  function geometryBounds(features) {
    const coordinates = [];
    features.forEach(feature => collectCoordinates(feature.geometry?.coordinates, coordinates));
    if (coordinates.length === 0) return null;
    return coordinates.reduce((bounds, coordinate) => {
      bounds[0][0] = Math.min(bounds[0][0], coordinate[0]);
      bounds[0][1] = Math.min(bounds[0][1], coordinate[1]);
      bounds[1][0] = Math.max(bounds[1][0], coordinate[0]);
      bounds[1][1] = Math.max(bounds[1][1], coordinate[1]);
      return bounds;
    }, [[Infinity, Infinity], [-Infinity, -Infinity]]);
  }

  function collectCoordinates(value, result) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      result.push(value);
      return;
    }
    value.forEach(item => collectCoordinates(item, result));
  }

  function mappedMiles(features) {
    return Math.round(features.reduce((sum, feature) => {
      const start = Number(feature?.properties?.startMileMarker);
      const end = Number(feature?.properties?.endMileMarker);
      return sum + (Number.isFinite(start) && Number.isFinite(end) ? Math.abs(end - start) : 0);
    }, 0));
  }

  function initializePulseOverlay(features) {
    const seen = new Set();
    features.forEach(feature => {
      const corridor = feature.properties?.corridor || feature.id;
      if (seen.has(corridor)) return;
      seen.add(corridor);
      const overlay = document.createElement("div");
      overlay.classList.add("data-hero-map-pulse", corridor === "I25" ? "is-i25" : "is-i70", "is-unavailable");
      overlay.setAttribute("aria-hidden", "true");
      pulsePaths.push({
        corridor, overlay,
        lines: feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates,
        seconds: NaN, animation: null, shape: "",
        distanceMiles: Math.abs(Number(feature.properties?.endMileMarker) - Number(feature.properties?.startMileMarker))
      });
      container.appendChild(overlay);
    });
    map.on("moveend", projectPulsePaths);
  }

  function projectPulsePaths() {
    if (disposed || !map || !container.clientWidth || !container.clientHeight) return;
    pulsePaths.forEach(pulse => {
      if (typeof pulse.overlay.animate !== "function") return;
      const points = [];
      let length = 0;
      for (const line of pulse.lines) {
        let previous;
        for (const coordinate of line) {
          const point = map.project(coordinate);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
          const step = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0;
          if (previous && step === 0) continue;
          length += step;
          if (!previous && points.length) {
            const end = points.at(-1);
            points.push({ ...end, opacity: 0 });
            points.push({ x: point.x, y: point.y, distance: length, opacity: 0 });
          }
          points.push({ x: point.x, y: point.y, distance: length, opacity: 1 });
          previous = point;
        }
      }
      if (!(length > 0)) return;
      const shape = JSON.stringify(points);
      if (shape === pulse.shape) return;
      pulse.shape = shape;
      const frame = point => ({
        transform: `translate3d(${point.x - 5}px, ${point.y - 5}px, 0)`, opacity: point.opacity
      });
      const forward = points.map(point => ({ ...frame(point), offset: point.distance / length / 2 }));
      const backward = [...points].reverse().map(point => ({ ...frame(point), offset: 1 - point.distance / length / 2 }));
      const phase = Number(pulse.animation?.currentTime) || 0;
      pulse.animation?.cancel();
      // Fixed geometry is projected on layout changes; only two small overlays move.
      pulse.animation = pulse.overlay.animate([...forward, ...backward], {
        duration: 2000, iterations: Infinity, easing: "linear"
      });
      pulse.animation.pause();
      pulse.animation.currentTime = phase % 2000;
      if (Number.isFinite(pulse.seconds)) pulse.animation.updatePlaybackRate(1 / pulse.seconds);
    });
    syncPulseMotion();
  }

  async function readPaceJson(path) {
    const response = await window.fetch(`${apiBase}${path}`, {
      cache: "no-store", signal: AbortSignal.any([AbortSignal.timeout(8000), paceLifetime.signal])
    });
    if (!response.ok) throw new Error("Travel estimate request failed");
    return response.json();
  }

  function validObservation(value) {
    const observed = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(observed) && observed > 0 && observed <= Date.now() + 5 * 60_000;
  }

  function updatePace(pulse, summary, cells) {
    const calculator = window.TrafficEstimates?.estimateCorridorTravelMinutes;
    const matching = value => !value?.corridor || value.corridor === pulse.corridor;
    const latest = matching(summary) && validObservation(summary?.latest?.polledAt) ? summary.latest : null;
    const snapshot = matching(cells) && validObservation(cells?.observedAt) ? cells : null;
    const rawSpeed = latest?.avgCurrentSpeed;
    const speed = typeof rawSpeed === "number" && Number.isFinite(rawSpeed) ? rawSpeed : NaN;
    const cellMinutes = calculator?.(snapshot, pulse.distanceMiles, NaN);
    const minutes = calculator?.(snapshot, pulse.distanceMiles, speed);
    const rounded = Math.round(minutes);
    pulse.seconds = Number.isFinite(rounded) && rounded > 0 ? rounded : NaN;
    const observedAt = Number.isFinite(cellMinutes) ? snapshot.observedAt : latest?.polledAt;
    const stale = !validObservation(observedAt) || Date.now() - Date.parse(observedAt) > 60 * 60_000;
    const label = document.getElementById(pulse.corridor === "I25" ? "i25MapPace" : "i70MapPace");
    if (label) {
      label.textContent = Number.isFinite(pulse.seconds) ? `${pulse.seconds} min${stale ? " · retained" : ""}` : "pace unavailable";
      label.title = Number.isFinite(pulse.seconds)
        ? `${pulse.seconds} seconds one way; ${stale ? "latest retained" : "current"} estimate observed ${observedAt}. Illustrative pace, not a vehicle position or direction-specific measurement.`
        : "No usable travel-time estimate. Corridor geometry remains visible.";
    }
    pulse.overlay.dataset.travelSeconds = Number.isFinite(pulse.seconds) ? String(pulse.seconds) : "";
    if (Number.isFinite(pulse.seconds)) pulse.animation?.updatePlaybackRate(1 / pulse.seconds);
  }

  async function refreshPaces() {
    if (disposed || refreshing || document.hidden || !pageActive || !mapVisible) return;
    refreshing = true;
    lastRefresh = Date.now();
    try {
      await Promise.all(pulsePaths.map(async pulse => {
        const [summary, cells] = await Promise.allSettled([
          readPaceJson(`/traffic/summary?corridor=${pulse.corridor}&windowHours=3&recentIncidentWindowMinutes=1440&preferUsable=true`),
          readPaceJson(`/traffic/map/flow-cells/current?corridor=${pulse.corridor}`)
        ]);
        if (disposed) return;
        updatePace(pulse, summary.status === "fulfilled" ? summary.value : null,
          cells.status === "fulfilled" ? cells.value : null);
      }));
    } catch {
      if (!disposed) pulsePaths.forEach(pulse => updatePace(pulse, null, null));
    } finally {
      refreshing = false;
      syncPulseMotion();
      schedulePaceRefresh();
    }
  }

  function syncPulseMotion() {
    const paused = disposed || !pageActive || document.hidden || !mapVisible || reducedMotion?.matches;
    pulsePaths.forEach(pulse => {
      const available = Number.isFinite(pulse.seconds) && Boolean(pulse.animation);
      pulse.overlay.classList.toggle("is-unavailable", !available);
      if (paused || !available) pulse.animation?.pause();
      else pulse.animation?.play();
    });
  }

  function schedulePaceRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (disposed || !pageActive || refreshing || document.hidden || !mapVisible || !pulsePaths.length) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      void refreshPaces();
    }, Math.max(0, 60_000 - (Date.now() - lastRefresh)));
  }

  function observeVisibility() {
    if (typeof window.IntersectionObserver !== "function") return;
    const observer = new window.IntersectionObserver(entries => {
      mapVisible = entries.some(entry => entry.isIntersecting);
      syncPulseMotion();
      schedulePaceRefresh();
      if (mapVisible && !resizeFrame && !disposed) resizeFrame = window.requestAnimationFrame(fitOverview);
    }, { rootMargin: "120px" });
    observers.push(observer);
    observer.observe(container);
  }

  function observeSize() {
    if (typeof window.ResizeObserver !== "function") return;
    const observer = new window.ResizeObserver(() => {
      if (!resizeFrame && !disposed) resizeFrame = window.requestAnimationFrame(fitOverview);
    });
    observers.push(observer);
    observer.observe(container);
  }

  function observeTheme() {
    if (typeof window.MutationObserver !== "function") return;
    const observer = new window.MutationObserver(applyTheme);
    observers.push(observer);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
  }

  function applyTheme() {
    if (!map?.isStyleLoaded()) return;
    const dark = document.documentElement.dataset.theme === "dark";
    map.setPaintProperty("hero-map-background", "background-color", dark ? "#07160f" : "#dfe5dc");
    ["hero-base-map-overview", "hero-base-map"].forEach(layer => {
      if (!map.getLayer(layer)) return;
      map.setPaintProperty(layer, "raster-opacity", dark ? 0.78 : 0.84);
      map.setPaintProperty(layer, "raster-saturation", dark ? 0.28 : 0.14);
      map.setPaintProperty(layer, "raster-brightness-max", dark ? 0.9 : 1);
    });
    map.setPaintProperty("hero-corridor-casing", "line-color", dark ? "#f7f2df" : "#10251a");
  }

  window.addEventListener("pagehide", event => {
    pageActive = false;
    syncPulseMotion();
    window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (event.persisted) return;
    disposed = true;
    paceLifetime.abort();
    pulsePaths.forEach(pulse => pulse.animation?.cancel());
    reducedMotion?.removeEventListener?.("change", syncPulseMotion);
    cancelRendererWait?.();
    cancelStyleWait?.();
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    observers.forEach(observer => observer.disconnect());
    map?.remove?.();
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted || disposed) return;
    pageActive = true;
    syncPulseMotion();
    schedulePaceRefresh();
    if (!resizeFrame) resizeFrame = window.requestAnimationFrame(fitOverview);
  });
})();
