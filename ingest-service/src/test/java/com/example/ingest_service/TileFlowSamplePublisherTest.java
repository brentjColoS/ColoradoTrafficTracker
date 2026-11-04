package com.example.ingest_service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class TileFlowSamplePublisherTest {
    private final TrafficSampleWriter writer = mock(TrafficSampleWriter.class);
    private final FlowSpatialEvidenceStore evidence = mock(FlowSpatialEvidenceStore.class);
    private final CorridorFlowCellStore cells = mock(CorridorFlowCellStore.class);
    private final IncidentSnapshotStore incidents = new IncidentSnapshotStore();
    private final TileFlowSamplePublisher publisher = new TileFlowSamplePublisher(
        new TrafficPullProps(null, null, null), writer, incidents, evidence, cells);
    private final TrafficTile tile = new TrafficTile(10, 1, 1);
    private final TileCoveragePlan coverage = new TileCoveragePlan(Map.of("I70", 10),
        Map.of("I70", Set.of(tile)), Set.of(tile));
    private final Instant observedAt = Instant.parse("2026-11-01T12:00:00Z");

    @Test
    void sourceAndIncidentMetadataAreAssembledBeforeAtomicSampleAndZonePublication() {
        Instant fetched = observedAt.minusSeconds(20);
        Instant updated = fetched.minusSeconds(10);
        incidents.replace(Map.of("I70", new CorridorIncidentSnapshot("I70", "cdot", "incidents",
            fetched, updated, null, 2)));

        var result = publish();

        var sample = ArgumentCaptor.forClass(TrafficSample.class);
        var order = inOrder(evidence, writer, cells);
        order.verify(evidence).record(any());
        order.verify(writer).saveSampleWithZones(sample.capture(), anyList());
        order.verify(cells).recordBatch(argThat(batch -> batch.size() == 1
            && batch.iterator().next().observedAt().equals(observedAt)));
        assertThat(sample.getValue().getIncidentProvider()).isEqualTo("cdot");
        assertThat(sample.getValue().getIncidentCount()).isEqualTo(2);
        assertThat(sample.getValue().getIncidentFetchedAt()).isEqualTo(OffsetDateTime.ofInstant(fetched, ZoneOffset.UTC));
        assertThat(sample.getValue().getIncidentSourceUpdatedAt()).isEqualTo(OffsetDateTime.ofInstant(updated, ZoneOffset.UTC));
        assertThat(sample.getValue().getFlowCollectionProfile()).isEqualTo("v1;matcher=nearest;tiles=10/1/1=default");
        assertThat(sample.getValue().getFlowRequestedCadenceSeconds()).isEqualTo(60);
        assertThat(sample.getValue().getIncidentRequestedCadenceSeconds()).isEqualTo(900);
        assertThat(result.get("I70").payloadSignature()).isEqualTo(TrafficSampleSignature.from(sample.getValue()));
        assertThat(sample.getValue().getSpeedStateSignature()).isEqualTo(TrafficSampleSignature.speedOnly(sample.getValue()));
    }

    @Test
    void failedSampleTransactionDoesNotPublishThePendingMapBatch() {
        doThrow(new IllegalStateException("disposable write failure")).when(writer).saveSampleWithZones(any(), anyList());

        assertThatThrownBy(this::publish).hasMessage("disposable write failure");

        verify(evidence).record(any());
        verifyNoInteractions(cells);
    }

    private Map<String, ProviderCycleSnapshot> publish() {
        var corridor = new TrafficProps.Corridor("I70", "I70", "I-70", "E", "W", 260.0, 261.0,
            List.of(), "39.70,-105,39.72,-105", null, null, 550.0);
        var route = List.of(new double[]{39.70, -105}, new double[]{39.72, -105});
        var feature = new DecodedTrafficFeature("Traffic flow", List.of(route),
            Map.of("road_type", "motorway", "traffic_level", 100));
        return publisher.publish(List.of(corridor), Map.of("I70", new CorridorGeometry(route)),
            coverage, Map.of(tile, List.of(feature)), observedAt, Set.of());
    }
}
