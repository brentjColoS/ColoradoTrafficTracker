package com.example.api_service;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TrafficSpeedZoneTrendRepository {
    private static final String QUERY = """
        select
            zone_key,
            zone_order,
            zone_label,
            zone_description,
            start_mile_marker,
            end_mile_marker,
            posted_speed_mph,
            date_bin(make_interval(mins => ?), polled_at, timestamptz '1970-01-01') as bucket_start,
            sum(avg_current_speed * speed_sample_count)
                / nullif(sum(speed_sample_count) filter (where avg_current_speed is not null), 0) as avg_current_speed,
            min(min_current_speed) as min_current_speed,
            sum(speed_sample_count) as observation_count
        from traffic_speed_zone_sample
        where corridor = ?
          and polled_at >= ?
          and polled_at <= ?
        group by
            zone_key,
            zone_order,
            zone_label,
            zone_description,
            start_mile_marker,
            end_mile_marker,
            posted_speed_mph,
            bucket_start
        order by bucket_start asc, zone_order asc
        """;

    private final JdbcTemplate jdbcTemplate;

    public TrafficSpeedZoneTrendRepository(ObjectProvider<JdbcTemplate> jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate.getIfAvailable();
    }

    public boolean isAvailable() {
        return jdbcTemplate != null;
    }

    public List<TrendPoint> find(
        String corridor,
        Instant windowStart,
        Instant windowEnd,
        int bucketMinutes
    ) {
        if (jdbcTemplate == null) return List.of();
        return jdbcTemplate.query(
            QUERY,
            TrafficSpeedZoneTrendRepository::mapRow,
            bucketMinutes,
            corridor,
            windowStart.atOffset(ZoneOffset.UTC),
            windowEnd.atOffset(ZoneOffset.UTC)
        );
    }

    private static TrendPoint mapRow(ResultSet result, int rowNumber) throws SQLException {
        return new TrendPoint(
            result.getString("zone_key"),
            result.getInt("zone_order"),
            result.getString("zone_label"),
            result.getString("zone_description"),
            result.getDouble("start_mile_marker"),
            result.getDouble("end_mile_marker"),
            result.getInt("posted_speed_mph"),
            result.getObject("bucket_start", java.time.OffsetDateTime.class).toInstant(),
            nullableDouble(result, "avg_current_speed"),
            nullableDouble(result, "min_current_speed"),
            result.getLong("observation_count")
        );
    }

    private static Double nullableDouble(ResultSet result, String column) throws SQLException {
        double value = result.getDouble(column);
        return result.wasNull() ? null : value;
    }

    public record TrendPoint(
        String zoneKey,
        int zoneOrder,
        String zoneLabel,
        String zoneDescription,
        double startMileMarker,
        double endMileMarker,
        int postedSpeedMph,
        Instant bucketStart,
        Double avgCurrentSpeed,
        Double minCurrentSpeed,
        long observationCount
    ) {}
}
