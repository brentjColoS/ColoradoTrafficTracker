package com.example.ingest_service;

import static com.example.ingest_service.CorridorGeometrySupport.haversineMeters;
import static com.example.ingest_service.CorridorGeometrySupport.interpolate;
import static com.example.ingest_service.CorridorGeometrySupport.normalizeBbox;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class TileCoveragePlanner {
    private static final Logger log = LoggerFactory.getLogger(TileCoveragePlanner.class);
    private static final int MAX_TILE_ZOOM = 22;
    private static final double METERS_PER_MILE = 1609.344;
    private final int defaultZoom;

    TileCoveragePlanner(int defaultZoom) {
        this.defaultZoom = defaultZoom;
    }

    TileCoveragePlan resolve(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        Map<String, Integer> requestedZoomByCorridor,
        int target,
        int adaptiveCap,
        int pollSeconds
    ) {
        TileCoveragePlan plan = build(corridors, geometryByCorridor, requestedZoomByCorridor);

        int effectiveTarget = Math.min(target, adaptiveCap);
        while (!plan.uniqueTiles().isEmpty() && estimateCallsPerMonth(plan.uniqueTiles().size(), pollSeconds) > effectiveTarget) {
            TileCoveragePlan reduced = reduceCoveragePlan(corridors, geometryByCorridor, plan);
            if (reduced == null || reduced.zoomByCorridor().equals(plan.zoomByCorridor())) break;
            plan = reduced;
        }

        if (!requestedZoomByCorridor.equals(plan.zoomByCorridor())) {
            log.warn(
                "Adjusted tile zoom plan from {} to {} to fit tile request budgets (target={}, adaptiveCap={})",
                summarizeZoomPlan(requestedZoomByCorridor),
                summarizeZoomPlan(plan.zoomByCorridor()),
                target,
                adaptiveCap
            );
        } else {
            log.info("Tile zoom plan: {}", summarizeZoomPlan(plan.zoomByCorridor()));
        }
        return plan;
    }

    TileCoveragePlan build(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        Map<String, Integer> zoomByCorridor
    ) {
        Map<String, Set<TrafficTile>> tilesByCorridor = buildTileCoverage(corridors, geometryByCorridor, zoomByCorridor);
        return new TileCoveragePlan(Map.copyOf(zoomByCorridor), tilesByCorridor, uniqueTiles(tilesByCorridor));
    }

    private Map<String, Set<TrafficTile>> buildTileCoverage(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        Map<String, Integer> zoomByCorridor
    ) {
        Map<String, Set<TrafficTile>> out = new LinkedHashMap<>();
        for (TrafficProps.Corridor corridor : corridors) {
            try {
                int zoom = clamp(zoomByCorridor.getOrDefault(corridor.name(), defaultZoom), 0, MAX_TILE_ZOOM);
                CorridorGeometry geometry = geometryByCorridor.get(corridor.name());
                Set<TrafficTile> routeTiles = tileKeysForRoute(geometry == null ? List.of() : geometry.polyline(), zoom);
                if (routeTiles.isEmpty()) {
                    routeTiles = tileKeysForBbox(corridor.bbox(), zoom);
                }
                out.put(corridor.name(), routeTiles);
            } catch (Exception e) {
                log.warn("Skipping corridor {} due to tile setup error: {}", corridor.name(), e.toString());
            }
        }
        return out;
    }

    private TileCoveragePlan reduceCoveragePlan(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        TileCoveragePlan current
    ) {
        String corridorToReduce = current.zoomByCorridor().entrySet().stream()
            .filter(entry -> entry.getValue() != null && entry.getValue() > 0)
            .sorted((left, right) -> {
                int zoomCompare = Integer.compare(right.getValue(), left.getValue());
                if (zoomCompare != 0) return zoomCompare;
                int rightTiles = current.tilesByCorridor().getOrDefault(right.getKey(), Set.of()).size();
                int leftTiles = current.tilesByCorridor().getOrDefault(left.getKey(), Set.of()).size();
                int tileCompare = Integer.compare(rightTiles, leftTiles);
                if (tileCompare != 0) return tileCompare;
                return left.getKey().compareTo(right.getKey());
            })
            .map(Map.Entry::getKey)
            .findFirst()
            .orElse(null);
        if (corridorToReduce == null) return null;

        Map<String, Integer> reducedZooms = new LinkedHashMap<>(current.zoomByCorridor());
        reducedZooms.computeIfPresent(corridorToReduce, (key, value) -> Math.max(0, value - 1));
        return build(corridors, geometryByCorridor, reducedZooms);
    }

    Map<String, Integer> requestedZoomByCorridor(
        List<TrafficProps.Corridor> corridors,
        int defaultZoom,
        String rawOverrides
    ) {
        Map<String, Integer> overrides = parseZoomOverrides(rawOverrides);
        Map<String, Integer> out = new LinkedHashMap<>();
        for (TrafficProps.Corridor corridor : corridors) {
            int zoom = overrides.getOrDefault(normalizeCorridorName(corridor.name()), defaultZoom);
            out.put(corridor.name(), clamp(zoom, 0, MAX_TILE_ZOOM));
        }
        return out;
    }

    private Map<String, Integer> parseZoomOverrides(String raw) {
        if (raw == null || raw.isBlank()) return Map.of();
        Map<String, Integer> out = new LinkedHashMap<>();
        for (String token : raw.split(",")) {
            String entry = token == null ? "" : token.trim();
            if (entry.isBlank()) continue;
            String[] parts = entry.contains("=") ? entry.split("=", 2) : entry.split(":", 2);
            if (parts.length != 2) continue;
            String corridor = normalizeCorridorName(parts[0]);
            if (corridor.isBlank()) continue;
            try {
                out.put(corridor, clamp(Integer.parseInt(parts[1].trim()), 0, MAX_TILE_ZOOM));
            } catch (NumberFormatException ignored) {
                log.warn("Ignoring invalid tile zoom override: {}", entry);
            }
        }
        return out;
    }

    private static String normalizeCorridorName(String corridor) {
        return corridor == null ? "" : corridor.trim().toUpperCase(Locale.ROOT);
    }

    static String summarizeZoomPlan(Map<String, Integer> zoomByCorridor) {
        if (zoomByCorridor == null || zoomByCorridor.isEmpty()) return "none";
        return zoomByCorridor.entrySet().stream()
            .map(entry -> entry.getKey() + "=" + entry.getValue())
            .sorted()
            .reduce((left, right) -> left + ", " + right)
            .orElse("none");
    }

    private static Set<TrafficTile> uniqueTiles(Map<String, Set<TrafficTile>> tilesByCorridor) {
        Set<TrafficTile> unique = new LinkedHashSet<>();
        for (Set<TrafficTile> tiles : tilesByCorridor.values()) {
            unique.addAll(tiles);
        }
        return unique;
    }

    static double estimateCallsPerMonth(int uniqueTiles, int pollSeconds) {
        long callsPerPoll = uniqueTiles;
        double pollsPerMonth = (31.0 * 86_400.0) / Math.max(1, pollSeconds);
        return callsPerPoll * pollsPerMonth;
    }

    Set<TrafficTile> fineFlowTiles(TileCoveragePlan plan, Map<String, CorridorGeometry> geometries, TrafficPullProps.Precision precision) {
        if (precision != TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH) return Set.of();
        // Without both trusted route footprints, exclusivity cannot protect I25.
        for (String corridor : List.of("I25", "I70")) {
            CorridorGeometry geometry = geometries.get(corridor);
            if (geometry == null || geometry.polyline().size() < 2
                || !Integer.valueOf(10).equals(plan.zoomByCorridor().get(corridor))
                || plan.tilesByCorridor().getOrDefault(corridor, Set.of()).isEmpty()) return Set.of();
        }
        Set<TrafficTile> exclusive = new LinkedHashSet<>(plan.tilesByCorridor().get("I70"));
        plan.tilesByCorridor().forEach((corridor, tiles) -> {
            if (!"I70".equals(corridor)) exclusive.removeAll(tiles);
        });
        return Set.copyOf(exclusive);
    }

    static Set<TrafficTile> tileKeysForBbox(String bbox, int zoom) {
        double[] bb = normalizeBbox(bbox);
        double minLat = bb[0], minLon = bb[1], maxLat = bb[2], maxLon = bb[3];

        TrafficTile topLeft = latLonToTile(maxLat, minLon, zoom);
        TrafficTile bottomRight = latLonToTile(minLat, maxLon, zoom);

        int xMin = Math.min(topLeft.x(), bottomRight.x());
        int xMax = Math.max(topLeft.x(), bottomRight.x());
        int yMin = Math.min(topLeft.y(), bottomRight.y());
        int yMax = Math.max(topLeft.y(), bottomRight.y());

        Set<TrafficTile> tiles = new LinkedHashSet<>();
        for (int x = xMin; x <= xMax; x++) {
            for (int y = yMin; y <= yMax; y++) {
                tiles.add(new TrafficTile(zoom, x, y));
            }
        }
        return tiles;
    }

    private static Set<TrafficTile> tileKeysForRoute(List<double[]> route, int zoom) {
        if (route == null || route.size() < 2) return Set.of();

        List<double[]> coveragePoints = samplePolylineWithMaxSpacing(route, METERS_PER_MILE);
        if (coveragePoints.isEmpty()) return Set.of();

        Set<TrafficTile> tiles = new LinkedHashSet<>();
        for (double[] point : coveragePoints) {
            tiles.add(latLonToTile(point[0], point[1], zoom));
        }
        return tiles;
    }

    private static TrafficTile latLonToTile(double lat, double lon, int zoom) {
        double n = Math.pow(2.0, zoom);
        double rawX = ((lon + 180.0) / 360.0) * n;
        double latRad = Math.toRadians(lat);
        double rawY = (1.0 - Math.log(Math.tan(latRad) + (1.0 / Math.cos(latRad))) / Math.PI) / 2.0 * n;

        int max = (int) n - 1;
        int x = clamp((int) Math.floor(rawX), 0, max);
        int y = clamp((int) Math.floor(rawY), 0, max);
        return new TrafficTile(zoom, x, y);
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static List<double[]> samplePolylineWithMaxSpacing(List<double[]> polyline, double maxSpacingMeters) {
        if (polyline == null || polyline.isEmpty()) return List.of();
        if (polyline.size() == 1) return List.of(polyline.get(0));

        List<double[]> out = new ArrayList<>();
        out.add(polyline.get(0));

        for (int i = 0; i < polyline.size() - 1; i++) {
            double[] start = polyline.get(i);
            double[] end = polyline.get(i + 1);
            double segmentMeters = haversineMeters(start[0], start[1], end[0], end[1]);
            int steps = Math.max(1, (int) Math.ceil(segmentMeters / Math.max(1.0, maxSpacingMeters)));
            for (int step = 1; step <= steps; step++) {
                double t = step / (double) steps;
                out.add(interpolate(start, end, t));
            }
        }

        return out;
    }

}
