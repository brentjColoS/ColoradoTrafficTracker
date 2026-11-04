package com.example.ingest_service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class TileTrafficPoller {

    private static final Logger log = LoggerFactory.getLogger(TileTrafficPoller.class);

    private final TrafficProps props;
    private final TrafficPullProps pullProps;
    private final TrafficProviderGuardService providerGuardService;
    private final TomTomTileAccess access;
    private final TileFlowSamplePublisher samplePublisher;

    public TileTrafficPoller(TrafficProps props, TrafficPullProps pullProps,
        TrafficProviderGuardService providerGuardService, TomTomTileAccess access,
        TileFlowSamplePublisher samplePublisher) {
        this.props = props;
        this.pullProps = pullProps;
        this.providerGuardService = providerGuardService;
        this.access = access;
        this.samplePublisher = samplePublisher;
    }

    public Map<String, ProviderCycleSnapshot> pollFlowAndPersist(List<TrafficProps.Corridor> corridors) {
        if (corridors == null || corridors.isEmpty()) return Map.of();

        if (!access.hasAccount()) {
            log.warn("No enabled TomTom account is available; skipping tile-mode flow poll");
            return Map.of();
        }

        TrafficPullProps.Flow flow = pullProps.flow();
        int requestedZoom = flow.tileZoom();
        Map<String, Integer> requestedZoomByCorridor = access.coveragePlanner.requestedZoomByCorridor(
            corridors,
            requestedZoom,
            flow.tileCorridorZoomOverrides()
        );
        int concurrency = Math.max(1, props.tileConcurrency());
        TileQuotaUsage.Config quota = access.quotaUsage.config();

        Map<String, CorridorGeometry> geometryByCorridor = access.loadGeometry(corridors);
        TileCoveragePlan coveragePlan = access.coveragePlanner.resolve(
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
        TileQuotaUsage.Decision quotaDecision = access.quotaUsage.reserve(plannedCalls, quota.hardStopPerAccount());
        if (!quotaDecision.allowed()) {
            access.quotaUsage.recordBlocked();
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
        Set<TrafficTile> fineTiles = access.coveragePlanner.fineFlowTiles(reservedPlan, geometryByCorridor, flow.precision());
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles;
        try {
            flowTiles = access.tileClient.fetchFlowTiles(
                reservedPlan.uniqueTiles(),
                quotaDecision.account(),
                concurrency,
                issuedInitialCalls,
                fineTiles
            )
                .blockOptional()
                .orElse(null);
        } finally {
            access.quotaUsage.release(
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

    public TileQuotaSnapshot quotaSnapshot() {
        return access.quotaUsage.snapshot();
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
        long used = access.quotaUsage.used();

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

}
