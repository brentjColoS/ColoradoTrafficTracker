package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.wdtinc.mapbox_vector_tile.VectorTile;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.function.Tuple2;
import reactor.util.retry.Retry;

import java.io.IOException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class TileTrafficPoller {

    private static final Logger log = LoggerFactory.getLogger(TileTrafficPoller.class);

    private static final String DEFAULT_QUOTA_ZONE = "America/Denver";
    private static final int MAX_TILE_ZOOM = 22;
    private static final int ENDPOINTS_PER_TILE = 2; // flow + incidents

    private static final double KPH_TO_MPH = 0.621371;
    private static final double METERS_PER_MILE = 1609.344;
    private static final double DEFAULT_ROUTE_BUFFER_METERS = 500.0;

    private final WebClient http;
    private final TrafficProps props;
    private final TrafficSampleWriter sampleWriter;
    private final CorridorGeometryStore corridorGeometryStore;
    private final TrafficProviderGuardService providerGuardService;
    private final ZoneId quotaZone;
    private final AtomicLong quotaUsedGauge;
    private final AtomicLong quotaHardStopGauge;
    private final Counter quotaBlockedCounter;

    private static record TileKey(int z, int x, int y) {}
    private static record CorridorGeometry(List<double[]> polyline) {}
    private static record TileFeature(String layerName, List<List<double[]>> paths, Map<String, Object> tags) {}
    private static record FlowCandidate(double speedMph, List<List<double[]>> paths) {}
    private static record IncidentCollection(String json, int count) {}
    private static record QuotaConfig(int target, int adaptiveCap, int hardStop) {}
    private static record TileCoveragePlan(int zoom, Map<String, Set<TileKey>> tilesByCorridor, Set<TileKey> uniqueTiles) {}

    private final Map<String, CorridorGeometry> routeCache = new ConcurrentHashMap<>();
    private LocalDate quotaDay;
    private long requestsUsedToday;

    public TileTrafficPoller(
        @Qualifier("tomtomWebClient") WebClient http,
        TrafficProps props,
        TrafficSampleWriter sampleWriter,
        CorridorGeometryStore corridorGeometryStore,
        TrafficProviderGuardService providerGuardService,
        MeterRegistry meterRegistry
    ) {
        this.http = http;
        this.props = props;
        this.sampleWriter = sampleWriter;
        this.corridorGeometryStore = corridorGeometryStore;
        this.providerGuardService = providerGuardService;
        this.quotaZone = ZoneId.of(DEFAULT_QUOTA_ZONE);
        this.quotaDay = LocalDate.now(this.quotaZone);
        this.requestsUsedToday = 0;
        this.quotaUsedGauge = meterRegistry.gauge("traffic.tile.quota.used.requests", new AtomicLong(0));
        this.quotaHardStopGauge = meterRegistry.gauge("traffic.tile.quota.hard_stop.requests", new AtomicLong(0));
        this.quotaBlockedCounter = Counter.builder("traffic.tile.quota.blocked.total")
            .description("Count of tile poll cycles blocked by quota")
            .register(meterRegistry);
        refreshQuotaGauges(resolveQuotaConfig().hardStop());
    }

    public Map<String, List<Double>> pollAndPersist(List<TrafficProps.Corridor> corridors, String apiKey) {
        if (corridors == null || corridors.isEmpty()) return Map.of();

        int requestedZoom = clamp(props.tileZoom(), 0, MAX_TILE_ZOOM);
        int concurrency = Math.max(1, props.tileConcurrency());
        double routeBufferMeters = props.tileRouteBufferMeters() > 0 ? props.tileRouteBufferMeters() : DEFAULT_ROUTE_BUFFER_METERS;
        QuotaConfig quota = resolveQuotaConfig();

        Map<String, CorridorGeometry> geometryByCorridor = loadCorridorGeometry(corridors, apiKey);
        TileCoveragePlan coveragePlan = resolveCoveragePlan(corridors, geometryByCorridor, requestedZoom, quota);
        if (coveragePlan.uniqueTiles().isEmpty()) {
            log.warn("No tile coverage generated; skipping tile-mode poll");
            return Map.of();
        }

        long plannedCalls = plannedCallsForUniqueTiles(coveragePlan.uniqueTiles().size());
        QuotaDecision quotaDecision = reserveQuota(plannedCalls, quota.hardStop());
        if (!quotaDecision.allowed()) {
            quotaBlockedCounter.increment();
            log.warn(
                "Tile polling paused: daily hard stop reached (used={}, hardStop={}, zone={}, resetAtNextLocalMidnight)",
                quotaDecision.requestsUsed(),
                quota.hardStop(),
                quotaZone
            );
            return Map.of();
        }

        TileCoveragePlan reservedPlan = shrinkPlanToReservedCalls(corridors, geometryByCorridor, coveragePlan, quotaDecision.callsReserved());
        if (reservedPlan == null) {
            quotaBlockedCounter.increment();
            log.warn(
                "Tile polling paused: not enough remaining daily quota for minimum tile pass (remaining={}, zone={})",
                quotaDecision.callsReserved(),
                quotaZone
            );
            rollbackReservedQuota(quotaDecision.callsReserved());
            return Map.of();
        }

        long reservedCalls = plannedCallsForUniqueTiles(reservedPlan.uniqueTiles().size());
        long releasedCalls = quotaDecision.callsReserved() - reservedCalls;
        if (releasedCalls > 0) {
            rollbackReservedQuota(releasedCalls);
        }

        logTileBudget(reservedPlan.zoom(), reservedPlan.uniqueTiles().size(), quota.target(), quota.adaptiveCap(), quota.hardStop());

        Tuple2<Map<TileKey, List<TileFeature>>, Map<TileKey, List<TileFeature>>> tileData = Mono.zip(
                fetchFlowTiles(reservedPlan.uniqueTiles(), apiKey, concurrency),
                fetchIncidentTiles(reservedPlan.uniqueTiles(), apiKey, concurrency)
            )
            .blockOptional()
            .orElse(null);
        if (tileData == null) return Map.of();

        return persistCorridorSamples(
            corridors,
            geometryByCorridor,
            reservedPlan.tilesByCorridor(),
            tileData.getT1(),
            tileData.getT2(),
            routeBufferMeters
        );
    }

    private QuotaConfig resolveQuotaConfig() {
        int target = Math.max(1, props.tileQuotaTargetDailyRequests());
        int adaptiveCap = Math.max(1, props.tileQuotaAdaptiveCapDailyRequests());
        int hardStop = Math.max(1, props.tileQuotaHardStopDailyRequests());

        if (adaptiveCap < target) adaptiveCap = target;
        if (hardStop < adaptiveCap) hardStop = adaptiveCap;
        return new QuotaConfig(target, adaptiveCap, hardStop);
    }

    private Map<String, CorridorGeometry> loadCorridorGeometry(List<TrafficProps.Corridor> corridors, String apiKey) {
        Map<String, CorridorGeometry> byCorridor = new LinkedHashMap<>();
        CorridorGeometry emptyGeometry = new CorridorGeometry(List.of());

        for (TrafficProps.Corridor corridor : corridors) {
            try {
                CorridorGeometry geometry = routeForCorridor(corridor, apiKey).blockOptional().orElse(emptyGeometry);
                byCorridor.put(corridor.name(), geometry);
            } catch (Exception e) {
                log.warn("Skipping corridor {} due to geometry setup error: {}", corridor.name(), e.toString());
            }
        }
        return byCorridor;
    }

    private TileCoveragePlan resolveCoveragePlan(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        int requestedZoom,
        QuotaConfig quota
    ) {
        TileCoveragePlan plan = buildCoveragePlan(corridors, geometryByCorridor, requestedZoom);
        int zoom = requestedZoom;

        while (zoom > 0 && !plan.uniqueTiles().isEmpty() && estimateCallsPerDay(plan.uniqueTiles().size()) > quota.target()) {
            zoom--;
            plan = buildCoveragePlan(corridors, geometryByCorridor, zoom);
        }

        while (zoom > 0 && !plan.uniqueTiles().isEmpty() && estimateCallsPerDay(plan.uniqueTiles().size()) > quota.adaptiveCap()) {
            zoom--;
            plan = buildCoveragePlan(corridors, geometryByCorridor, zoom);
        }

        if (requestedZoom != plan.zoom()) {
            log.warn(
                "Adjusted tile zoom from {} to {} to fit tile request budgets (target={}, adaptiveCap={})",
                requestedZoom,
                plan.zoom(),
                quota.target(),
                quota.adaptiveCap()
            );
        }
        return plan;
    }

    private TileCoveragePlan shrinkPlanToReservedCalls(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        TileCoveragePlan plan,
        long reservedCalls
    ) {
        if (reservedCalls <= 0) return null;

        TileCoveragePlan candidate = plan;
        while (candidate.zoom() > 0 && plannedCallsForUniqueTiles(candidate.uniqueTiles().size()) > reservedCalls) {
            candidate = buildCoveragePlan(corridors, geometryByCorridor, candidate.zoom() - 1);
            if (candidate.uniqueTiles().isEmpty()) return null;
        }

        return plannedCallsForUniqueTiles(candidate.uniqueTiles().size()) <= reservedCalls ? candidate : null;
    }

    private long plannedCallsForUniqueTiles(int uniqueTileCount) {
        return (long) uniqueTileCount * ENDPOINTS_PER_TILE;
    }

    private TileCoveragePlan buildCoveragePlan(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        int zoom
    ) {
        Map<String, Set<TileKey>> tilesByCorridor = buildTileCoverage(corridors, geometryByCorridor, zoom);
        return new TileCoveragePlan(zoom, tilesByCorridor, uniqueTiles(tilesByCorridor));
    }

    private Map<String, List<Double>> persistCorridorSamples(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        Map<String, Set<TileKey>> tilesByCorridor,
        Map<TileKey, List<TileFeature>> flowTiles,
        Map<TileKey, List<TileFeature>> incidentTiles,
        double routeBufferMeters
    ) {
        Map<String, List<Double>> speedsByCorridor = new LinkedHashMap<>();
        CorridorGeometry emptyGeometry = new CorridorGeometry(List.of());

        for (TrafficProps.Corridor corridor : corridors) {
            Set<TileKey> corridorTiles = tilesByCorridor.get(corridor.name());
            if (corridorTiles == null || corridorTiles.isEmpty()) continue;

            CorridorGeometry geometry = geometryByCorridor.getOrDefault(corridor.name(), emptyGeometry);
            List<Double> speeds = collectCorridorSpeeds(corridorTiles, flowTiles, geometry.polyline(), routeBufferMeters);
            IncidentCollection incidents = collectCorridorIncidents(corridor, corridorTiles, incidentTiles, geometry.polyline(), routeBufferMeters);
            TrafficStats stats = TrafficStats.fromSpeeds(speeds);

            TrafficSample sample = new TrafficSample();
            sample.setCorridor(corridor.name());
            sample.setSourceMode("tile");
            sample.setAvgCurrentSpeed(stats.avgSpeed());
            sample.setAvgFreeflowSpeed(null);
            sample.setMinCurrentSpeed(stats.minSpeed());
            sample.setConfidence(null);
            sample.setSpeedSampleCount(stats.sampleCount());
            sample.setSpeedStddev(stats.stddev());
            sample.setP10Speed(stats.p10Speed());
            sample.setP50Speed(stats.p50Speed());
            sample.setP90Speed(stats.p90Speed());
            sample.setIncidentsJson(incidents.json());
            sample.setIncidentCount(incidents.count());
            sampleWriter.saveSampleWithIncidents(sample);

            speedsByCorridor.put(corridor.name(), List.copyOf(speeds));
        }

        return speedsByCorridor;
    }

    private record QuotaDecision(boolean allowed, long callsReserved, long requestsUsed) {}
    public record QuotaSnapshot(long usedToday, int target, int adaptiveCap, int hardStop) {}

    public QuotaSnapshot quotaSnapshot() {
        QuotaConfig quota = resolveQuotaConfig();
        return new QuotaSnapshot(requestsUsedToday(), quota.target(), quota.adaptiveCap(), quota.hardStop());
    }

    private synchronized QuotaDecision reserveQuota(long requestedCalls, int hardStopDailyRequests) {
        rollDayIfNeeded();
        refreshQuotaGauges(hardStopDailyRequests);
        if (requestsUsedToday >= hardStopDailyRequests) {
            return new QuotaDecision(false, 0, requestsUsedToday);
        }
        long remaining = hardStopDailyRequests - requestsUsedToday;
        long reserved = Math.min(remaining, Math.max(0, requestedCalls));
        requestsUsedToday += reserved;
        refreshQuotaGauges(hardStopDailyRequests);
        return new QuotaDecision(reserved > 0, reserved, requestsUsedToday);
    }

    private synchronized void rollbackReservedQuota(long callsToRelease) {
        rollDayIfNeeded();
        if (callsToRelease <= 0) return;
        requestsUsedToday = Math.max(0, requestsUsedToday - callsToRelease);
        refreshQuotaGauges(resolveQuotaConfig().hardStop());
    }

    private synchronized long requestsUsedToday() {
        rollDayIfNeeded();
        return requestsUsedToday;
    }

    private synchronized void rollDayIfNeeded() {
        LocalDate now = LocalDate.now(quotaZone);
        if (!now.equals(quotaDay)) {
            quotaDay = now;
            requestsUsedToday = 0;
            log.info("Tile request quota reset for new day in zone {}", quotaZone);
            refreshQuotaGauges(resolveQuotaConfig().hardStop());
        }
    }

    private void refreshQuotaGauges(int hardStopDailyRequests) {
        quotaUsedGauge.set(requestsUsedToday);
        quotaHardStopGauge.set(hardStopDailyRequests);
    }

    private Map<String, Set<TileKey>> buildTileCoverage(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        int zoom
    ) {
        Map<String, Set<TileKey>> out = new LinkedHashMap<>();
        for (TrafficProps.Corridor corridor : corridors) {
            try {
                CorridorGeometry geometry = geometryByCorridor.get(corridor.name());
                Set<TileKey> routeTiles = tileKeysForRoute(geometry == null ? List.of() : geometry.polyline(), zoom);
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

    private static Set<TileKey> uniqueTiles(Map<String, Set<TileKey>> tilesByCorridor) {
        Set<TileKey> unique = new LinkedHashSet<>();
        for (Set<TileKey> tiles : tilesByCorridor.values()) {
            unique.addAll(tiles);
        }
        return unique;
    }

    private double estimateCallsPerDay(int uniqueTiles) {
        long callsPerPoll = plannedCallsForUniqueTiles(uniqueTiles);
        double pollsPerDay = 86400.0 / Math.max(1, props.pollSeconds());
        return callsPerPoll * pollsPerDay;
    }

    private void logTileBudget(
        int zoom,
        int uniqueTiles,
        int targetDailyRequests,
        int adaptiveCapDailyRequests,
        int hardStopDailyRequests
    ) {
        long callsPerPoll = plannedCallsForUniqueTiles(uniqueTiles);
        double estimatedCallsPerDay = estimateCallsPerDay(uniqueTiles);
        long used = requestsUsedToday();

        if (estimatedCallsPerDay > adaptiveCapDailyRequests) {
            log.warn(
                "Tile request estimate exceeds adaptive cap: zoom={} uniqueTiles={} callsPerPoll={} estCallsPerDay={} target={} adaptiveCap={} usedToday={} hardStop={}",
                zoom,
                uniqueTiles,
                callsPerPoll,
                String.format(Locale.US, "%.0f", estimatedCallsPerDay),
                targetDailyRequests,
                adaptiveCapDailyRequests,
                used,
                hardStopDailyRequests
            );
        } else {
            log.info(
                "Tile mode budget check: zoom={} uniqueTiles={} callsPerPoll={} estCallsPerDay={} target={} adaptiveCap={} usedToday={} hardStop={}",
                zoom,
                uniqueTiles,
                callsPerPoll,
                String.format(Locale.US, "%.0f", estimatedCallsPerDay),
                targetDailyRequests,
                adaptiveCapDailyRequests,
                used,
                hardStopDailyRequests
            );
        }
    }

    private List<Double> collectCorridorSpeeds(
        Set<TileKey> corridorTiles,
        Map<TileKey, List<TileFeature>> flowTiles,
        List<double[]> route,
        double routeBufferMeters
    ) {
        List<FlowCandidate> candidates = buildFlowCandidates(corridorTiles, flowTiles, route, routeBufferMeters);
        if (candidates.isEmpty()) return List.of();

        List<double[]> mileSamples = samplePerMile(route, METERS_PER_MILE);
        if (mileSamples.isEmpty()) {
            // Fallback: route unavailable; preserve one speed per unique flow feature.
            List<Double> fallback = new ArrayList<>(candidates.size());
            for (FlowCandidate candidate : candidates) fallback.add(candidate.speedMph());
            return fallback;
        }

        List<Double> speeds = new ArrayList<>(mileSamples.size());
        for (double[] sample : mileSamples) {
            Double speed = nearestSpeedForSample(sample[0], sample[1], candidates, routeBufferMeters);
            if (speed != null) speeds.add(speed);
        }
        return speeds;
    }

    private List<FlowCandidate> buildFlowCandidates(
        Set<TileKey> corridorTiles,
        Map<TileKey, List<TileFeature>> flowTiles,
        List<double[]> route,
        double routeBufferMeters
    ) {
        List<FlowCandidate> candidates = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        for (TileKey key : corridorTiles) {
            for (TileFeature feature : flowTiles.getOrDefault(key, List.of())) {
                String roadType = getStringTag(feature.tags(), "road_type", "road_category");
                if (!isCorridorRoadType(roadType)) continue;
                if (!featureWithinBuffer(feature, route, routeBufferMeters)) continue;

                Double speedKph = getDoubleTag(feature.tags(), "traffic_level");
                if (speedKph == null) continue;

                String dedupeKey = flowFeatureKey(feature, speedKph);
                if (!seen.add(dedupeKey)) continue;

                candidates.add(new FlowCandidate(speedKph * KPH_TO_MPH, feature.paths()));
            }
        }

        return candidates;
    }

    private static Double nearestSpeedForSample(
        double lat,
        double lon,
        List<FlowCandidate> candidates,
        double maxDistanceMeters
    ) {
        double bestDistance = Double.POSITIVE_INFINITY;
        Double bestSpeed = null;

        for (FlowCandidate candidate : candidates) {
            double distance = minDistanceMetersToFeature(lat, lon, candidate.paths());
            if (distance <= maxDistanceMeters && distance < bestDistance) {
                bestDistance = distance;
                bestSpeed = candidate.speedMph();
            }
        }

        return bestSpeed;
    }

    private IncidentCollection collectCorridorIncidents(
        TrafficProps.Corridor corridor,
        Set<TileKey> corridorTiles,
        Map<TileKey, List<TileFeature>> incidentTiles,
        List<double[]> route,
        double routeBufferMeters
    ) {
        ArrayNode incidents = JsonNodeFactory.instance.arrayNode();
        Set<String> seen = new HashSet<>();

        for (TileKey key : corridorTiles) {
            for (TileFeature feature : incidentTiles.getOrDefault(key, List.of())) {
                String roadType = getStringTag(feature.tags(), "road_type", "road_category");
                if (roadType != null && !roadType.isBlank() && !isCorridorRoadType(roadType)) continue;
                if (!featureWithinBuffer(feature, route, routeBufferMeters)) continue;

                String dedupeKey = incidentFeatureKey(feature);
                if (!seen.add(dedupeKey)) continue;

                ObjectNode mapped = mapIncident(feature, corridor.name());
                if (mapped != null) {
                    incidents.add(IncidentLocationEnricher.enrichIncident(mapped, corridor, route));
                }
            }
        }

        ObjectNode wrapped = JsonNodeFactory.instance.objectNode();
        wrapped.set("incidents", incidents);
        return new IncidentCollection(wrapped.toString(), incidents.size());
    }

    private Mono<CorridorGeometry> routeForCorridor(TrafficProps.Corridor corridor, String apiKey) {
        CorridorGeometry cached = routeCache.get(corridor.name());
        if (cached != null) return Mono.just(cached);

        double[] bb = normalizeBbox(corridor.bbox());
        double minLat = bb[0], minLon = bb[1], maxLat = bb[2], maxLon = bb[3];

        double startLat = maxLat, startLon = minLon;
        double endLat = minLat, endLon = maxLon;

        String routePath = "/routing/1/calculateRoute/"
            + String.format(Locale.ROOT, "%.6f,%.6f:%.6f,%.6f", startLat, startLon, endLat, endLon)
            + "/json";

        return http.get()
            .uri(u -> u.path(routePath)
                .queryParam("traffic", "true")
                .queryParam("avoid", "unpavedRoads")
                .queryParam("key", apiKey)
                .build())
            .retrieve()
            .bodyToMono(JsonNode.class)
            .map(json -> {
                List<double[]> polyline = new ArrayList<>();
                var points = json.path("routes").path(0).path("legs").path(0).path("points");
                if (points.isArray()) {
                    points.forEach(p -> polyline.add(new double[]{
                        p.path("latitude").asDouble(),
                        p.path("longitude").asDouble()
                    }));
                }
                corridorGeometryStore.updateFromRouting(corridor.name(), polyline);
                CorridorGeometry geom = new CorridorGeometry(polyline);
                routeCache.put(corridor.name(), geom);
                return geom;
            })
            .timeout(Duration.ofSeconds(8))
            .retryWhen(
                Retry.backoff(2, Duration.ofMillis(300))
                    .filter(ex -> {
                        if (ex instanceof WebClientResponseException w) {
                            return w.getStatusCode().is5xxServerError();
                        }
                        return (ex instanceof TimeoutException) || (ex instanceof IOException);
                    })
            )
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.tripAuthorizationFailure(
                        "routing/1/calculateRoute",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString()
                    );
                }
                log.debug("Routing polyline failed for {}: {}", corridor.name(), e.toString());
                return Mono.just(new CorridorGeometry(List.of()));
            });
    }

    private Mono<Map<TileKey, List<TileFeature>>> fetchFlowTiles(Set<TileKey> tiles, String apiKey, int concurrency) {
        return Flux.fromIterable(tiles)
            .flatMap(tile -> flowTileCall(tile, apiKey)
                .map(bytes -> Map.entry(tile, decodeTile(bytes, tile).stream().filter(this::isFlowLayer).toList()))
                .onErrorResume(e -> {
                    log.debug("Flow tile call failed for {}/{}/{}: {}", tile.z(), tile.x(), tile.y(), e.toString());
                    return Mono.just(Map.entry(tile, List.of()));
                }), concurrency)
            .collectMap(Map.Entry::getKey, Map.Entry::getValue);
    }

    private Mono<Map<TileKey, List<TileFeature>>> fetchIncidentTiles(Set<TileKey> tiles, String apiKey, int concurrency) {
        return Flux.fromIterable(tiles)
            .flatMap(tile -> incidentTileCall(tile, apiKey)
                .map(bytes -> Map.entry(tile, decodeTile(bytes, tile).stream().filter(this::isIncidentLayer).toList()))
                .onErrorResume(e -> {
                    log.debug("Incident tile call failed for {}/{}/{}: {}", tile.z(), tile.x(), tile.y(), e.toString());
                    return Mono.just(Map.entry(tile, List.of()));
                }), concurrency)
            .collectMap(Map.Entry::getKey, Map.Entry::getValue);
    }

    private Mono<byte[]> flowTileCall(TileKey tile, String apiKey) {
        return http.get()
            .uri(u -> u.path("/traffic/map/4/tile/flow/absolute/" + tile.z() + "/" + tile.x() + "/" + tile.y() + ".pbf")
                .queryParam("roadTypes", "[0,1,2]")
                .queryParam("margin", "0")
                .queryParam("key", apiKey)
                .build())
            .header("Cache-Control", "no-cache")
            .header("Pragma", "no-cache")
            .header("Tracking-ID", java.util.UUID.randomUUID().toString())
            .retrieve()
            .bodyToMono(byte[].class)
            .timeout(Duration.ofSeconds(8))
            .retryWhen(
                Retry.backoff(2, Duration.ofMillis(300))
                    .filter(ex -> {
                        if (ex instanceof WebClientResponseException w) {
                            return w.getStatusCode().is5xxServerError();
                        }
                        return (ex instanceof TimeoutException) || (ex instanceof IOException);
                    })
            )
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.tripAuthorizationFailure(
                        "traffic/map/4/tile/flow",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString()
                    );
                }
                return Mono.error(e);
            });
    }

    private Mono<byte[]> incidentTileCall(TileKey tile, String apiKey) {
        return http.get()
            .uri(u -> u.path("/traffic/map/4/tile/incidents/" + tile.z() + "/" + tile.x() + "/" + tile.y() + ".pbf")
                .queryParam("tags", "[icon_category,delay,road_type,id]")
                .queryParam("key", apiKey)
                .build())
            .header("Cache-Control", "no-cache")
            .header("Pragma", "no-cache")
            .header("Tracking-ID", java.util.UUID.randomUUID().toString())
            .retrieve()
            .bodyToMono(byte[].class)
            .timeout(Duration.ofSeconds(8))
            .retryWhen(
                Retry.backoff(2, Duration.ofMillis(300))
                    .filter(ex -> {
                        if (ex instanceof WebClientResponseException w) {
                            return w.getStatusCode().is5xxServerError();
                        }
                        return (ex instanceof TimeoutException) || (ex instanceof IOException);
                    })
            )
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.tripAuthorizationFailure(
                        "traffic/map/4/tile/incidents",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString()
                    );
                }
                return Mono.error(e);
            });
    }

    private List<TileFeature> decodeTile(byte[] bytes, TileKey tile) {
        if (bytes == null || bytes.length == 0) return List.of();

        try {
            VectorTile.Tile decoded = VectorTile.Tile.parseFrom(bytes);
            List<TileFeature> out = new ArrayList<>();

            for (VectorTile.Tile.Layer layer : decoded.getLayersList()) {
                int extent = layer.hasExtent() ? layer.getExtent() : 4096;
                for (VectorTile.Tile.Feature feature : layer.getFeaturesList()) {
                    if (feature.getType() == VectorTile.Tile.GeomType.UNKNOWN) continue;
                    List<List<double[]>> paths = decodeGeometry(feature, extent, tile);
                    if (paths.isEmpty()) continue;
                    out.add(new TileFeature(layer.getName(), paths, decodeTags(layer, feature)));
                }
            }

            return out;
        } catch (IOException e) {
            log.debug("Unable to decode tile {}/{}/{}: {}", tile.z(), tile.x(), tile.y(), e.toString());
            return List.of();
        }
    }

    private Map<String, Object> decodeTags(VectorTile.Tile.Layer layer, VectorTile.Tile.Feature feature) {
        Map<String, Object> tags = new LinkedHashMap<>();
        List<Integer> indexed = feature.getTagsList();
        for (int i = 0; i + 1 < indexed.size(); i += 2) {
            int keyIndex = indexed.get(i);
            int valueIndex = indexed.get(i + 1);
            if (keyIndex < 0 || keyIndex >= layer.getKeysCount()) continue;
            if (valueIndex < 0 || valueIndex >= layer.getValuesCount()) continue;

            String key = layer.getKeys(keyIndex);
            Object value = toValue(layer.getValues(valueIndex));
            if (value != null) tags.put(key, value);
        }
        return tags;
    }

    private static Object toValue(VectorTile.Tile.Value value) {
        if (value.hasStringValue()) return value.getStringValue();
        if (value.hasFloatValue()) return value.getFloatValue();
        if (value.hasDoubleValue()) return value.getDoubleValue();
        if (value.hasIntValue()) return value.getIntValue();
        if (value.hasUintValue()) return value.getUintValue();
        if (value.hasSintValue()) return value.getSintValue();
        if (value.hasBoolValue()) return value.getBoolValue();
        return null;
    }

    private List<List<double[]>> decodeGeometry(VectorTile.Tile.Feature feature, int extent, TileKey tile) {
        List<Integer> geometry = feature.getGeometryList();
        List<List<double[]>> paths = new ArrayList<>();
        List<double[]> current = new ArrayList<>();

        int x = 0;
        int y = 0;
        int idx = 0;

        while (idx < geometry.size()) {
            int commandHeader = geometry.get(idx++);
            int command = commandHeader & 0x7;
            int count = commandHeader >> 3;

            if (command == 1 || command == 2) {
                for (int i = 0; i < count; i++) {
                    if (idx + 1 >= geometry.size()) break;
                    if (command == 1 && !current.isEmpty()) {
                        paths.add(current);
                        current = new ArrayList<>();
                    }

                    x += decodeZigZag(geometry.get(idx++));
                    y += decodeZigZag(geometry.get(idx++));
                    current.add(toLatLon(tile, extent, x, y));

                    if (feature.getType() == VectorTile.Tile.GeomType.POINT) {
                        paths.add(current);
                        current = new ArrayList<>();
                    }
                }
            } else if (command == 7) {
                if (!current.isEmpty() && feature.getType() == VectorTile.Tile.GeomType.POLYGON) {
                    current.add(current.get(0));
                }
            } else {
                break;
            }
        }

        if (!current.isEmpty()) {
            paths.add(current);
        }
        return paths;
    }

    private static int decodeZigZag(int encoded) {
        return (encoded >>> 1) ^ (-(encoded & 1));
    }

    private static double[] toLatLon(TileKey tile, int extent, int geomX, int geomY) {
        double n = Math.pow(2.0, tile.z());
        double worldX = tile.x() + (geomX / (double) extent);
        double worldY = tile.y() + (geomY / (double) extent);

        double lon = (worldX / n) * 360.0 - 180.0;
        double mercatorY = Math.PI - (2.0 * Math.PI * worldY / n);
        double lat = Math.toDegrees(Math.atan(Math.sinh(mercatorY)));
        return new double[]{lat, lon};
    }

    private static Set<TileKey> tileKeysForBbox(String bbox, int zoom) {
        double[] bb = normalizeBbox(bbox);
        double minLat = bb[0], minLon = bb[1], maxLat = bb[2], maxLon = bb[3];

        TileKey topLeft = latLonToTile(maxLat, minLon, zoom);
        TileKey bottomRight = latLonToTile(minLat, maxLon, zoom);

        int xMin = Math.min(topLeft.x(), bottomRight.x());
        int xMax = Math.max(topLeft.x(), bottomRight.x());
        int yMin = Math.min(topLeft.y(), bottomRight.y());
        int yMax = Math.max(topLeft.y(), bottomRight.y());

        Set<TileKey> tiles = new LinkedHashSet<>();
        for (int x = xMin; x <= xMax; x++) {
            for (int y = yMin; y <= yMax; y++) {
                tiles.add(new TileKey(zoom, x, y));
            }
        }
        return tiles;
    }

    private static Set<TileKey> tileKeysForRoute(List<double[]> route, int zoom) {
        if (route == null || route.size() < 2) return Set.of();

        List<double[]> coveragePoints = samplePolylineWithMaxSpacing(route, METERS_PER_MILE);
        if (coveragePoints.isEmpty()) return Set.of();

        Set<TileKey> tiles = new LinkedHashSet<>();
        for (double[] point : coveragePoints) {
            tiles.add(latLonToTile(point[0], point[1], zoom));
        }
        return tiles;
    }

    private static TileKey latLonToTile(double lat, double lon, int zoom) {
        double n = Math.pow(2.0, zoom);
        double rawX = ((lon + 180.0) / 360.0) * n;
        double latRad = Math.toRadians(lat);
        double rawY = (1.0 - Math.log(Math.tan(latRad) + (1.0 / Math.cos(latRad))) / Math.PI) / 2.0 * n;

        int max = (int) n - 1;
        int x = clamp((int) Math.floor(rawX), 0, max);
        int y = clamp((int) Math.floor(rawY), 0, max);
        return new TileKey(zoom, x, y);
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

    private static List<double[]> samplePerMile(List<double[]> polyline, double spacingMeters) {
        if (polyline == null || polyline.size() < 2) return List.of();

        double[] cumulative = cumulativeDistances(polyline);
        double totalMeters = cumulative[cumulative.length - 1];
        if (totalMeters <= 0) return List.of();

        int sampleCount = Math.max(1, (int) Math.floor(totalMeters / Math.max(1.0, spacingMeters)));

        List<double[]> out = new ArrayList<>(sampleCount);
        double step = totalMeters / sampleCount;
        for (int i = 0; i < sampleCount; i++) {
            double target = (i + 0.5) * step;
            out.add(pointAtDistance(polyline, cumulative, target));
        }
        return out;
    }

    private static double[] cumulativeDistances(List<double[]> polyline) {
        double[] cumulative = new double[polyline.size()];
        cumulative[0] = 0.0;
        for (int i = 1; i < polyline.size(); i++) {
            double[] prev = polyline.get(i - 1);
            double[] curr = polyline.get(i);
            cumulative[i] = cumulative[i - 1] + haversineMeters(prev[0], prev[1], curr[0], curr[1]);
        }
        return cumulative;
    }

    private static double[] pointAtDistance(List<double[]> polyline, double[] cumulative, double targetMeters) {
        if (polyline.isEmpty()) return new double[]{0.0, 0.0};
        if (targetMeters <= 0) return polyline.get(0);
        double total = cumulative[cumulative.length - 1];
        if (targetMeters >= total) return polyline.get(polyline.size() - 1);

        int idx = 0;
        while (idx < cumulative.length - 1 && cumulative[idx + 1] < targetMeters) idx++;

        double segmentStart = cumulative[idx];
        double segmentEnd = cumulative[idx + 1];
        double segmentLength = segmentEnd - segmentStart;
        double t = segmentLength <= 0 ? 0.0 : (targetMeters - segmentStart) / segmentLength;

        return interpolate(polyline.get(idx), polyline.get(idx + 1), t);
    }

    private static double[] interpolate(double[] start, double[] end, double t) {
        double lat = start[0] + t * (end[0] - start[0]);
        double lon = start[1] + t * (end[1] - start[1]);
        return new double[]{lat, lon};
    }

    private static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double r = 6371008.8;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    private static double[] normalizeBbox(String bbox) {
        String[] p = bbox.split(",");
        if (p.length != 4) throw new IllegalArgumentException("bbox must be 'lat1,lon1,lat2,lon2'");

        double a = Double.parseDouble(p[0].trim());
        double b = Double.parseDouble(p[1].trim());
        double c = Double.parseDouble(p[2].trim());
        double d = Double.parseDouble(p[3].trim());

        if (Math.abs(a) > 90 || Math.abs(b) <= 90) {
            double t = a;
            a = b;
            b = t;
        }
        if (Math.abs(c) > 90 || Math.abs(d) <= 90) {
            double t = c;
            c = d;
            d = t;
        }

        double minLat = Math.min(a, c), maxLat = Math.max(a, c);
        double minLon = Math.min(b, d), maxLon = Math.max(b, d);
        double eps = 1e-6;

        if (Math.abs(maxLat - minLat) < eps) {
            maxLat += eps;
            minLat -= eps;
        }
        if (Math.abs(maxLon - minLon) < eps) {
            maxLon += eps;
            minLon -= eps;
        }

        return new double[]{minLat, minLon, maxLat, maxLon};
    }

    private boolean isFlowLayer(TileFeature feature) {
        String layerName = feature.layerName() == null ? "" : feature.layerName().toLowerCase(Locale.ROOT);
        return layerName.contains("traffic flow");
    }

    private boolean isIncidentLayer(TileFeature feature) {
        String layerName = feature.layerName() == null ? "" : feature.layerName().toLowerCase(Locale.ROOT);
        return layerName.contains("incident");
    }

    private static boolean featureWithinBuffer(TileFeature feature, List<double[]> polyline, double bufferMeters) {
        if (polyline == null || polyline.size() < 2) return true;
        for (List<double[]> path : feature.paths()) {
            for (double[] point : path) {
                if (minDistanceMetersToPolyline(point[0], point[1], polyline) <= bufferMeters) return true;
            }
        }
        return false;
    }

    private static String flowFeatureKey(TileFeature feature, Double speedKph) {
        List<double[]> path = firstPath(feature.paths());
        if (path.isEmpty()) return "";
        double[] start = path.get(0);
        double[] end = path.get(path.size() - 1);
        String roadType = getStringTag(feature.tags(), "road_type", "road_category");
        return String.format(
            Locale.US,
            "%s|%.5f,%.5f|%.5f,%.5f|%.2f",
            roadType == null ? "" : roadType,
            start[0], start[1],
            end[0], end[1],
            speedKph
        );
    }

    private static String incidentFeatureKey(TileFeature feature) {
        Object id = feature.tags().get("id");
        if (id != null) return String.valueOf(id);

        List<double[]> path = firstPath(feature.paths());
        if (path.isEmpty()) return "";

        double[] first = path.get(0);
        String icon = getStringTag(feature.tags(), "icon_category", "icon_category_0");
        Double delay = getDoubleTag(feature.tags(), "delay");
        return String.format(Locale.US, "%s|%s|%.5f,%.5f", icon, delay, first[0], first[1]);
    }

    private static List<double[]> firstPath(List<List<double[]>> paths) {
        for (List<double[]> path : paths) {
            if (path != null && !path.isEmpty()) return path;
        }
        return List.of();
    }

    private static ObjectNode mapIncident(TileFeature feature, String corridorName) {
        List<double[]> path = firstPath(feature.paths());
        if (path.isEmpty()) return null;

        ObjectNode incident = JsonNodeFactory.instance.objectNode();
        ObjectNode propsNode = JsonNodeFactory.instance.objectNode();
        ObjectNode geomNode = JsonNodeFactory.instance.objectNode();

        ArrayNode roads = JsonNodeFactory.instance.arrayNode();
        roads.add(corridorName);
        propsNode.set("roadNumbers", roads);

        Double icon = getDoubleTag(feature.tags(), "icon_category", "icon_category_0");
        if (icon != null) propsNode.put("iconCategory", icon.intValue());

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

    private static Double getDoubleTag(Map<String, Object> tags, String... keys) {
        for (String key : keys) {
            Object value = tags.get(key);
            if (value instanceof Number number) return number.doubleValue();
            if (value instanceof String text) {
                try {
                    return Double.parseDouble(text);
                } catch (NumberFormatException ignored) {
                    // Ignore non-numeric values.
                }
            }
        }
        return null;
    }

    private static String getStringTag(Map<String, Object> tags, String... keys) {
        for (String key : keys) {
            Object value = tags.get(key);
            if (value != null) return String.valueOf(value);
        }
        return null;
    }

    private static boolean isCorridorRoadType(String roadType) {
        if (roadType == null || roadType.isBlank()) return false;
        String r = roadType.trim().toLowerCase(Locale.ROOT);
        if (r.equals("0") || r.equals("1") || r.equals("2")) return true;
        return r.contains("motorway")
            || r.contains("international")
            || r.contains("major road")
            || r.equals("trunk")
            || r.equals("trunk_link")
            || r.equals("primary")
            || r.equals("primary_link");
    }

    private static Double avg(List<Double> values) {
        if (values.isEmpty()) return null;
        double sum = 0;
        for (double v : values) sum += v;
        return sum / values.size();
    }

    private static Double min(List<Double> values) {
        if (values.isEmpty()) return null;
        double minimum = Double.POSITIVE_INFINITY;
        for (double v : values) if (v < minimum) minimum = v;
        return minimum;
    }

    private static double minDistanceMetersToPolyline(double lat, double lon, List<double[]> poly) {
        if (poly.size() < 2) return Double.POSITIVE_INFINITY;
        double min = Double.POSITIVE_INFINITY;
        for (int i = 0; i < poly.size() - 1; i++) {
            double[] a = poly.get(i), b = poly.get(i + 1);
            min = Math.min(min, distancePointToSegmentMeters(lat, lon, a[0], a[1], b[0], b[1]));
        }
        return min;
    }

    private static double minDistanceMetersToFeature(double lat, double lon, List<List<double[]>> paths) {
        double min = Double.POSITIVE_INFINITY;
        for (List<double[]> path : paths) {
            if (path == null || path.isEmpty()) continue;
            if (path.size() == 1) {
                double[] point = path.get(0);
                min = Math.min(min, haversineMeters(lat, lon, point[0], point[1]));
                continue;
            }
            min = Math.min(min, minDistanceMetersToPolyline(lat, lon, path));
        }
        return min;
    }

    private static double distancePointToSegmentMeters(double plat, double plon, double alat, double alon, double blat, double blon) {
        double lat0 = Math.toRadians(plat);
        double mLat = 111320.0;
        double mLon = 111320.0 * Math.cos(lat0);

        double ax = (alon - plon) * mLon, ay = (alat - plat) * mLat;
        double bx = (blon - plon) * mLon, by = (blat - plat) * mLat;

        double vectorx = bx - ax, vectory = by - ay;
        double len2 = vectorx * vectorx + vectory * vectory;
        if (len2 == 0) return Math.hypot(ax, ay);

        double t = -(ax * vectorx + ay * vectory) / len2;
        t = Math.max(0, Math.min(1, t));

        double px = ax + t * vectorx, py = ay + t * vectory;
        return Math.hypot(px, py);
    }
}
