package com.example.ingest_service;

import java.time.OffsetDateTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class TrafficRetentionBatchWriter {

    private final JdbcTemplate jdbc;

    public TrafficRetentionBatchWriter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public RetentionBatchResult archiveNext(
        OffsetDateTime cutoff,
        OffsetDateTime archivedAt,
        int batchSize
    ) {
        int archivedIncidents = archiveIncidents(cutoff, archivedAt, batchSize);
        int archivedSamples = archiveSamples(cutoff, archivedAt, batchSize);
        int deletedSamples = deleteSamples(cutoff, batchSize);
        return new RetentionBatchResult(archivedIncidents, archivedSamples, deletedSamples);
    }

    private int archiveIncidents(
        OffsetDateTime cutoff,
        OffsetDateTime archivedAt,
        int batchSize
    ) {
        return jdbc.update(
            """
            with batch as (
                select id
                from traffic_sample
                where polled_at < ?
                order by polled_at asc, id asc
                limit ?
            )
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
                incident_provider,
                incident_product,
                provider_event_id,
                normalized_status,
                normalized_category,
                source_updated_at,
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
                i.incident_provider,
                i.incident_product,
                i.provider_event_id,
                i.normalized_status,
                i.normalized_category,
                i.source_updated_at,
                i.polled_at,
                i.normalized_at,
                ?
            from traffic_incident i
            join batch b on b.id = i.sample_id
            where not exists (
                select 1
                from traffic_incident_archive a
                where a.source_id = i.id
            )
            """,
            cutoff,
            batchSize,
            archivedAt
        );
    }

    private int archiveSamples(
        OffsetDateTime cutoff,
        OffsetDateTime archivedAt,
        int batchSize
    ) {
        return jdbc.update(
            """
            with batch as (
                select id
                from traffic_sample
                where polled_at < ?
                order by polled_at asc, id asc
                limit ?
            )
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
                validation_requested_points,
                validation_returned_points,
                validation_coverage_ratio,
                validation_used,
                degraded,
                degraded_reason,
                speed_state_signature,
                semantic_flow_signature,
                localized_slowdown,
                localized_slowdown_note,
                flow_provider,
                flow_product,
                flow_source_zoom,
                flow_requested_cadence_seconds,
                incident_provider,
                incident_product,
                incident_fetched_at,
                incident_source_updated_at,
                incident_requested_cadence_seconds,
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
                s.validation_requested_points,
                s.validation_returned_points,
                s.validation_coverage_ratio,
                s.validation_used,
                s.degraded,
                s.degraded_reason,
                s.speed_state_signature,
                s.semantic_flow_signature,
                s.localized_slowdown,
                s.localized_slowdown_note,
                s.flow_provider,
                s.flow_product,
                s.flow_source_zoom,
                s.flow_requested_cadence_seconds,
                s.incident_provider,
                s.incident_product,
                s.incident_fetched_at,
                s.incident_source_updated_at,
                s.incident_requested_cadence_seconds,
                s.polled_at,
                s.ingested_at,
                ?
            from traffic_sample s
            join batch b on b.id = s.id
            where not exists (
                select 1
                from traffic_sample_archive a
                where a.source_id = s.id
            )
            """,
            cutoff,
            batchSize,
            archivedAt
        );
    }

    private int deleteSamples(OffsetDateTime cutoff, int batchSize) {
        return jdbc.update(
            """
            with batch as (
                select id
                from traffic_sample
                where polled_at < ?
                order by polled_at asc, id asc
                limit ?
            )
            delete from traffic_sample s
            using batch b
            where s.id = b.id
            """,
            cutoff,
            batchSize
        );
    }
}
