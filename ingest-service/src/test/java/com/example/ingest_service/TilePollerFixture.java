package com.example.ingest_service;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.web.reactive.function.client.WebClient;

final class TilePollerFixture {
    private TilePollerFixture() {}

    static TileTrafficPoller create(WebClient http, TrafficProps props, TrafficPullProps pullProps,
        TrafficSampleWriter writer, CorridorGeometryStore geometryStore, TrafficProviderGuardService guard,
        TomTomAccountQuotaManager quotaManager, TomTomRequestGovernor governor, IncidentSnapshotStore incidents,
        FlowSpatialEvidenceStore evidence, CorridorFlowCellStore cells, MeterRegistry registry) {
        return new TileTrafficPoller(props, pullProps, guard,
            new TomTomTileAccess(http, props, pullProps, geometryStore, guard, quotaManager, governor, registry),
            new TileFlowSamplePublisher(pullProps, writer, incidents, evidence, cells));
    }
}
