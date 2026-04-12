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
        sample.setAvgCurrentSpeed(48.5);
        sample.setAvgFreeflowSpeed(61.0);
        sample.setMinCurrentSpeed(32.0);
        sample.setConfidence(0.87);
        sample.setIncidentsJson("{\"incidents\":[]}");
        sample.setPolledAt(polledAt);

        TrafficSampleDto dto = TrafficSampleMapper.toDto(sample);

        assertThat(dto.id()).isEqualTo(99L);
        assertThat(dto.sampleRefId()).isEqualTo(99L);
        assertThat(dto.corridor()).isEqualTo("I25");
        assertThat(dto.avgCurrentSpeed()).isEqualTo(48.5);
        assertThat(dto.avgFreeflowSpeed()).isEqualTo(61.0);
        assertThat(dto.minCurrentSpeed()).isEqualTo(32.0);
        assertThat(dto.confidence()).isEqualTo(0.87);
        assertThat(dto.incidentsJson()).isEqualTo("{\"incidents\":[]}");
        assertThat(dto.polledAt()).isEqualTo(polledAt);
        assertThat(dto.archived()).isFalse();
        assertThat(dto.archivedAt()).isNull();
    }
}
