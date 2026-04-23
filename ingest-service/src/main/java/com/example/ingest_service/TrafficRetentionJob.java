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

        int archivedIncidents = archiveIncidents(now, cutoff);
        int archivedSamples = archiveSamples(now, cutoff);
        int deleted = sampleRepo.deleteByPolledAtBefore(cutoff);
        int changedRows = archivedIncidents + archivedSamples + deleted;
        log.info(
            "Retention cleanup complete (days={}, cutoff={}, archivedSamples={}, archivedIncidents={}, deleted={}, changedRows={})",
            retentionDays,
            cutoff,
            archivedSamples,
            archivedIncidents,
            deleted,
            changedRows
        );
    }

    private int archiveIncidents(OffsetDateTime now, OffsetDateTime cutoff) {
        return jdbc.update(
            """
            insert into traffic_incident_archive (
                source_id,
                sample_source_id,
                corridor,
                road_number,
                icon_category,
                incident_description,
                delay_seconds,
                geometry_type,
                geometry_json,
                travel_direction,
                closest_mile_marker,
                mile_marker_method,
                mile_marker_confidence,
                distance_to_corridor_meters,
                location_label,
                centroid_lat,
                centroid_lon,
                polled_at,
                normalized_at,
                archived_at
            )
            select
                i.id,
                i.sample_id,
                i.corridor,
                i.road_number,
                i.icon_category,
                i.incident_description,
                i.delay_seconds,
                i.geometry_type,
                i.geometry_json,
                i.travel_direction,
                i.closest_mile_marker,
                i.mile_marker_method,
                i.mile_marker_confidence,
                i.distance_to_corridor_meters,
                i.location_label,
                i.centroid_lat,
                i.centroid_lon,
                i.polled_at,
                i.normalized_at,
                ?
            from traffic_incident i
            join traffic_sample s on s.id = i.sample_id
            where s.polled_at < ?
              and not exists (
                  select 1
                  from traffic_incident_archive a
                  where a.source_id = i.id
              )
            """,
            now,
            cutoff
        );
    }

    private int archiveSamples(OffsetDateTime now, OffsetDateTime cutoff) {
        return jdbc.update(
            """
            insert into traffic_sample_archive (
                source_id,
                corridor,
                avg_current_speed,
                avg_freeflow_speed,
                min_current_speed,
                confidence,
                source_mode,
                speed_sample_count,
                speed_stddev,
                p10_speed,
                p50_speed,
                p90_speed,
                incident_count,
                incidents_json,
                polled_at,
                ingested_at,
                archived_at
            )
            select
                s.id,
                s.corridor,
                s.avg_current_speed,
                s.avg_freeflow_speed,
                s.min_current_speed,
                s.confidence,
                s.source_mode,
                s.speed_sample_count,
                s.speed_stddev,
                s.p10_speed,
                s.p50_speed,
                s.p90_speed,
                s.incident_count,
                s.incidents_json,
                s.polled_at,
                s.ingested_at,
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
    }
}
