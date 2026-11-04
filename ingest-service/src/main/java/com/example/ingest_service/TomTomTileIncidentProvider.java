package com.example.ingest_service;

import static com.example.ingest_service.TrafficTileFeatures.*;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class TomTomTileIncidentProvider implements TrafficIncidentProvider {
    private static final Logger log = LoggerFactory.getLogger(TomTomTileIncidentProvider.class);
    private static final String TOMTOM_PROVIDER = "tomtom";
    private static final String VECTOR_TILE_PRODUCT = TomTomRequestGovernor.VECTOR_TILE_PRODUCT;
    private static final double DEFAULT_ROUTE_BUFFER_METERS = 500.0;
    private final TrafficProps props;
    private final TrafficPullProps pullProps;
    private final TomTomTileAccess access;

    public TomTomTileIncidentProvider(TrafficProps props, TrafficPullProps pullProps, TomTomTileAccess access) {
        this.props = props;
        this.pullProps = pullProps;
        this.access = access;
    }

    @Override
    public String providerName() {
        return TOMTOM_PROVIDER;
    }

    private static record IncidentCollection(String json, int count) {}

    @Override
    public Map<String, CorridorIncidentSnapshot> poll(List<TrafficProps.Corridor> corridors) {
        if (corridors == null || corridors.isEmpty()) return Map.of();

        if (!access.hasAccount()) {
            log.warn("No enabled TomTom account is available; skipping TomTom incident poll");
            return Map.of();
        }

        TrafficPullProps.Incidents incidents = pullProps.incidents();
        int requestedZoom = incidents.tileZoom();
        Map<String, Integer> zoomByCorridor = access.coveragePlanner.requestedZoomByCorridor(corridors, requestedZoom, "");
        int concurrency = Math.max(1, props.tileConcurrency());
        double routeBufferMeters = props.tileRouteBufferMeters() > 0
            ? props.tileRouteBufferMeters()
            : DEFAULT_ROUTE_BUFFER_METERS;

        Map<String, CorridorGeometry> geometryByCorridor = access.loadGeometry(corridors);
        TileCoveragePlan plan = access.coveragePlanner.build(corridors, geometryByCorridor, zoomByCorridor);
        if (plan.uniqueTiles().isEmpty()) {
            log.warn("No tile coverage generated; skipping TomTom incident poll");
            return Map.of();
        }

        TileQuotaUsage.Config quota = access.quotaUsage.config();
        long plannedCalls = plan.uniqueTiles().size();
        TileQuotaUsage.Decision quotaDecision = access.quotaUsage.reserve(plannedCalls, quota.hardStopPerAccount());
        if (!quotaDecision.allowed() || quotaDecision.callsReserved() < plannedCalls) {
            if (quotaDecision.allowed()) {
                access.quotaUsage.release(quotaDecision.reservation(), quotaDecision.callsReserved());
            }
            access.quotaUsage.recordBlocked();
            log.warn(
                "TomTom incident polling paused: remaining monthly quota cannot cover the incident pass (used={}, hardStop={})",
                quotaDecision.requestsUsed(),
                quota.hardStop()
            );
            return Map.of();
        }

        AtomicLong issuedInitialCalls = new AtomicLong();
        Map<TrafficTile, List<DecodedTrafficFeature>> incidentTiles;
        try {
            incidentTiles = access.tileClient.fetchIncidentTiles(
                plan.uniqueTiles(),
                quotaDecision.account(),
                concurrency,
                issuedInitialCalls
            )
                .blockOptional()
                .orElse(null);
        } finally {
            access.quotaUsage.release(
                quotaDecision.reservation(),
                Math.max(0, plannedCalls - issuedInitialCalls.get())
            );
        }
        if (incidentTiles == null) return Map.of();

        java.time.Instant fetchedAt = java.time.Instant.now();
        Map<String, CorridorIncidentSnapshot> next = new LinkedHashMap<>();
        CorridorGeometry emptyGeometry = new CorridorGeometry(List.of());
        for (TrafficProps.Corridor corridor : corridors) {
            Set<TrafficTile> corridorTiles = plan.tilesByCorridor().getOrDefault(corridor.name(), Set.of());
            CorridorGeometry geometry = geometryByCorridor.getOrDefault(corridor.name(), emptyGeometry);
            IncidentCollection collected = collectCorridorIncidents(
                corridor,
                corridorTiles,
                incidentTiles,
                geometry.polyline(),
                routeBufferMeters
            );
            next.put(
                corridor.name(),
                new CorridorIncidentSnapshot(
                    corridor.name(),
                    TOMTOM_PROVIDER,
                    VECTOR_TILE_PRODUCT,
                    fetchedAt,
                    null,
                    collected.json(),
                    collected.count()
                )
            );
        }
        return Map.copyOf(next);
    }

    private IncidentCollection collectCorridorIncidents(
        TrafficProps.Corridor corridor,
        Set<TrafficTile> corridorTiles,
        Map<TrafficTile, List<DecodedTrafficFeature>> incidentTiles,
        List<double[]> route,
        double routeBufferMeters
    ) {
        ArrayNode incidents = JsonNodeFactory.instance.arrayNode();
        Set<String> seen = new HashSet<>();

        for (TrafficTile key : corridorTiles) {
            for (DecodedTrafficFeature feature : incidentTiles.getOrDefault(key, List.of())) {
                String roadType = getStringTag(feature.tags(), "road_type", "road_category");
                if (roadType != null && !roadType.isBlank() && !isCorridorRoadType(roadType)) continue;
                if (!featureWithinBuffer(feature, route, routeBufferMeters)) continue;

                String dedupeKey = incidentFeatureKey(feature);
                if (!seen.add(dedupeKey)) continue;

                ObjectNode mapped = mapIncident(feature, corridor.name(), dedupeKey);
                if (mapped != null) {
                    incidents.add(IncidentLocationEnricher.enrichIncident(mapped, corridor, route));
                }
            }
        }

        ObjectNode wrapped = JsonNodeFactory.instance.objectNode();
        wrapped.set("incidents", incidents);
        return new IncidentCollection(wrapped.toString(), incidents.size());
    }

    private static String incidentFeatureKey(DecodedTrafficFeature feature) {
        Object id = feature.tags().get("id");
        if (id != null) return String.valueOf(id);

        List<double[]> path = firstPath(feature.paths());
        if (path.isEmpty()) return "";

        double[] first = path.get(0);
        String icon = getStringTag(feature.tags(), "icon_category", "icon_category_0");
        Double delay = getDoubleTag(feature.tags(), "delay");
        return String.format(Locale.US, "%s|%s|%.5f,%.5f", icon, delay, first[0], first[1]);
    }

    private static ObjectNode mapIncident(
        DecodedTrafficFeature feature,
        String corridorName,
        String providerEventId
    ) {
        List<double[]> path = firstPath(feature.paths());
        if (path.isEmpty()) return null;

        ObjectNode incident = JsonNodeFactory.instance.objectNode();
        ObjectNode propsNode = JsonNodeFactory.instance.objectNode();
        ObjectNode geomNode = JsonNodeFactory.instance.objectNode();

        ArrayNode roads = JsonNodeFactory.instance.arrayNode();
        roads.add(corridorName);
        propsNode.set("roadNumbers", roads);
        propsNode.put("providerEventId", providerEventId);
        propsNode.put("sourceStatus", "active");
        propsNode.put("normalizedStatus", "active");

        Double icon = getDoubleTag(feature.tags(), "icon_category", "icon_category_0");
        if (icon != null) {
            propsNode.put("iconCategory", icon.intValue());
            propsNode.put("sourceCategory", String.valueOf(icon.intValue()));
        }

        String description = incidentDescription(feature.tags());
        if (description != null) propsNode.put("description", description);

        Double delay = getDoubleTag(feature.tags(), "delay");
        if (delay != null) propsNode.put("delay", delay);

        String roadType = getStringTag(feature.tags(), "road_type", "road_category");
        if (roadType != null && !roadType.isBlank()) propsNode.put("roadType", roadType);

        if (path.size() == 1) {
            double[] p = path.get(0);
            geomNode.put("type", "Point");
            ArrayNode coordinates = JsonNodeFactory.instance.arrayNode();
            coordinates.add(p[1]);
            coordinates.add(p[0]);
            geomNode.set("coordinates", coordinates);
        } else {
            geomNode.put("type", "LineString");
            ArrayNode coordinates = JsonNodeFactory.instance.arrayNode();
            for (double[] p : path) {
                ArrayNode point = JsonNodeFactory.instance.arrayNode();
                point.add(p[1]);
                point.add(p[0]);
                coordinates.add(point);
            }
            geomNode.set("coordinates", coordinates);
        }

        incident.set("properties", propsNode);
        incident.set("geometry", geomNode);
        return incident;
    }

    private static String incidentDescription(Map<String, Object> tags) {
        String direct = getStringTag(tags, "description", "description_0");
        if (direct != null && !direct.isBlank()) return normalizeDescription(direct);

        List<String> descriptions = new ArrayList<>();
        for (int i = 0; i <= 2; i++) {
            String description = getStringTag(tags, "description_" + i);
            if (description != null && !description.isBlank()) {
                String normalized = normalizeDescription(description);
                if (!descriptions.contains(normalized)) descriptions.add(normalized);
            }
        }
        if (descriptions.isEmpty()) return null;
        return String.join(" + ", descriptions);
    }

    private static String normalizeDescription(String description) {
        return description == null ? null : description.trim().replace('_', ' ');
    }
}
