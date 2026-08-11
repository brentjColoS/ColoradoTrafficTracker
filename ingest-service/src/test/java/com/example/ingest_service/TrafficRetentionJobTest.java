package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TrafficRetentionJobTest {

    @Mock
    private TrafficRetentionBatchWriter batchWriter;

    @Test
    void archiveAndCleanupNoopsWhenDisabled() {
        TrafficRetentionJob job = new TrafficRetentionJob(
            batchWriter,
            props(false, 30, 500, 20)
        );

        job.archiveAndCleanup();

        verifyNoInteractions(batchWriter);
    }

    @Test
    void archiveAndCleanupRunsUntilTheLastPartialBatch() {
        when(batchWriter.archiveNext(any(), any(), eq(500)))
            .thenReturn(
                new RetentionBatchResult(25, 500, 500),
                new RetentionBatchResult(4, 120, 120)
            );
        TrafficRetentionJob job = new TrafficRetentionJob(
            batchWriter,
            props(true, 30, 500, 20)
        );

        job.archiveAndCleanup();

        verify(batchWriter, org.mockito.Mockito.times(2)).archiveNext(any(), any(), eq(500));
    }

    @Test
    void archiveAndCleanupStopsWhenNoOldSamplesRemain() {
        when(batchWriter.archiveNext(any(), any(), eq(500)))
            .thenReturn(new RetentionBatchResult(0, 0, 0));
        TrafficRetentionJob job = new TrafficRetentionJob(
            batchWriter,
            props(true, 30, 500, 20)
        );

        job.archiveAndCleanup();

        verify(batchWriter).archiveNext(any(), any(), eq(500));
    }

    @Test
    void archiveAndCleanupHonorsThePerRunBatchLimit() {
        when(batchWriter.archiveNext(any(), any(), eq(100)))
            .thenReturn(new RetentionBatchResult(0, 100, 100));
        TrafficRetentionJob job = new TrafficRetentionJob(
            batchWriter,
            props(true, 30, 100, 2)
        );

        job.archiveAndCleanup();

        verify(batchWriter, org.mockito.Mockito.times(2)).archiveNext(any(), any(), eq(100));
    }

    @Test
    void archiveAndCleanupClampsRetentionAndBatchSettings() {
        when(batchWriter.archiveNext(any(), any(), eq(1)))
            .thenReturn(new RetentionBatchResult(0, 0, 0));
        TrafficRetentionJob job = new TrafficRetentionJob(
            batchWriter,
            props(true, 0, 0, 0)
        );
        OffsetDateTime start = OffsetDateTime.now();

        job.archiveAndCleanup();
        OffsetDateTime end = OffsetDateTime.now();

        ArgumentCaptor<OffsetDateTime> cutoffCaptor = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(batchWriter).archiveNext(cutoffCaptor.capture(), any(), eq(1));
        assertThat(cutoffCaptor.getValue()).isAfter(start.minusDays(1).minusSeconds(5));
        assertThat(cutoffCaptor.getValue()).isBefore(end.minusDays(1).plusSeconds(5));
        verify(batchWriter, never()).archiveNext(any(), any(), eq(10_000));
    }

    private static TrafficRetentionProps props(
        boolean enabled,
        int days,
        int batchSize,
        int maxBatches
    ) {
        return new TrafficRetentionProps(
            enabled,
            days,
            "0 15 2 * * *",
            batchSize,
            maxBatches
        );
    }
}
