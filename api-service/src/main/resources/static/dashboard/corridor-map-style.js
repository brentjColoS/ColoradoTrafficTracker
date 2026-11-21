(() => {
  function create({ emptyCollection, usgsBasemap }) {
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

    return { mapStyle };
  }

  window.CorridorMapStyle = { create };
})();
