package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.stream.StreamSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TrafficSampleWriterTest {

    @Mock
    private TrafficSampleRepository sampleRepo;

    @Mock
    private TrafficSpeedZoneSampleRepository zoneSampleRepo;

    private TrafficSampleWriter writer;
    private SimpleMeterRegistry meterRegistry;

    @BeforeEach
    void setUp() {
        meterRegistry = new SimpleMeterRegistry();
        writer = new TrafficSampleWriter(sampleRepo, zoneSampleRepo, meterRegistry);
    }

    @Test
    void savesTheTrafficSampleWithoutExpandingIncidentPayloads() {
        TrafficSample sample = new TrafficSample();
        sample.setId(42L);
        sample.setCorridor("I25");
        sample.setIncidentCount(3);
        sample.setIncidentsJson("{\"incidents\":[{\"id\":\"legacy\"}]}");
        when(sampleRepo.save(any(TrafficSample.class))).thenReturn(sample);

        TrafficSample saved = writer.saveSample(sample);

        assertThat(saved).isSameAs(sample);
        assertThat(saved.getIncidentsJson()).isNull();
        verify(sampleRepo).save(sample);
        assertThat(meterRegistry.get("traffic.ingest.samples.persisted.total").counter().count())
            .isEqualTo(1.0);
    }

    @Test
    void attachesZoneRowsToTheSavedSample() {
        TrafficSample sample = new TrafficSample();
        sample.setId(43L);
        sample.setCorridor("I70");
        sample.setPolledAt(OffsetDateTime.parse("2026-08-24T12:00:00Z"));
        when(sampleRepo.save(any(TrafficSample.class))).thenReturn(sample);

        TrafficSpeedZoneSample zone = new TrafficSpeedZoneSample();
        writer.saveSampleWithZones(sample, List.of(zone));

        verify(zoneSampleRepo).saveAll(argThat(rows -> {
            List<TrafficSpeedZoneSample> savedRows = StreamSupport
                .stream(rows.spliterator(), false)
                .toList();
            return savedRows.size() == 1
                && savedRows.get(0).getSample() == sample
                && "I70".equals(savedRows.get(0).getCorridor())
                && sample.getPolledAt().equals(savedRows.get(0).getPolledAt());
        }));
    }
}
