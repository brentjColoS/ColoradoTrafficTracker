package com.example.ingest_service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class TrafficRetentionJob {
    private static final Logger log = LoggerFactory.getLogger(TrafficRetentionJob.class);

    private final TrafficSampleRepository sampleRepo;
    private final JdbcTemplate jdbc;
    private final TrafficRetentionProps props;

    public TrafficRetentionJob(
        TrafficSampleRepository sampleRepo,
        JdbcTemplate jdbc,
        TrafficRetentionProps props
    ) {
        this.sampleRepo = sampleRepo;
        this.jdbc = jdbc;
        this.props = props;
    }

    @Scheduled(cron = "${traffic.retention.cleanupCron:0 15 2 * * *}")
    @Transactional
    public void archiveAndCleanup() {
        if (!props.enabled()) return;

        int retentionDays = Math.max(1, props.days());
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime cutoff = now.minusDays(retentionDays);

        int archived = jdbc.update(
            """
            insert into traffic_sample_archive (
                source_id,
                corridor,
                avg_current_speed,
                avg_freeflow_speed,
                min_current_speed,
                confidence,
                incidents_json,
                polled_at,
                archived_at
            )
            select
                s.id,
                s.corridor,
                s.avg_current_speed,
                s.avg_freeflow_speed,
                s.min_current_speed,
                s.confidence,
                s.incidents_json,
                s.polled_at,
                ?
            from traffic_sample s
            where s.polled_at < ?
              and not exists (
                  select 1
                  from traffic_sample_archive a
                  where a.source_id = s.id
              )
            """,
            now,
            cutoff
        );

        int deleted = sampleRepo.deleteByPolledAtBefore(cutoff);
        if (archived > 0 || deleted > 0) {
            log.info(
                "Retention cleanup complete (days={}, cutoff={}, archived={}, deleted={})",
                retentionDays,
                cutoff,
                archived,
                deleted
            );
        }
    }
}
