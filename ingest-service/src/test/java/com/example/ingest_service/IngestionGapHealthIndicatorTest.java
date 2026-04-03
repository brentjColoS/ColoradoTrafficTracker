package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class IngestionGapHealthIndicatorTest {

    @Mock
    private TrafficSampleRepository sampleRepository;

    @Test
    void healthIsOutOfServiceWhenLatestSampleIsTooOld() {
        TrafficSample sample = new TrafficSample();
        sample.setPolledAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(30));
        when(sampleRepository.findTopByOrderByPolledAtDesc()).thenReturn(Optional.of(sample));

        IngestionGapHealthIndicator indicator = new IngestionGapHealthIndicator(
            sampleRepository,
            new TrafficObservabilityProps(15, 80, 95)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("OUT_OF_SERVICE");
    }

    @Test
    void healthIsUpWhenLatestSampleIsFresh() {
        TrafficSample sample = new TrafficSample();
        sample.setPolledAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(2));
        when(sampleRepository.findTopByOrderByPolledAtDesc()).thenReturn(Optional.of(sample));

        IngestionGapHealthIndicator indicator = new IngestionGapHealthIndicator(
            sampleRepository,
            new TrafficObservabilityProps(15, 80, 95)
        );

        assertThat(indicator.health().getStatus().getCode()).isEqualTo("UP");
    }
}
