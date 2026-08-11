package com.example.ingest_service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class TrafficRetentionJob {
    private static final Logger log = LoggerFactory.getLogger(TrafficRetentionJob.class);
    private static final int MAX_BATCH_SIZE = 10_000;
    private static final int MAX_BATCHES_PER_RUN = 1_000;

    private final TrafficRetentionBatchWriter batchWriter;
    private final TrafficRetentionProps props;

    public TrafficRetentionJob(
        TrafficRetentionBatchWriter batchWriter,
        TrafficRetentionProps props
    ) {
        this.batchWriter = batchWriter;
        this.props = props;
    }

    @Scheduled(
        cron = "${traffic.retention.cleanupCron:0 15 2 * * *}",
        scheduler = "retentionTaskScheduler"
    )
    public void archiveAndCleanup() {
        if (!props.enabled()) return;

        int retentionDays = Math.max(1, props.days());
        int batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, props.batchSize()));
        int maxBatches = Math.max(1, Math.min(MAX_BATCHES_PER_RUN, props.maxBatchesPerRun()));
        OffsetDateTime startedAt = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime cutoff = startedAt.minusDays(retentionDays);
        int archivedIncidents = 0;
        int archivedSamples = 0;
        int deletedSamples = 0;
        int batches = 0;
        int lastBatchSize = 0;

        while (batches < maxBatches) {
            RetentionBatchResult result = batchWriter.archiveNext(cutoff, startedAt, batchSize);
            lastBatchSize = result.deletedSamples();
            if (lastBatchSize == 0) break;

            batches++;
            archivedIncidents += result.archivedIncidents();
            archivedSamples += result.archivedSamples();
            deletedSamples += result.deletedSamples();
            if (lastBatchSize < batchSize) break;
        }

        long elapsedMillis = Duration.between(startedAt, OffsetDateTime.now(ZoneOffset.UTC)).toMillis();
        int changedRows = archivedIncidents + archivedSamples + deletedSamples;
        if (batches == maxBatches && lastBatchSize == batchSize) {
            log.warn(
                "Retention cleanup reached its batch limit (days={}, cutoff={}, batches={}, batchSize={}, archivedSamples={}, archivedIncidents={}, deletedSamples={}, changedRows={}, elapsedMs={})",
                retentionDays,
                cutoff,
                batches,
                batchSize,
                archivedSamples,
                archivedIncidents,
                deletedSamples,
                changedRows,
                elapsedMillis
            );
            return;
        }
        log.info(
            "Retention cleanup complete (days={}, cutoff={}, batches={}, batchSize={}, archivedSamples={}, archivedIncidents={}, deletedSamples={}, changedRows={}, elapsedMs={})",
            retentionDays,
            cutoff,
            batches,
            batchSize,
            archivedSamples,
            archivedIncidents,
            deletedSamples,
            changedRows,
            elapsedMillis
        );
    }
}
