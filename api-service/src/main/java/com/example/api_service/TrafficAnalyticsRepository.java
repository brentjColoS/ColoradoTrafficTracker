package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface TrafficAnalyticsRepository extends Repository<TrafficHistorySample, Long> {
    @Query(
        value = """
            select
                corridor as corridor,
                count(*) as bucketCount,
                sum(sample_count) as sampleCount,
                avg(avg_current_speed) as avgCurrentSpeed,
                min(min_current_speed) as minCurrentSpeed,
                avg(avg_speed_stddev) as avgSpeedStddev,
                sum(total_incidents) as totalIncidentCount,
                min(bucket_start) as firstBucketStart,
                max(bucket_start) as lastBucketStart
            from traffic_corridor_hourly_rollup
            where bucket_start >= :since
            group by corridor
            order by corridor asc
            """,
        nativeQuery = true
    )
    List<TrafficCorridorSummaryProjection> summarizeCorridors(@Param("since") OffsetDateTime since);

    @Query(
        value = """
            select
                corridor as corridor,
                count(*) as bucketCount,
                sum(sample_count) as sampleCount,
                avg(avg_current_speed) as avgCurrentSpeed,
                min(min_current_speed) as minCurrentSpeed,
                avg(avg_speed_stddev) as avgSpeedStddev,
                sum(total_incidents) as totalIncidentCount,
                min(bucket_start) as firstBucketStart,
                max(bucket_start) as lastBucketStart
            from traffic_corridor_hourly_rollup
            where bucket_start >= :since
              and avg_current_speed is not null
            group by corridor
            order by corridor asc
            """,
        nativeQuery = true
    )
    List<TrafficCorridorSummaryProjection> summarizeCorridorsWithSpeed(@Param("since") OffsetDateTime since);

    @Query(
        value = """
            select
                corridor as corridor,
                bucket_start as bucketStart,
                sample_count as sampleCount,
                avg_current_speed as avgCurrentSpeed,
                avg_freeflow_speed as avgFreeflowSpeed,
                min_current_speed as minCurrentSpeed,
                avg_confidence as avgConfidence,
                avg_speed_stddev as avgSpeedStddev,
                avg_p50_speed as avgP50Speed,
                avg_p90_speed as avgP90Speed,
                total_incidents as totalIncidents,
                archived_sample_count as archivedSampleCount
            from traffic_corridor_hourly_rollup
            where corridor = :corridor
              and bucket_start >= :since
            order by bucket_start desc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficCorridorTrendProjection> findTrend(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    @Query(
        value = """
            select
                corridor as corridor,
                bucket_start as bucketStart,
                sample_count as sampleCount,
                avg_current_speed as avgCurrentSpeed,
                avg_freeflow_speed as avgFreeflowSpeed,
                min_current_speed as minCurrentSpeed,
                avg_confidence as avgConfidence,
                avg_speed_stddev as avgSpeedStddev,
                avg_p50_speed as avgP50Speed,
                avg_p90_speed as avgP90Speed,
                total_incidents as totalIncidents,
                archived_sample_count as archivedSampleCount
            from traffic_corridor_hourly_rollup
            where corridor = :corridor
              and bucket_start >= :since
              and avg_current_speed is not null
            order by bucket_start desc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficCorridorTrendProjection> findTrendWithSpeed(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    @Query(
        value = """
            select
                corridor as corridor,
                travel_direction as travelDirection,
                mile_marker_band as mileMarkerBand,
                incident_count as incidentCount,
                avg_delay_seconds as avgDelaySeconds,
                max_delay_seconds as maxDelaySeconds,
                first_seen_at as firstSeenAt,
                last_seen_at as lastSeenAt,
                archived_incident_count as archivedIncidentCount
            from traffic_incident_hotspot
            where corridor = :corridor
              and last_seen_at >= :since
            order by incident_count desc, avg_delay_seconds desc, corridor asc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficIncidentHotspotProjection> findHotspotsByCorridor(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );

    @Query(
        value = """
            select
                corridor as corridor,
                travel_direction as travelDirection,
                mile_marker_band as mileMarkerBand,
                incident_count as incidentCount,
                avg_delay_seconds as avgDelaySeconds,
                max_delay_seconds as maxDelaySeconds,
                first_seen_at as firstSeenAt,
                last_seen_at as lastSeenAt,
                archived_incident_count as archivedIncidentCount
            from traffic_incident_hotspot
            where last_seen_at >= :since
            order by incident_count desc, avg_delay_seconds desc, corridor asc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficIncidentHotspotProjection> findHotspots(
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );
}
