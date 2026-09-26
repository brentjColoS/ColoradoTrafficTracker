package com.example.api_service;

import com.example.common.CorridorSpeedZones;
import com.example.common.SpeedZoneDefinition;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TrafficFlowCellFrequencyRepository {
    private static final String QUERY = """
        with speed_zones (start_mile_marker, end_mile_marker, posted_speed_mph) as (
            values %s
        ), classified as (
            select h.*, z.posted_speed_mph
            from traffic_flow_cell_hourly h
            join speed_zones z
              on (h.start_mile_marker + h.end_mile_marker) / 2.0 >= z.start_mile_marker
             and (h.start_mile_marker + h.end_mile_marker) / 2.0 < z.end_mile_marker
            where h.corridor = ?
              and h.direction = 'COMBINED'
              and h.hour_start >= ?
              and h.hour_start < ?
        )
        select
            cell_id,
            direction,
            start_mile_marker,
            end_mile_marker,
            posted_speed_mph,
            count(*) as sampled_hour_count,
            sum(observation_count) as observation_count,
            sum(avg_speed_mph * observation_count) / nullif(sum(observation_count), 0) as avg_speed_mph,
            count(*) filter (where avg_speed_mph < posted_speed_mph * 0.80) as slowdown_hour_count,
            count(*) filter (where avg_speed_mph < posted_speed_mph * 0.60) as heavy_slowdown_hour_count,
            count(*) filter (where avg_speed_mph < posted_speed_mph * 0.35) as severe_slowdown_hour_count,
            count(*) filter (where avg_speed_mph <= 3.0) as stopped_hour_count,
            min(first_observed_at) as first_observed_at,
            max(last_observed_at) as last_observed_at
        from classified
        group by cell_id, direction, start_mile_marker, end_mile_marker, posted_speed_mph
        order by start_mile_marker asc
        """;

    private final JdbcTemplate jdbcTemplate;

    public TrafficFlowCellFrequencyRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<FrequencyCell> find(String corridor, Instant windowStart, Instant windowEnd) {
        List<SpeedZoneDefinition> zones = CorridorSpeedZones.forCorridor(corridor);
        if (zones.isEmpty()) return List.of();

        String placeholders = zones.stream()
            .map(zone -> "(?, ?, ?)")
            .collect(Collectors.joining(", "));
        List<Object> parameters = new ArrayList<>();
        for (SpeedZoneDefinition zone : zones) {
            parameters.add(zone.startMileMarker());
            parameters.add(zone.endMileMarker());
            parameters.add(zone.postedSpeedMph());
        }
        parameters.add(corridor);
        parameters.add(windowStart.atOffset(ZoneOffset.UTC));
        parameters.add(windowEnd.atOffset(ZoneOffset.UTC));

        return jdbcTemplate.query(
            QUERY.formatted(placeholders),
            parameters.toArray(),
            TrafficFlowCellFrequencyRepository::mapRow
        );
    }

    private static FrequencyCell mapRow(ResultSet result, int rowNumber) throws SQLException {
        return new FrequencyCell(
            result.getString("cell_id"),
            result.getString("direction"),
            result.getDouble("start_mile_marker"),
            result.getDouble("end_mile_marker"),
            result.getInt("posted_speed_mph"),
            result.getLong("sampled_hour_count"),
            result.getLong("observation_count"),
            result.getDouble("avg_speed_mph"),
            result.getLong("slowdown_hour_count"),
            result.getLong("heavy_slowdown_hour_count"),
            result.getLong("severe_slowdown_hour_count"),
            result.getLong("stopped_hour_count"),
            result.getObject("first_observed_at", java.time.OffsetDateTime.class).toInstant(),
            result.getObject("last_observed_at", java.time.OffsetDateTime.class).toInstant()
        );
    }

    public record FrequencyCell(
        String cellId,
        String direction,
        double startMileMarker,
        double endMileMarker,
        int postedSpeedMph,
        long sampledHourCount,
        long observationCount,
        double avgSpeedMph,
        long slowdownHourCount,
        long heavySlowdownHourCount,
        long severeSlowdownHourCount,
        long stoppedHourCount,
        Instant firstObservedAt,
        Instant lastObservedAt
    ) {}
}
