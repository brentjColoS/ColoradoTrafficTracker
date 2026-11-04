package com.example.ingest_service;

import static com.example.ingest_service.CorridorGeometrySupport.haversineMeters;
import static com.example.ingest_service.CorridorGeometrySupport.interpolate;
import static com.example.ingest_service.CorridorGeometrySupport.minDistanceMetersToPolyline;
import static com.example.ingest_service.CorridorGeometrySupport.normalizeBbox;

import com.example.common.CorridorSpeedZones;
import com.example.common.SpeedZoneDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import reactor.util.retry.Retry;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

@Component
public class TileTrafficPoller {

    private static final Logger log = LoggerFactory.getLogger(TileTrafficPoller.class);

    private static final String TOMTOM_PROVIDER = "tomtom";
    private static final String VECTOR_TILE_PRODUCT = "traffic-flow-incidents-vector-tiles";

    private static final double KPH_TO_MPH = 0.621371;
    private static final double METERS_PER_MILE = 1609.344;
    private static final double DEFAULT_ROUTE_BUFFER_METERS = 500.0;
    private static final double DEFAULT_SPEED_ROUTE_BUFFER_METERS = 150.0;
    private static final double DEFAULT_SPEED_SAMPLE_SPACING_METERS = METERS_PER_MILE / 2.0;
    private static final double DEFAULT_SPEED_BLEND_RADIUS_METERS = 90.0;
    private static final int DEFAULT_SPEED_BLEND_MAX_CANDIDATES = 3;
    private static final String CORRIDOR_I25 = "I25";

    private final WebClient http;
    private final TrafficProps props;
    private final TileCoveragePlanner coveragePlanner;
    private final TrafficPullProps pullProps;
    private final TrafficSampleWriter sampleWriter;
    private final CorridorGeometryStore corridorGeometryStore;
    private final TrafficProviderGuardService providerGuardService;
    private final TomTomAccountQuotaManager quotaManager;
    private final TomTomRequestGovernor requestGovernor;
    private final IncidentSnapshotStore incidentSnapshotStore;
    private final FlowSpatialEvidenceStore flowSpatialEvidenceStore;
    private final CorridorFlowCellStore corridorFlowCellStore;
    private final AtomicLong quotaUsedGauge;
    private final AtomicLong quotaHardStopGauge;
    private final Counter quotaBlockedCounter;

    private static record FlowCandidate(double speedMph, List<List<double[]>> paths) {}
    private static record IncidentCollection(String json, int count) {}
    private static record QuotaConfig(
        int target,
        int adaptiveCap,
        int hardStop,
        int allowance,
        int targetPerAccount,
        int hardStopPerAccount,
        int allowancePerAccount,
        int accountCount
    ) {}
    private static record RouteSamplePoint(double lat, double lon, Double mileMarker) {}
    private static record CorridorSpeedObservation(Double mileMarker, Double speedMph) {}
    private static record CorridorSpeedProjection(List<FlowCandidate> candidates, List<CorridorSpeedObservation> observations) {
        private List<Double> speeds() {
            return observations.stream()
                .map(CorridorSpeedObservation::speedMph)
                .filter(speed -> speed != null)
                .toList();
        }
    }
    private static record ZoneSlowdownSignal(boolean localized, String note) {
        private static ZoneSlowdownSignal none() {
            return new ZoneSlowdownSignal(false, null);
        }
    }
    private static record ZoneSampleBundle(List<TrafficSpeedZoneSample> zoneSamples, ZoneSlowdownSignal slowdownSignal) {
        private static ZoneSampleBundle empty() {
            return new ZoneSampleBundle(List.of(), ZoneSlowdownSignal.none());
        }
    }
    private final Map<String, CorridorGeometry> routeCache = new ConcurrentHashMap<>();

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
        this.http = http;
        this.props = props;
        this.coveragePlanner = new TileCoveragePlanner(props.tileZoom());
        this.pullProps = pullProps;
        this.sampleWriter = sampleWriter;
        this.corridorGeometryStore = corridorGeometryStore;
        this.providerGuardService = providerGuardService;
        this.quotaManager = quotaManager;
        this.requestGovernor = requestGovernor;
        this.incidentSnapshotStore = incidentSnapshotStore;
        this.flowSpatialEvidenceStore = flowSpatialEvidenceStore;
        this.corridorFlowCellStore = corridorFlowCellStore;
        this.quotaUsedGauge = meterRegistry.gauge("traffic.tile.quota.used.requests", new AtomicLong(0));
        this.quotaHardStopGauge = meterRegistry.gauge("traffic.tile.quota.hard_stop.requests", new AtomicLong(0));
        this.quotaBlockedCounter = Counter.builder("traffic.tile.quota.blocked.total")
            .description("Count of tile poll cycles blocked by quota")
            .register(meterRegistry);
        this.quotaUsedGauge.set(0);
        this.quotaHardStopGauge.set(resolveQuotaConfig().hardStop());
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
        double speedRouteBufferMeters = DEFAULT_SPEED_ROUTE_BUFFER_METERS;
        QuotaConfig quota = resolveQuotaConfig();

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
        QuotaDecision quotaDecision = reserveQuota(plannedCalls, quota.hardStopPerAccount());
        if (!quotaDecision.allowed()) {
            quotaBlockedCounter.increment();
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

        AtomicLong issuedCalls = new AtomicLong();
        Set<TrafficTile> fineTiles = coveragePlanner.fineFlowTiles(reservedPlan, geometryByCorridor, flow.precision());
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles;
        try {
            flowTiles = fetchFlowTiles(
                reservedPlan.uniqueTiles(),
                quotaDecision.account(),
                concurrency,
                issuedCalls,
                fineTiles
            )
                .blockOptional()
                .orElse(null);
        } finally {
            rollbackReservedQuota(
                quotaDecision.reservation(),
                Math.max(0, reservedCalls - issuedCalls.get())
            );
        }
        if (flowTiles == null) return Map.of();

        return persistCorridorSamples(
            corridors,
            geometryByCorridor,
            reservedPlan.tilesByCorridor(),
            reservedPlan.zoomByCorridor(),
            flowTiles,
            speedRouteBufferMeters,
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

        QuotaConfig quota = resolveQuotaConfig();
        long plannedCalls = plan.uniqueTiles().size();
        QuotaDecision quotaDecision = reserveQuota(plannedCalls, quota.hardStopPerAccount());
        if (!quotaDecision.allowed() || quotaDecision.callsReserved() < plannedCalls) {
            if (quotaDecision.allowed()) {
                rollbackReservedQuota(quotaDecision.reservation(), quotaDecision.callsReserved());
            }
            quotaBlockedCounter.increment();
            log.warn(
                "TomTom incident polling paused: remaining monthly quota cannot cover the incident pass (used={}, hardStop={})",
                quotaDecision.requestsUsed(),
                quota.hardStop()
            );
            return Map.of();
        }

        AtomicLong issuedCalls = new AtomicLong();
        Map<TrafficTile, List<DecodedTrafficFeature>> incidentTiles;
        try {
            incidentTiles = fetchIncidentTiles(
                plan.uniqueTiles(),
                quotaDecision.account(),
                concurrency,
                issuedCalls
            )
                .blockOptional()
                .orElse(null);
        } finally {
            rollbackReservedQuota(
                quotaDecision.reservation(),
                Math.max(0, plannedCalls - issuedCalls.get())
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

    private QuotaConfig resolveQuotaConfig() {
        TrafficPullProps.MonthlyRequestBudget budget = pullProps.monthlyRequestBudget();
        int accountCount = quotaManager.availableAccountCount();
        int targetPerAccount = Math.max(1, budget.targetRequests());
        int hardStopPerAccount = Math.max(targetPerAccount, budget.hardStopRequests());
        int allowancePerAccount = Math.max(hardStopPerAccount, budget.allowanceRequests());
        int target = safeMultiply(targetPerAccount, accountCount);
        int hardStop = safeMultiply(hardStopPerAccount, accountCount);
        int allowance = safeMultiply(allowancePerAccount, accountCount);
        return new QuotaConfig(
            target,
            target,
            hardStop,
            allowance,
            targetPerAccount,
            hardStopPerAccount,
            allowancePerAccount,
            accountCount
        );
    }

    private Map<String, CorridorGeometry> loadCorridorGeometry(List<TrafficProps.Corridor> corridors) {
        Map<String, CorridorGeometry> byCorridor = new LinkedHashMap<>();
        CorridorGeometry emptyGeometry = new CorridorGeometry(List.of());

        for (TrafficProps.Corridor corridor : corridors) {
            try {
                CorridorGeometry geometry = routeForCorridor(corridor).blockOptional().orElse(emptyGeometry);
                byCorridor.put(corridor.name(), geometry);
            } catch (Exception e) {
                log.warn("Skipping corridor {} due to geometry setup error: {}", corridor.name(), e.toString());
            }
        }
        return byCorridor;
    }

    private Map<String, ProviderCycleSnapshot> persistCorridorSamples(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        Map<String, Set<TrafficTile>> tilesByCorridor,
        Map<String, Integer> zoomByCorridor,
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles,
        double speedRouteBufferMeters,
        Instant observedAt,
        Set<TrafficTile> fineTiles
    ) {
        Map<String, ProviderCycleSnapshot> snapshotsByCorridor = new LinkedHashMap<>();
        List<CorridorFlowCellSnapshot> flowCellSnapshots = new ArrayList<>();
        CorridorGeometry emptyGeometry = new CorridorGeometry(List.of());

        for (TrafficProps.Corridor corridor : corridors) {
            Set<TrafficTile> corridorTiles = tilesByCorridor.get(corridor.name());
            if (corridorTiles == null || corridorTiles.isEmpty()) continue;

            CorridorGeometry geometry = geometryByCorridor.getOrDefault(corridor.name(), emptyGeometry);
            String collectionProfile = collectionProfile(corridor.name(), corridorTiles, fineTiles, geometry.polyline().size() >= 2);
            List<DecodedTrafficFeature> decodedCorridorFeatures = corridorTiles.stream()
                .flatMap(tile -> flowTiles.getOrDefault(tile, List.of()).stream())
                .toList();
            flowSpatialEvidenceStore.record(FlowSpatialEvidenceAnalyzer.analyze(
                corridor.name(),
                zoomByCorridor.getOrDefault(corridor.name(), pullProps.flow().tileZoom()),
                observedAt,
                decodedCorridorFeatures,
                geometry.polyline(),
                speedRouteBufferMeters
            ));
            flowCellSnapshots.add(CorridorFlowCellProjector.project(
                corridor.name(),
                observedAt,
                zoomByCorridor.getOrDefault(corridor.name(), pullProps.flow().tileZoom()),
                corridor.startMileMarker(),
                corridor.endMileMarker(),
                decodedCorridorFeatures,
                geometry.polyline(),
                corridor.directionalRoutes(),
                speedRouteBufferMeters
            ).withCollectionProfile(collectionProfile));
            CorridorSpeedProjection speedProjection = collectCorridorSpeeds(corridor, corridorTiles, flowTiles, geometry.polyline(), speedRouteBufferMeters);
            List<Double> speeds = speedProjection.speeds();
            if (speeds.isEmpty()) {
                log.warn("Skipping {} persistence because the tile cycle produced no usable speed samples", corridor.name());
                continue;
            }
            CorridorIncidentSnapshot incidents = incidentSnapshotStore.latest(corridor.name())
                .orElseGet(() -> new CorridorIncidentSnapshot(
                    corridor.name(),
                    "none",
                    "none",
                    java.time.Instant.now(),
                    null,
                    null,
                    0
                ));
            TrafficStats stats = TrafficStats.fromSpeeds(speeds);
            ZoneSampleBundle zoneSampleBundle = buildZoneSamples(corridor.name(), speedProjection.observations(), stats);
            String semanticFlowSignature = semanticFlowSignature(corridor.name(), speedProjection.candidates());

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
            sample.setIncidentCount(incidents.incidentCount());
            sample.setFlowProvider(TOMTOM_PROVIDER);
            sample.setFlowProduct(VECTOR_TILE_PRODUCT);
            sample.setFlowSourceZoom(zoomByCorridor.get(corridor.name()));
            sample.setFlowCollectionProfile(collectionProfile);
            sample.setFlowRequestedCadenceSeconds(pullProps.flow().pollSeconds());
            sample.setIncidentProvider(incidents.provider());
            sample.setIncidentProduct(incidents.product());
            sample.setIncidentFetchedAt(java.time.OffsetDateTime.ofInstant(
                incidents.fetchedAt(),
                java.time.ZoneOffset.UTC
            ));
            if (incidents.sourceUpdatedAt() != null) {
                sample.setIncidentSourceUpdatedAt(java.time.OffsetDateTime.ofInstant(
                    incidents.sourceUpdatedAt(),
                    java.time.ZoneOffset.UTC
                ));
            }
            sample.setIncidentRequestedCadenceSeconds(pullProps.incidents().pollSeconds());
            sample.setSemanticFlowSignature(semanticFlowSignature);
            sample.setLocalizedSlowdown(zoneSampleBundle.slowdownSignal().localized());
            sample.setLocalizedSlowdownNote(zoneSampleBundle.slowdownSignal().note());

            sample.setSpeedStateSignature(TrafficSampleSignature.speedOnly(sample));

            sampleWriter.saveSampleWithZones(sample, zoneSampleBundle.zoneSamples());

            snapshotsByCorridor.put(
                corridor.name(),
                new ProviderCycleSnapshot(corridor.name(), speeds, TrafficSampleSignature.from(sample))
            );
        }

        corridorFlowCellStore.recordBatch(flowCellSnapshots);
        return snapshotsByCorridor;
    }

    private record QuotaDecision(
        boolean allowed,
        long callsReserved,
        long requestsUsed,
        TomTomAccountQuotaManager.AccountReservation reservation
    ) {
        private TomTomAccount account() {
            return reservation == null ? null : reservation.account();
        }
    }
    public record QuotaSnapshot(
        long usedThisMonth,
        int target,
        int adaptiveCap,
        int hardStop,
        int allowance,
        LocalDate periodStart,
        LocalDate periodEnd,
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts
    ) {
        public QuotaSnapshot(
            long usedThisMonth,
            int target,
            int adaptiveCap,
            int hardStop,
            int allowance,
            LocalDate periodStart,
            LocalDate periodEnd
        ) {
            this(
                usedThisMonth,
                target,
                adaptiveCap,
                hardStop,
                allowance,
                periodStart,
                periodEnd,
                List.of()
            );
        }
    }

    public QuotaSnapshot quotaSnapshot() {
        QuotaConfig quota = resolveQuotaConfig();
        List<TomTomAccountQuotaManager.AccountQuotaSnapshot> accounts = quotaManager.snapshots(
            VECTOR_TILE_PRODUCT,
            quota.targetPerAccount(),
            quota.hardStopPerAccount(),
            quota.allowancePerAccount()
        );
        long used = accounts.stream()
            .mapToLong(TomTomAccountQuotaManager.AccountQuotaSnapshot::requestsUsed)
            .sum();
        LocalDate periodStart = accounts.stream()
            .map(TomTomAccountQuotaManager.AccountQuotaSnapshot::periodStart)
            .filter(java.util.Objects::nonNull)
            .findFirst()
            .orElse(null);
        LocalDate periodEnd = accounts.stream()
            .map(TomTomAccountQuotaManager.AccountQuotaSnapshot::periodEnd)
            .filter(java.util.Objects::nonNull)
            .findFirst()
            .orElse(null);
        return new QuotaSnapshot(
            used,
            quota.target(),
            quota.adaptiveCap(),
            quota.hardStop(),
            quota.allowance(),
            periodStart,
            periodEnd,
            accounts
        );
    }

    private QuotaDecision reserveQuota(long requestedCalls, int hardStopPerAccount) {
        java.util.Optional<TomTomAccountQuotaManager.AccountReservation> selected =
            quotaManager.reserveCompleteBatch(
            VECTOR_TILE_PRODUCT,
            requestedCalls,
            hardStopPerAccount
        );
        refreshQuotaGauges(resolveQuotaConfig().hardStop());
        if (selected.isEmpty()) {
            return new QuotaDecision(false, 0, requestsUsedThisMonth(), null);
        }
        TomTomAccountQuotaManager.AccountReservation reservation = selected.get();
        return new QuotaDecision(
            true,
            reservation.callsReserved(),
            reservation.requestsUsed(),
            reservation
        );
    }

    private void rollbackReservedQuota(
        TomTomAccountQuotaManager.AccountReservation reservation,
        long callsToRelease
    ) {
        if (reservation == null || callsToRelease <= 0) return;
        quotaManager.release(reservation, callsToRelease);
        refreshQuotaGauges(resolveQuotaConfig().hardStop());
    }

    private long requestsUsedThisMonth() {
        QuotaConfig quota = resolveQuotaConfig();
        return quotaManager.snapshots(
            VECTOR_TILE_PRODUCT,
            quota.targetPerAccount(),
            quota.hardStopPerAccount(),
            quota.allowancePerAccount()
        ).stream()
            .mapToLong(TomTomAccountQuotaManager.AccountQuotaSnapshot::requestsUsed)
            .sum();
    }

    private void refreshQuotaGauges(int hardStopMonthlyRequests) {
        quotaUsedGauge.set(requestsUsedThisMonth());
        quotaHardStopGauge.set(hardStopMonthlyRequests);
    }

    private static int safeMultiply(int value, int multiplier) {
        return (int) Math.min(Integer.MAX_VALUE, Math.max(0L, (long) value * multiplier));
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
        long used = requestsUsedThisMonth();

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

    private CorridorSpeedProjection collectCorridorSpeeds(
        TrafficProps.Corridor corridor,
        Set<TrafficTile> corridorTiles,
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles,
        List<double[]> route,
        double routeBufferMeters
    ) {
        List<FlowCandidate> candidates = buildFlowCandidates(corridorTiles, flowTiles, route, routeBufferMeters);
        if (candidates.isEmpty()) return new CorridorSpeedProjection(List.of(), List.of());

        List<RouteSamplePoint> routeSamples = sampleRoutePoints(
            route,
            DEFAULT_SPEED_SAMPLE_SPACING_METERS,
            corridor.startMileMarker(),
            corridor.endMileMarker()
        );
        if (routeSamples.isEmpty()) {
            // Fallback: route unavailable; preserve one speed per unique flow feature.
            List<CorridorSpeedObservation> fallback = new ArrayList<>(candidates.size());
            for (FlowCandidate candidate : candidates) {
                fallback.add(new CorridorSpeedObservation(null, candidate.speedMph()));
            }
            return new CorridorSpeedProjection(List.copyOf(candidates), fallback);
        }

        List<CorridorSpeedObservation> observations = new ArrayList<>(routeSamples.size());
        for (RouteSamplePoint sample : routeSamples) {
            Double speed = projectedSpeedForSample(corridor.name(), sample.lat(), sample.lon(), candidates, routeBufferMeters);
            observations.add(new CorridorSpeedObservation(sample.mileMarker(), speed));
        }
        return new CorridorSpeedProjection(List.copyOf(candidates), observations);
    }

    private List<FlowCandidate> buildFlowCandidates(
        Set<TrafficTile> corridorTiles,
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles,
        List<double[]> route,
        double routeBufferMeters
    ) {
        List<FlowCandidate> candidates = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        for (TrafficTile key : corridorTiles) {
            for (DecodedTrafficFeature feature : flowTiles.getOrDefault(key, List.of())) {
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

    private static Double projectedSpeedForSample(
        String corridorName,
        double lat,
        double lon,
        List<FlowCandidate> candidates,
        double maxDistanceMeters
    ) {
        List<CandidateDistance> nearest = nearestCandidatesForSample(lat, lon, candidates, maxDistanceMeters);
        if (nearest.isEmpty()) return null;
        if (!usesBlendedProjection(corridorName)) return nearest.get(0).candidate().speedMph();

        List<CandidateDistance> blendable = new ArrayList<>(DEFAULT_SPEED_BLEND_MAX_CANDIDATES);
        for (CandidateDistance candidateDistance : nearest) {
            if (candidateDistance.distanceMeters() > DEFAULT_SPEED_BLEND_RADIUS_METERS) break;
            blendable.add(candidateDistance);
            if (blendable.size() >= DEFAULT_SPEED_BLEND_MAX_CANDIDATES) break;
        }
        if (blendable.size() < 2) return nearest.get(0).candidate().speedMph();
        return inverseDistanceWeightedSpeed(blendable);
    }

    private static List<CandidateDistance> nearestCandidatesForSample(
        double lat,
        double lon,
        List<FlowCandidate> candidates,
        double maxDistanceMeters
    ) {
        List<CandidateDistance> matches = new ArrayList<>();
        for (FlowCandidate candidate : candidates) {
            double distance = minDistanceMetersToFeature(lat, lon, candidate.paths());
            if (distance <= maxDistanceMeters) {
                matches.add(new CandidateDistance(candidate, distance));
            }
        }
        matches.sort((left, right) -> Double.compare(left.distanceMeters(), right.distanceMeters()));
        return matches;
    }

    private static Double inverseDistanceWeightedSpeed(List<CandidateDistance> candidates) {
        double weightedSpeed = 0.0;
        double totalWeight = 0.0;
        for (CandidateDistance candidateDistance : candidates) {
            double weight = 1.0 / Math.max(1.0, candidateDistance.distanceMeters());
            weightedSpeed += candidateDistance.candidate().speedMph() * weight;
            totalWeight += weight;
        }
        if (totalWeight <= 0.0) return null;
        return weightedSpeed / totalWeight;
    }

    private static boolean usesBlendedProjection(String corridorName) {
        return corridorName != null && CORRIDOR_I25.equalsIgnoreCase(corridorName.trim());
    }

    private static record CandidateDistance(FlowCandidate candidate, double distanceMeters) {}

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

    private Mono<CorridorGeometry> routeForCorridor(TrafficProps.Corridor corridor) {
        CorridorGeometry cached = routeCache.get(corridor.name());
        if (cached != null) return Mono.just(cached);

        List<double[]> configuredPolyline = CorridorGeometrySupport.pointsFromGeoJson(corridor.geometryJson());
        if (!configuredPolyline.isEmpty()) {
            CorridorGeometry geom = new CorridorGeometry(configuredPolyline);
            routeCache.put(corridor.name(), geom);
            return Mono.just(geom);
        }

        double[] bb = normalizeBbox(corridor.bbox());
        double minLat = bb[0], minLon = bb[1], maxLat = bb[2], maxLon = bb[3];

        double startLat = maxLat, startLon = minLon;
        double endLat = minLat, endLon = maxLon;

        String routePath = "/routing/1/calculateRoute/"
            + String.format(Locale.ROOT, "%.6f,%.6f:%.6f,%.6f", startLat, startLon, endLat, endLon)
            + "/json";

        return requestGovernor.routing(account ->
            http.get()
                .uri(u -> u.path(routePath)
                    .queryParam("traffic", "true")
                    .queryParam("avoid", "unpavedRoads")
                    .queryParam("key", account.apiKey())
                    .build())
                .retrieve()
                .bodyToMono(JsonNode.class)
            )
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
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.tripAuthorizationFailure(
                        "routing/1/calculateRoute",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString()
                    );
                } else {
                    providerGuardService.recordRecoverableProviderFailure(
                        "routing/1/calculateRoute",
                        e
                    );
                }
                log.debug("Routing polyline failed for {}: {}", corridor.name(), e.toString());
                return Mono.just(new CorridorGeometry(List.of()));
            });
    }

    private static String collectionProfile(String corridor, Set<TrafficTile> tiles, Set<TrafficTile> fineTiles, boolean hasGeometry) {
        String sources = tiles.stream().map(tile -> tile.z() + "/" + tile.x() + "/" + tile.y()
            + "=" + (fineTiles.contains(tile) ? "1kph" : "default")).sorted()
            .collect(java.util.stream.Collectors.joining(","));
        String matcher = !hasGeometry ? "feature-fallback" : usesBlendedProjection(corridor) ? "blend3" : "nearest";
        return "v1;matcher=" + matcher + ";tiles=" + sources;
    }

    private Mono<Map<TrafficTile, List<DecodedTrafficFeature>>> fetchFlowTiles(
        Set<TrafficTile> tiles,
        TomTomAccount account,
        int concurrency,
        AtomicLong issuedCalls,
        Set<TrafficTile> fineTiles
    ) {
        return Flux.fromIterable(tiles)
            .flatMap(tile -> flowTileCall(tile, account, issuedCalls, fineTiles.contains(tile))
                .map(bytes -> Map.entry(tile, TrafficTileDecoder.decode(bytes, tile).stream().filter(this::isFlowLayer).toList())), concurrency)
            .collectMap(Map.Entry::getKey, Map.Entry::getValue);
    }

    private Mono<Map<TrafficTile, List<DecodedTrafficFeature>>> fetchIncidentTiles(
        Set<TrafficTile> tiles,
        TomTomAccount account,
        int concurrency,
        AtomicLong issuedCalls
    ) {
        return Flux.fromIterable(tiles)
            .flatMap(tile -> incidentTileCall(tile, account, issuedCalls)
                .map(bytes -> Map.entry(tile, TrafficTileDecoder.decode(bytes, tile).stream().filter(this::isIncidentLayer).toList())), concurrency)
            .collectMap(Map.Entry::getKey, Map.Entry::getValue);
    }

    private Mono<byte[]> flowTileCall(
        TrafficTile tile,
        TomTomAccount account,
        AtomicLong issuedCalls,
        boolean finePrecision
    ) {
        return retryReservedVectorTile(account, () -> {
            issuedCalls.incrementAndGet();
            return http.get()
                .uri(u -> u.path("/traffic/map/4/tile/flow/absolute/" + tile.z() + "/" + tile.x() + "/" + tile.y() + ".pbf")
                    .queryParam("roadTypes", "[0,1,2]")
                    .queryParam("margin", "0")
                    .queryParamIfPresent("trafficLevelStep", finePrecision ? java.util.Optional.of(1) : java.util.Optional.empty())
                    .queryParam("key", account.apiKey())
                    .build())
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .header("Tracking-ID", java.util.UUID.randomUUID().toString())
                .retrieve()
                .bodyToMono(byte[].class)
                .timeout(Duration.ofSeconds(8));
        })
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w) {
                    recordAccountFailure(account, w, "traffic/map/4/tile/flow");
                } else {
                    providerGuardService.recordRecoverableProviderFailure(
                        "traffic/map/4/tile/flow",
                        e
                    );
                }
                return Mono.error(e);
            });
    }

    private Mono<byte[]> incidentTileCall(
        TrafficTile tile,
        TomTomAccount account,
        AtomicLong issuedCalls
    ) {
        return retryReservedVectorTile(account, () -> {
            issuedCalls.incrementAndGet();
            return http.get()
                .uri(u -> u.path("/traffic/map/4/tile/incidents/" + tile.z() + "/" + tile.x() + "/" + tile.y() + ".pbf")
                    .queryParam("tags", "[icon_category,description,delay,road_type,id]")
                    .queryParam("key", account.apiKey())
                    .build())
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .header("Tracking-ID", java.util.UUID.randomUUID().toString())
                .retrieve()
                .bodyToMono(byte[].class)
                .timeout(Duration.ofSeconds(8));
        })
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w) {
                    recordAccountFailure(account, w, "traffic/map/4/tile/incidents");
                } else {
                    providerGuardService.recordRecoverableProviderFailure(
                        "traffic/map/4/tile/incidents",
                        e
                    );
                }
                return Mono.error(e);
            });
    }

    private <T> Mono<T> retryReservedVectorTile(
        TomTomAccount account,
        Supplier<Mono<T>> request
    ) {
        int hardStop = resolveQuotaConfig().hardStopPerAccount();
        return Mono.defer(request)
            .retryWhen(
                Retry.backoff(1, Duration.ofMillis(250))
                    .filter(TransientProviderFailure::isRetryable)
                    .doBeforeRetry(signal -> {
                        if (
                            quotaManager.reserveForAccount(
                                account,
                                VECTOR_TILE_PRODUCT,
                                1,
                                hardStop
                            ).isEmpty()
                        ) {
                            throw new TomTomRequestQuotaExceededException(
                                VECTOR_TILE_PRODUCT,
                                requestsUsedThisMonth(),
                                hardStop
                            );
                        }
                        refreshQuotaGauges(resolveQuotaConfig().hardStop());
                        log.warn(
                            "Retrying a TomTom vector tile with account {} after a transient failure: {}",
                            account.id(),
                            signal.failure().toString()
                        );
                    })
            );
    }

    private void recordAccountFailure(
        TomTomAccount account,
        WebClientResponseException response,
        String endpoint
    ) {
        if (providerGuardService.isInsufficientFunds(response)) {
            quotaManager.markCreditsExhausted(account.id());
            providerGuardService.recordRecoverableProviderFailure(endpoint, response);
            return;
        }
        if (providerGuardService.isAuthorizationFailure(response)) {
            quotaManager.markAuthorizationFailed(account.id());
            if (quotaManager.hasAvailableAccount()) {
                log.warn(
                    "TomTom account {} was quarantined after an authorization failure; another account remains available",
                    account.id()
                );
            } else {
                providerGuardService.tripAuthorizationFailure(
                    endpoint,
                    response.getStatusCode().value(),
                    response.getResponseBodyAsString()
                );
            }
            return;
        }
        providerGuardService.recordRecoverableProviderFailure(endpoint, response);
    }

    private static List<RouteSamplePoint> sampleRoutePoints(
        List<double[]> polyline,
        double spacingMeters,
        Double startMileMarker,
        Double endMileMarker
    ) {
        if (polyline == null || polyline.size() < 2) return List.of();

        double[] cumulative = cumulativeDistances(polyline);
        double totalMeters = cumulative[cumulative.length - 1];
        if (totalMeters <= 0) return List.of();

        int sampleCount = Math.max(1, (int) Math.floor(totalMeters / Math.max(1.0, spacingMeters)));
        List<RouteSamplePoint> out = new ArrayList<>(sampleCount);
        double step = totalMeters / sampleCount;
        for (int i = 0; i < sampleCount; i++) {
            double target = (i + 0.5) * step;
            double[] point = pointAtDistance(polyline, cumulative, target);
            Double mileMarker = interpolateMileMarker(startMileMarker, endMileMarker, totalMeters <= 0.0 ? 0.0 : target / totalMeters);
            out.add(new RouteSamplePoint(point[0], point[1], mileMarker));
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

    private static Double interpolateMileMarker(Double startMileMarker, Double endMileMarker, double fraction) {
        if (startMileMarker == null || endMileMarker == null) return null;
        double clamped = Math.max(0.0, Math.min(1.0, fraction));
        return startMileMarker + ((endMileMarker - startMileMarker) * clamped);
    }

    private boolean isFlowLayer(DecodedTrafficFeature feature) {
        String layerName = feature.layerName() == null ? "" : feature.layerName().toLowerCase(Locale.ROOT);
        return layerName.contains("traffic flow");
    }

    private boolean isIncidentLayer(DecodedTrafficFeature feature) {
        String layerName = feature.layerName() == null ? "" : feature.layerName().toLowerCase(Locale.ROOT);
        return layerName.contains("incident");
    }

    private static boolean featureWithinBuffer(DecodedTrafficFeature feature, List<double[]> polyline, double bufferMeters) {
        if (polyline == null || polyline.size() < 2) return true;
        for (List<double[]> path : feature.paths()) {
            for (double[] point : path) {
                if (minDistanceMetersToPolyline(point[0], point[1], polyline) <= bufferMeters) return true;
            }
        }
        return false;
    }

    private static String flowFeatureKey(DecodedTrafficFeature feature, Double speedKph) {
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

    private static List<double[]> firstPath(List<List<double[]>> paths) {
        for (List<double[]> path : paths) {
            if (path != null && !path.isEmpty()) return path;
        }
        return List.of();
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

    private static Double min(List<Double> values) {
        if (values.isEmpty()) return null;
        double minimum = Double.POSITIVE_INFINITY;
        for (double v : values) if (v < minimum) minimum = v;
        return minimum;
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

    private ZoneSampleBundle buildZoneSamples(
        String corridorName,
        List<CorridorSpeedObservation> observations,
        TrafficStats corridorStats
    ) {
        List<SpeedZoneDefinition> zones = CorridorSpeedZones.forCorridor(corridorName);
        if (zones.isEmpty() || observations == null || observations.isEmpty()) return ZoneSampleBundle.empty();

        Map<String, List<Double>> speedsByZone = new LinkedHashMap<>();
        for (SpeedZoneDefinition zone : zones) {
            speedsByZone.put(zone.zoneKey(), new ArrayList<>());
        }

        for (CorridorSpeedObservation observation : observations) {
            if (observation.speedMph() == null) continue;
            SpeedZoneDefinition zone = CorridorSpeedZones.locate(corridorName, observation.mileMarker());
            if (zone == null) continue;
            speedsByZone.get(zone.zoneKey()).add(observation.speedMph());
        }

        List<TrafficSpeedZoneSample> zoneSamples = new ArrayList<>(zones.size());
        TrafficSpeedZoneSample slowestZoneSample = null;
        double worstCorridorGap = Double.NEGATIVE_INFINITY;

        for (SpeedZoneDefinition zone : zones) {
            List<Double> zoneSpeeds = speedsByZone.getOrDefault(zone.zoneKey(), List.of());
            TrafficStats zoneStats = TrafficStats.fromSpeeds(zoneSpeeds);

            TrafficSpeedZoneSample zoneSample = new TrafficSpeedZoneSample();
            zoneSample.setZoneKey(zone.zoneKey());
            zoneSample.setZoneOrder(zone.zoneOrder());
            zoneSample.setZoneLabel(zone.label());
            zoneSample.setZoneDescription(zone.description());
            zoneSample.setStartMileMarker(zone.startMileMarker());
            zoneSample.setEndMileMarker(zone.endMileMarker());
            zoneSample.setPostedSpeedMph(zone.postedSpeedMph());
            zoneSample.setAvgCurrentSpeed(zoneStats.avgSpeed());
            zoneSample.setMinCurrentSpeed(zoneStats.minSpeed());
            zoneSample.setSpeedStddev(zoneStats.stddev());
            zoneSample.setP10Speed(zoneStats.p10Speed());
            zoneSample.setP50Speed(zoneStats.p50Speed());
            zoneSample.setP90Speed(zoneStats.p90Speed());
            zoneSample.setSpeedSampleCount(zoneStats.sampleCount());
            zoneSample.setSpeedStateSignature(TrafficSampleSignature.fromZone(
                corridorName,
                zone.zoneKey(),
                zoneStats.avgSpeed(),
                zoneStats.minSpeed(),
                zoneStats.sampleCount(),
                zoneStats.stddev(),
                zoneStats.p10Speed(),
                zoneStats.p50Speed(),
                zoneStats.p90Speed()
            ));
            zoneSamples.add(zoneSample);

            if (zoneStats.avgSpeed() == null || corridorStats.avgSpeed() == null) continue;
            double corridorGap = corridorStats.avgSpeed() - zoneStats.avgSpeed();
            if (corridorGap > worstCorridorGap) {
                worstCorridorGap = corridorGap;
                slowestZoneSample = zoneSample;
            }
        }

        return new ZoneSampleBundle(zoneSamples, localizedSlowdownSignal(corridorStats, slowestZoneSample));
    }

    private static ZoneSlowdownSignal localizedSlowdownSignal(TrafficStats corridorStats, TrafficSpeedZoneSample slowestZoneSample) {
        if (corridorStats == null || corridorStats.avgSpeed() == null || slowestZoneSample == null || slowestZoneSample.getAvgCurrentSpeed() == null) {
            return ZoneSlowdownSignal.none();
        }
        if (slowestZoneSample.getSpeedSampleCount() == null || slowestZoneSample.getSpeedSampleCount() < 4) {
            return ZoneSlowdownSignal.none();
        }

        double corridorGap = corridorStats.avgSpeed() - slowestZoneSample.getAvgCurrentSpeed();
        double postedGap = slowestZoneSample.getPostedSpeedMph() == null
            ? 0.0
            : slowestZoneSample.getPostedSpeedMph() - slowestZoneSample.getAvgCurrentSpeed();
        double p10Gap = corridorStats.p10Speed() == null || corridorStats.avgSpeed() == null
            ? 0.0
            : corridorStats.avgSpeed() - corridorStats.p10Speed();

        if (corridorGap < 6.0 || postedGap < 4.0 || p10Gap < 4.0) {
            return ZoneSlowdownSignal.none();
        }

        String note = String.format(
            Locale.US,
            "Localized slowdown in %s averaging %.1f mph versus %.1f mph corridor average.",
            slowestZoneSample.getZoneLabel(),
            slowestZoneSample.getAvgCurrentSpeed(),
            corridorStats.avgSpeed()
        );
        return new ZoneSlowdownSignal(true, note);
    }

    private static String semanticFlowSignature(String corridorName, List<FlowCandidate> candidates) {
        if (candidates == null || candidates.isEmpty()) {
            return TrafficSampleSignature.sha256((corridorName == null ? "" : corridorName.trim()) + "|none");
        }
        List<String> components = new ArrayList<>(candidates.size());
        for (FlowCandidate candidate : candidates) {
            List<double[]> path = firstPath(candidate.paths());
            if (path.isEmpty()) continue;
            double[] start = path.get(0);
            double[] end = path.get(path.size() - 1);
            components.add(String.format(
                Locale.US,
                "%.3f|%.5f,%.5f|%.5f,%.5f",
                candidate.speedMph(),
                start[0],
                start[1],
                end[0],
                end[1]
            ));
        }
        components.sort(String::compareTo);
        return TrafficSampleSignature.sha256(String.join("|", normalizeCorridorName(corridorName), String.join(";", components)));
    }

    private static String normalizeCorridorName(String corridor) {
        return corridor == null ? "" : corridor.trim().toUpperCase(Locale.ROOT);
    }
}
