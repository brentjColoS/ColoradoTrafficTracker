package com.example.api_service;

import java.time.OffsetDateTime;
import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface TrafficAnalyticsRepository extends Repository<TrafficHistorySample, Long> {
    interface RecordedExtentChange { Instant getChangedAt(); }
    @Query(value = """
        with observations as (
            select avg_current_speed,
                case when :corridor = 'I70' and cast(:distance as double precision) > 53
                    and polled_at < coalesce(cast(:distanceChangedAt as timestamptz), 'infinity'::timestamptz)
                    then 53.0 else cast(:distance as double precision) end as distance_miles
            from traffic_sample_all
            where corridor = :corridor and polled_at >= :since and polled_at <= :until
              and avg_current_speed >= 0 and avg_current_speed < 'Infinity'::double precision
        )
        select avg(avg_current_speed) as averageSpeed,
            min(avg_current_speed) as lowestObservedSpeed,
            avg(distance_miles * 60 / nullif(avg_current_speed, 0)) filter (where distance_miles > 0) as averageTravelMinutes,
            min(distance_miles * 60 / nullif(avg_current_speed, 0)) filter (where distance_miles > 0) as fastestTravelMinutes,
            max(distance_miles * 60 / nullif(avg_current_speed, 0)) filter (where distance_miles > 0) as slowestTravelMinutes
        from observations
        """, nativeQuery = true)
    TrafficWindowStatisticsProjection findWindowStatistics(@Param("corridor") String corridor,
        @Param("since") OffsetDateTime since, @Param("until") OffsetDateTime until, @Param("distance") Double distance,
        @Param("distanceChangedAt") OffsetDateTime distanceChangedAt);

    @Query(value = """
        select polled_at as changedAt from traffic_speed_zone_sample
        where corridor = 'I70' and zone_key = 'I70-259-270_274'
        order by polled_at asc limit 1
        """, nativeQuery = true)
    RecordedExtentChange findRecordedI70ExtentChange();

    @Query(value = """
        select
            (select polled_at from traffic_sample_all
             where corridor = :corridor and avg_current_speed is not null
             order by polled_at asc limit 1) as firstObservedAt,
            (select polled_at from traffic_sample_all
             where corridor = :corridor and avg_current_speed is not null
             order by polled_at desc limit 1) as lastObservedAt,
            (select polled_at from traffic_speed_zone_sample
             where corridor = :corridor and avg_current_speed is not null
             order by polled_at asc limit 1) as firstZoneObservedAt,
            (select polled_at from traffic_speed_zone_sample
             where corridor = :corridor and avg_current_speed is not null
             order by polled_at desc limit 1) as lastZoneObservedAt
        """, nativeQuery = true)
    TrafficHistoryCoverageProjection findHistoryCoverage(@Param("corridor") String corridor);

    @Query(
        value = """
            select
                corridor as corridor,
                count(*) as bucketCount,
                sum(sample_count) as sampleCount,
                sum(avg_current_speed * sample_count) filter (where avg_current_speed is not null)
                    / nullif(sum(sample_count) filter (where avg_current_speed is not null), 0)::double precision as avgCurrentSpeed,
                min(min_current_speed) as minCurrentSpeed,
                sum(avg_speed_stddev * sample_count) filter (where avg_speed_stddev is not null)
                    / nullif(sum(sample_count) filter (where avg_speed_stddev is not null), 0)::double precision as avgSpeedStddev,
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
                sum(avg_current_speed * sample_count)
                    / nullif(sum(sample_count), 0)::double precision as avgCurrentSpeed,
                min(min_current_speed) as minCurrentSpeed,
                sum(avg_speed_stddev * sample_count) filter (where avg_speed_stddev is not null)
                    / nullif(sum(sample_count) filter (where avg_speed_stddev is not null), 0)::double precision as avgSpeedStddev,
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
                sum(avg_current_speed * sample_count)
                    / nullif(sum(sample_count), 0)::double precision as avgCurrentSpeed,
                min(min_current_speed) as minCurrentSpeed,
                sum(avg_speed_stddev * sample_count) filter (where avg_speed_stddev is not null)
                    / nullif(sum(sample_count) filter (where avg_speed_stddev is not null), 0)::double precision as avgSpeedStddev,
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
              and bucket_start between :since and :until
            order by bucket_start desc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficCorridorTrendProjection> findTrendBetween(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("until") OffsetDateTime until,
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
              and bucket_start between :since and :until
              and avg_current_speed is not null
            order by bucket_start desc
            limit :limit
            """,
        nativeQuery = true
    )
    List<TrafficCorridorTrendProjection> findTrendWithSpeedBetween(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("until") OffsetDateTime until,
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
              and bucket_start < :until
              and avg_current_speed is not null
            order by bucket_start asc
            """,
        nativeQuery = true
    )
    List<TrafficCorridorTrendProjection> findBaselineHistoryBetween(
        @Param("corridor") String corridor,
        @Param("since") OffsetDateTime since,
        @Param("until") OffsetDateTime until
    );

}
