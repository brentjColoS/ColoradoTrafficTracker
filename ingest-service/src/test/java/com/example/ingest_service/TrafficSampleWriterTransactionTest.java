package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@ActiveProfiles("test")
class TrafficSampleWriterTransactionTest {

    @Autowired
    private TrafficSampleWriter writer;

    @Autowired
    private TrafficSampleRepository sampleRepo;

    @MockBean
    private TrafficSpeedZoneSampleRepository zoneSampleRepo;

    @Test
    void saveSampleWithZonesRollsBackSampleWhenZonePersistenceFails() {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor("I25");
        sample.setPolledAt(OffsetDateTime.parse("2026-04-12T03:15:00Z"));
        TrafficSpeedZoneSample zone = new TrafficSpeedZoneSample();

        when(zoneSampleRepo.saveAll(any()))
            .thenThrow(new DataIntegrityViolationException("simulated zone persistence failure"));

        assertThatThrownBy(() -> writer.saveSampleWithZones(sample, java.util.List.of(zone)))
            .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(sampleRepo.count()).isZero();
    }
}
