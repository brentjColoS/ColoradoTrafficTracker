package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficSampleMapper;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class TrafficSampleMapperTest {

    @Test
    void toDtoMapsAllFields() {
        OffsetDateTime polledAt = OffsetDateTime.of(2026, 4, 3, 16, 15, 0, 0, ZoneOffset.UTC);
        TrafficSample sample = new TrafficSample();
        sample.setId(99L);
        sample.setCorridor("I25");
        sample.setSourceMode("tile");
        sample.setAvgCurrentSpeed(48.5);
        sample.setAvgFreeflowSpeed(61.0);
        sample.setMinCurrentSpeed(32.0);
        sample.setConfidence(0.87);
        sample.setIncidentsJson("{\"incidents\":[]}");
        sample.setFlowProvider("tomtom");
        sample.setFlowProduct("traffic-flow-incidents-vector-tiles");
        sample.setFlowSourceZoom(10);
        sample.setFlowRequestedCadenceSeconds(125);
        sample.setIncidentProvider("cdot");
        sample.setIncidentProduct("incidents-and-planned-events");
        sample.setIncidentFetchedAt(polledAt.minusMinutes(1));
        sample.setIncidentSourceUpdatedAt(polledAt.minusMinutes(3));
        sample.setIncidentRequestedCadenceSeconds(900);
        sample.setPolledAt(polledAt);

        TrafficSampleDto dto = TrafficSampleMapper.toDto(sample);

        assertThat(dto.id()).isEqualTo(99L);
        assertThat(dto.sampleRefId()).isEqualTo(99L);
        assertThat(dto.corridor()).isEqualTo("I25");
        assertThat(dto.sourceMode()).isEqualTo("tile");
        assertThat(dto.avgCurrentSpeed()).isEqualTo(48.5);
        assertThat(dto.avgFreeflowSpeed()).isEqualTo(61.0);
        assertThat(dto.minCurrentSpeed()).isEqualTo(32.0);
        assertThat(dto.confidence()).isEqualTo(0.87);
        assertThat(dto.flowProvider()).isEqualTo("tomtom");
        assertThat(dto.flowProduct()).isEqualTo("traffic-flow-incidents-vector-tiles");
        assertThat(dto.flowSourceZoom()).isEqualTo(10);
        assertThat(dto.flowRequestedCadenceSeconds()).isEqualTo(125);
        assertThat(dto.incidentProvider()).isEqualTo("cdot");
        assertThat(dto.incidentProduct()).isEqualTo("incidents-and-planned-events");
        assertThat(dto.incidentFetchedAt()).isEqualTo(polledAt.minusMinutes(1));
        assertThat(dto.incidentSourceUpdatedAt()).isEqualTo(polledAt.minusMinutes(3));
        assertThat(dto.incidentRequestedCadenceSeconds()).isEqualTo(900);
        assertThat(dto.incidentsJson()).isEqualTo("{\"incidents\":[]}");
        assertThat(dto.polledAt()).isEqualTo(polledAt);
        assertThat(dto.archived()).isFalse();
        assertThat(dto.archivedAt()).isNull();
    }
}
