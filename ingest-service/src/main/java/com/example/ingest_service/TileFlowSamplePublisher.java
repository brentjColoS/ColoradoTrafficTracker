package com.example.ingest_service;

import static com.example.ingest_service.TileFlowProjector.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@org.springframework.stereotype.Component
final class TileFlowSamplePublisher {
    private static final Logger log = LoggerFactory.getLogger(TileFlowSamplePublisher.class);
    private static final String TOMTOM_PROVIDER = "tomtom";
    private static final String VECTOR_TILE_PRODUCT = TomTomRequestGovernor.VECTOR_TILE_PRODUCT;
    private final TrafficPullProps pullProps;
    private final TrafficSampleWriter sampleWriter;
    private final IncidentSnapshotStore incidentSnapshotStore;
    private final FlowSpatialEvidenceStore flowSpatialEvidenceStore;
    private final CorridorFlowCellStore corridorFlowCellStore;

    TileFlowSamplePublisher(TrafficPullProps pullProps, TrafficSampleWriter sampleWriter,
        IncidentSnapshotStore incidentSnapshotStore, FlowSpatialEvidenceStore flowSpatialEvidenceStore,
        CorridorFlowCellStore corridorFlowCellStore) {
        this.pullProps = pullProps;
        this.sampleWriter = sampleWriter;
        this.incidentSnapshotStore = incidentSnapshotStore;
        this.flowSpatialEvidenceStore = flowSpatialEvidenceStore;
        this.corridorFlowCellStore = corridorFlowCellStore;
    }

    Map<String, ProviderCycleSnapshot> publish(
        List<TrafficProps.Corridor> corridors,
        Map<String, CorridorGeometry> geometryByCorridor,
        TileCoveragePlan coverage,
        Map<TrafficTile, List<DecodedTrafficFeature>> flowTiles,
        Instant observedAt,
        Set<TrafficTile> fineTiles
    ) {
        Map<String, Set<TrafficTile>> tilesByCorridor = coverage.tilesByCorridor();
        Map<String, Integer> zoomByCorridor = coverage.zoomByCorridor();
        double speedRouteBufferMeters = 150.0;
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

            TrafficSample sample = assembleSample(corridor.name(), zoomByCorridor.get(corridor.name()),
                collectionProfile, stats, incidents, semanticFlowSignature, zoneSampleBundle);

            sampleWriter.saveSampleWithZones(sample, zoneSampleBundle.zoneSamples());

            snapshotsByCorridor.put(
                corridor.name(),
                new ProviderCycleSnapshot(corridor.name(), speeds, TrafficSampleSignature.from(sample))
            );
        }

        corridorFlowCellStore.recordBatch(flowCellSnapshots);
        return snapshotsByCorridor;
    }

    private TrafficSample assembleSample(String corridorName, Integer sourceZoom, String collectionProfile,
        TrafficStats stats, CorridorIncidentSnapshot incidents, String semanticFlowSignature, ZoneSampleBundle zoneSampleBundle) {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(corridorName);
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
        sample.setFlowSourceZoom(sourceZoom);
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

        return sample;
    }
}
