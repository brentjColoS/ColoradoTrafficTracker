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
                count(*) as bucketCount,
                sum(sample_count) as sampleCount,
                avg(avg_current_speed) as avgCurrentSpeed,
                min(min_current_speed) as minCurrentSpeed,
                avg(avg_speed_stddev) as avgSpeedStddev,
                sum(total_incidents) as totalIncidentCount,
                min(bucket_start) as firstBucketStart,
                max(bucket_start) as lastBucketStart
            from traffic_corridor_hourly_rollup
            where corridor = :corridor
              and bucket_start >= :since
              and avg_current_speed is not null
            group by corridor
            """,
        nativeQuery = true
    )
    List<TrafficCorridorSummaryProjection> summarizeCorridorWithSpeed(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since
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
                hotspot_rows.corridor as corridor,
                hotspot_rows.travel_direction as travelDirection,
                hotspot_rows.mile_marker_band as mileMarkerBand,
                count(*) as observationCount,
                count(distinct hotspot_rows.reference_key) as incidentCount,
                avg(hotspot_rows.delay_seconds) as avgDelaySeconds,
                max(hotspot_rows.delay_seconds) as maxDelaySeconds,
                min(hotspot_rows.polled_at) as firstSeenAt,
                max(hotspot_rows.polled_at) as lastSeenAt,
                sum(case when hotspot_rows.is_archived then 1 else 0 end) as archivedObservationCount,
                count(distinct case when hotspot_rows.is_archived then hotspot_rows.reference_key end) as archivedIncidentCount
            from (
                select
                    corridor,
                    coalesce(nullif(trim(travel_direction), ''), '?') as travel_direction,
                    cast(floor(closest_mile_marker) as integer) as mile_marker_band,
                    delay_seconds,
                    polled_at,
                    is_archived,
                    concat_ws(
                        '|',
                        coalesce(cast(round(cast(closest_mile_marker as numeric), 1) as text), ''),
                        coalesce(
                            nullif(upper(trim(location_label)), ''),
                            concat_ws(
                                ',',
                                coalesce(cast(round(cast(centroid_lat as numeric), 4) as text), ''),
                                coalesce(cast(round(cast(centroid_lon as numeric), 4) as text), ''),
                                coalesce(geometry_type, '')
                            )
                        )
                    ) as reference_key
                from traffic_incident_all
                where corridor = :corridor
                  and polled_at >= :since
            ) hotspot_rows
            group by
                hotspot_rows.corridor,
                hotspot_rows.travel_direction,
                hotspot_rows.mile_marker_band
            order by
                case when hotspot_rows.mile_marker_band is null then 1 else 0 end asc,
                count(*) desc,
                count(distinct hotspot_rows.reference_key) desc,
                coalesce(max(hotspot_rows.delay_seconds), 0) desc,
                coalesce(avg(hotspot_rows.delay_seconds), 0) desc,
                max(hotspot_rows.polled_at) desc,
                hotspot_rows.corridor asc
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
                hotspot_rows.corridor as corridor,
                hotspot_rows.travel_direction as travelDirection,
                hotspot_rows.mile_marker_band as mileMarkerBand,
                count(*) as observationCount,
                count(distinct hotspot_rows.reference_key) as incidentCount,
                avg(hotspot_rows.delay_seconds) as avgDelaySeconds,
                max(hotspot_rows.delay_seconds) as maxDelaySeconds,
                min(hotspot_rows.polled_at) as firstSeenAt,
                max(hotspot_rows.polled_at) as lastSeenAt,
                sum(case when hotspot_rows.is_archived then 1 else 0 end) as archivedObservationCount,
                count(distinct case when hotspot_rows.is_archived then hotspot_rows.reference_key end) as archivedIncidentCount
            from (
                select
                    corridor,
                    coalesce(nullif(trim(travel_direction), ''), '?') as travel_direction,
                    cast(floor(closest_mile_marker) as integer) as mile_marker_band,
                    delay_seconds,
                    polled_at,
                    is_archived,
                    concat_ws(
                        '|',
                        coalesce(cast(round(cast(closest_mile_marker as numeric), 1) as text), ''),
                        coalesce(
                            nullif(upper(trim(location_label)), ''),
                            concat_ws(
                                ',',
                                coalesce(cast(round(cast(centroid_lat as numeric), 4) as text), ''),
                                coalesce(cast(round(cast(centroid_lon as numeric), 4) as text), ''),
                                coalesce(geometry_type, '')
                            )
                        )
                    ) as reference_key
                from traffic_incident_all
                where polled_at >= :since
            ) hotspot_rows
            group by
                hotspot_rows.corridor,
                hotspot_rows.travel_direction,
                hotspot_rows.mile_marker_band
            order by
                case when hotspot_rows.mile_marker_band is null then 1 else 0 end asc,
                count(*) desc,
                count(distinct hotspot_rows.reference_key) desc,
                coalesce(max(hotspot_rows.delay_seconds), 0) desc,
                coalesce(avg(hotspot_rows.delay_seconds), 0) desc,
                max(hotspot_rows.polled_at) desc,
                hotspot_rows.corridor asc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficIncidentHotspotProjection> findHotspots(
        @Param("since") OffsetDateTime since,
        @Param("limit") int limit
    );
}
