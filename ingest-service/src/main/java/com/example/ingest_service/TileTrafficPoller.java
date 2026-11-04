package com.example.ingest_service;

import static com.example.ingest_service.TrafficTileFeatures.*;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class TileTrafficPoller {

    private static final Logger log = LoggerFactory.getLogger(TileTrafficPoller.class);

    private static final String TOMTOM_PROVIDER = "tomtom";
    private static final String VECTOR_TILE_PRODUCT = TomTomRequestGovernor.VECTOR_TILE_PRODUCT;

    private static final double DEFAULT_ROUTE_BUFFER_METERS = 500.0;

    private final IncidentSnapshotStore incidentSnapshotStore;
    private final TileFlowSamplePublisher samplePublisher;
    private final TrafficProps props;
    private final TileQuotaUsage quotaUsage;
    private final TomTomTileClient tileClient;
    private final TileCoveragePlanner coveragePlanner;
    private final TrafficPullProps pullProps;
    private final CorridorGeometryResolver geometryResolver;
    private final TrafficProviderGuardService providerGuardService;
    private final TomTomAccountQuotaManager quotaManager;

    private static record IncidentCollection(String json, int count) {}

    public TileTrafficPoller(
        @Qualifier("tomtomWebClient") WebClient http,
        TrafficProps props,
        TrafficPullProps pullProps,
        TrafficSampleWriter sampleWriter,
        CorridorGeometryStore corridorGeometryStore,
        TrafficProviderGuardService providerGuardService,
        TomTomAccountQuotaManager quotaManager,
        TomTomRequestGovernor requestGovernor,
        IncidentSnapshotStore incidentSnapshotStore,
        FlowSpatialEvidenceStore flowSpatialEvidenceStore,
        CorridorFlowCellStore corridorFlowCellStore,
        MeterRegistry meterRegistry
    ) {
        this.samplePublisher = new TileFlowSamplePublisher(pullProps, sampleWriter, incidentSnapshotStore,
            flowSpatialEvidenceStore, corridorFlowCellStore);
        this.incidentSnapshotStore = incidentSnapshotStore;
        this.props = props;
        this.coveragePlanner = new TileCoveragePlanner(props.tileZoom());
        this.pullProps = pullProps;
        this.geometryResolver = new CorridorGeometryResolver(http, corridorGeometryStore, providerGuardService, requestGovernor);
        this.providerGuardService = providerGuardService;
        this.quotaManager = quotaManager;
        this.quotaUsage = new TileQuotaUsage(pullProps, quotaManager, meterRegistry);
        this.tileClient = new TomTomTileClient(http, providerGuardService, quotaManager, quotaUsage);
    }

    /**
     * Compatibility entry point for callers that still expect a coupled tile pull.
     * Scheduled ingestion uses the independent flow and incident methods below.
     */
    public Map<String, ProviderCycleSnapshot> pollAndPersist(List<TrafficProps.Corridor> corridors) {
        Map<String, CorridorIncidentSnapshot> incidents = pollIncidents(corridors);
        if (!incidents.isEmpty()) {
            incidentSnapshotStore.replace(incidents);
        }
        return pollFlowAndPersist(corridors);
    }

    public Map<String, ProviderCycleSnapshot> pollFlowAndPersist(List<TrafficProps.Corridor> corridors) {
        if (corridors == null || corridors.isEmpty()) return Map.of();

        TomTomAccount geometryAccount = quotaManager.firstAccount().orElse(null);
        if (geometryAccount == null) {
            log.warn("No enabled TomTom account is available; skipping tile-mode flow poll");
            return Map.of();
        }

        TrafficPullProps.Flow flow = pullProps.flow();
        int requestedZoom = flow.tileZoom();
        Map<String, Integer> requestedZoomByCorridor = coveragePlanner.requestedZoomByCorridor(
            corridors,
            requestedZoom,
            flow.tileCorridorZoomOverrides()
        );
        int concurrency = Math.max(1, props.tileConcurrency());
        TileQuotaUsage.Config quota = quotaUsage.config();

        Map<String, CorridorGeometry> geometryByCorridor = loadCorridorGeometry(corridors);
        TileCoveragePlan coveragePlan = coveragePlanner.resolve(
            corridors,
            geometryByCorridor,
            requestedZoomByCorridor,
            quota.target(),
            quota.adaptiveCap(),
            flow.pollSeconds()
        );
        if (coveragePlan.uniqueTiles().isEmpty()) {
            log.warn("No tile coverage generated; skipping tile-mode poll");
            return Map.of();
        }

        long plannedCalls = coveragePlan.uniqueTiles().size();
        TileQuotaUsage.Decision quotaDecision = quotaUsage.reserve(plannedCalls, quota.hardStopPerAccount());
        if (!quotaDecision.allowed()) {
            quotaUsage.recordBlocked();
            providerGuardService.recordRecoverableProviderFailure(
                ProviderFailureCategory.QUOTA_HARD_STOP,
                "traffic/tile/quota",
                "Monthly TomTom vector-tile hard stop reached before this flow cycle."
            );
            log.warn(
                "Flow tile polling paused: all account hard stops reached (used={}, combinedHardStop={})",
                quotaDecision.requestsUsed(),
                quota.hardStop()
            );
            return Map.of();
        }

        TileCoveragePlan reservedPlan = coveragePlan;
        long reservedCalls = quotaDecision.callsReserved();

        logTileBudget(
            reservedPlan.zoomByCorridor(),
            reservedPlan.uniqueTiles().size(),
            quota.target(),
            quota.adaptiveCap(),
            quota.hardStop(),
            flow.pollSeconds()
        );

        AtomicLong issuedInitialCalls = new AtomicLong();
        Set<TrafficTile> fineTiles = coveragePlanner.fineFlowTiles(reservedPlan, geometryByCorridor, flow.precision());
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles;
        try {
            flowTiles = tileClient.fetchFlowTiles(
                reservedPlan.uniqueTiles(),
                quotaDecision.account(),
                concurrency,
                issuedInitialCalls,
                fineTiles
            )
                .blockOptional()
                .orElse(null);
        } finally {
            quotaUsage.release(
                quotaDecision.reservation(),
                Math.max(0, reservedCalls - issuedInitialCalls.get())
            );
        }
        if (flowTiles == null) return Map.of();

        return samplePublisher.publish(
            corridors,
            geometryByCorridor,
            reservedPlan,
            flowTiles,
            Instant.now(),
            fineTiles
        );
    }

    public Map<String, CorridorIncidentSnapshot> pollIncidents(List<TrafficProps.Corridor> corridors) {
        if (corridors == null || corridors.isEmpty()) return Map.of();

        TomTomAccount geometryAccount = quotaManager.firstAccount().orElse(null);
        if (geometryAccount == null) {
            log.warn("No enabled TomTom account is available; skipping TomTom incident poll");
            return Map.of();
        }

        TrafficPullProps.Incidents incidents = pullProps.incidents();
        int requestedZoom = incidents.tileZoom();
        Map<String, Integer> zoomByCorridor = coveragePlanner.requestedZoomByCorridor(corridors, requestedZoom, "");
        int concurrency = Math.max(1, props.tileConcurrency());
        double routeBufferMeters = props.tileRouteBufferMeters() > 0
            ? props.tileRouteBufferMeters()
            : DEFAULT_ROUTE_BUFFER_METERS;

        Map<String, CorridorGeometry> geometryByCorridor = loadCorridorGeometry(corridors);
        TileCoveragePlan plan = coveragePlanner.build(corridors, geometryByCorridor, zoomByCorridor);
        if (plan.uniqueTiles().isEmpty()) {
            log.warn("No tile coverage generated; skipping TomTom incident poll");
            return Map.of();
        }

        TileQuotaUsage.Config quota = quotaUsage.config();
        long plannedCalls = plan.uniqueTiles().size();
        TileQuotaUsage.Decision quotaDecision = quotaUsage.reserve(plannedCalls, quota.hardStopPerAccount());
        if (!quotaDecision.allowed() || quotaDecision.callsReserved() < plannedCalls) {
            if (quotaDecision.allowed()) {
                quotaUsage.release(quotaDecision.reservation(), quotaDecision.callsReserved());
            }
            quotaUsage.recordBlocked();
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
            incidentTiles = tileClient.fetchIncidentTiles(
                plan.uniqueTiles(),
                quotaDecision.account(),
                concurrency,
                issuedInitialCalls
            )
                .blockOptional()
                .orElse(null);
        } finally {
            quotaUsage.release(
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

    private Map<String, CorridorGeometry> loadCorridorGeometry(List<TrafficProps.Corridor> corridors) {
        Map<String, CorridorGeometry> byCorridor = new LinkedHashMap<>();
        CorridorGeometry emptyGeometry = new CorridorGeometry(List.of());

        for (TrafficProps.Corridor corridor : corridors) {
            try {
                CorridorGeometry geometry = geometryResolver.resolve(corridor).blockOptional().orElse(emptyGeometry);
                byCorridor.put(corridor.name(), geometry);
            } catch (Exception e) {
                log.warn("Skipping corridor {} due to geometry setup error: {}", corridor.name(), e.toString());
            }
        }
        return byCorridor;
    }

    public TileQuotaSnapshot quotaSnapshot() {
        return quotaUsage.snapshot();
    }

    private void logTileBudget(
        Map<String, Integer> zoomByCorridor,
        int uniqueTiles,
        int targetMonthlyRequests,
        int adaptiveCapMonthlyRequests,
        int hardStopMonthlyRequests,
        int pollSeconds
    ) {
        long callsPerPoll = uniqueTiles;
        double estimatedCallsPerMonth = TileCoveragePlanner.estimateCallsPerMonth(uniqueTiles, pollSeconds);
        long used = quotaUsage.used();

        if (estimatedCallsPerMonth > adaptiveCapMonthlyRequests) {
            log.warn(
                "Flow tile request estimate exceeds monthly target: zoom={} uniqueTiles={} callsPerPoll={} estCallsPerMonth={} target={} usedThisMonth={} hardStop={}",
                TileCoveragePlanner.summarizeZoomPlan(zoomByCorridor),
                uniqueTiles,
                callsPerPoll,
                String.format(Locale.US, "%.0f", estimatedCallsPerMonth),
                targetMonthlyRequests,
                used,
                hardStopMonthlyRequests
            );
        } else {
            log.info(
                "Flow tile budget check: zoom={} uniqueTiles={} callsPerPoll={} estCallsPerMonth={} target={} usedThisMonth={} hardStop={}",
                TileCoveragePlanner.summarizeZoomPlan(zoomByCorridor),
                uniqueTiles,
                callsPerPoll,
                String.format(Locale.US, "%.0f", estimatedCallsPerMonth),
                targetMonthlyRequests,
                used,
                hardStopMonthlyRequests
            );
        }
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
