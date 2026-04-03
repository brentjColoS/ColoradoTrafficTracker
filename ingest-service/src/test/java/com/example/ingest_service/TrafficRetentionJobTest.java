package com.example.ingest_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

@ExtendWith(MockitoExtension.class)
class TrafficRetentionJobTest {

    @Mock
    private TrafficSampleRepository sampleRepo;

    @Mock
    private JdbcTemplate jdbc;

    @Test
    void archiveAndCleanupNoopsWhenDisabled() {
        TrafficRetentionJob job = new TrafficRetentionJob(
            sampleRepo,
            jdbc,
            new TrafficRetentionProps(false, 30, "0 15 2 * * *")
        );

        job.archiveAndCleanup();

        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verify(sampleRepo, never()).deleteByPolledAtBefore(any());
    }

    @Test
    void archiveAndCleanupExecutesWhenEnabled() {
        TrafficRetentionJob job = new TrafficRetentionJob(
            sampleRepo,
            jdbc,
            new TrafficRetentionProps(true, 30, "0 15 2 * * *")
        );

        job.archiveAndCleanup();

        verify(jdbc).update(anyString(), any(Object[].class));
        verify(sampleRepo).deleteByPolledAtBefore(any());
    }
}
