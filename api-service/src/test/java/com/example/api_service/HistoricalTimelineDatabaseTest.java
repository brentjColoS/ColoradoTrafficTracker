package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

@EnabledIfEnvironmentVariable(named = "CTT_COUNTER_DISPOSABLE_DB_URL", matches = ".+")
class HistoricalTimelineDatabaseTest {
    @Test void narrowLifecycleReadsPreserveEverySelectedEventFieldAndOrdering() throws Exception {
        var source = new SingleConnectionDataSource(System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL"), "postgres", "", true);
        try {
            var jdbc = new JdbcTemplate(source);
            jdbc.setQueryTimeout(10);
            jdbc.execute("""
                create temporary table corridor_ref(code text, start_mile_marker float8, end_mile_marker float8);
                insert into corridor_ref values ('I25', 271, 208), ('I70', 206, 274);
                create temporary table traffic_incident_all(
                    history_id bigint, incident_ref_id bigint, is_archived boolean,
                    polled_at timestamptz, corridor text, road_number text, incident_provider text,
                    incident_product text, provider_event_id text, normalized_status text, normalized_category text,
                    incident_description text, icon_category int, delay_seconds int, geometry_type text,
                    geometry_json text, source_updated_at timestamptz, travel_direction text,
                    closest_mile_marker float8, mile_marker_method text, mile_marker_confidence float8,
                    distance_to_corridor_meters float8, location_label text, centroid_lat float8, centroid_lon float8);
                insert into traffic_incident_all
                select sign * id, id, sign < 0, time, corridor, 'road-' || id, 'provider',
                    'product-' || id, event, 'status-' || id, category, 'description-' || id,
                    icon, id * 10, 'Point', '[' || id || ',40]', time, direction,
                    marker, method, 0.95, id * 0.1, 'location-' || id, 40, -105
                from (values
                    (1, 1, '2026-11-01T06:00:00Z'::timestamptz, 'I25', 'event', 'CRASH', 1, 'N', 240.0, 'exact'),
                    (2, -1, '2026-11-01T06:03:00Z'::timestamptz, 'I25', 'event', 'CLOSURE', 8, 'S', 241.0, 'exact'),
                    (3, 1, '2026-11-01T06:06:00.000001Z'::timestamptz, 'I25', 'event', 'CRASH', 1, 'N', 242.0, 'exact'),
                    (4, -1, '2026-11-01T06:06:00.000001Z'::timestamptz, 'I25', 'event', 'CRASH', 1, 'N', 243.0, 'exact'),
                    (5, 1, '2026-11-01T06:02:00Z'::timestamptz, 'I25', null, 'CRASH', 1, 'N', 240.01, 'exact'),
                    (6, -1, '2026-11-01T06:05:00Z'::timestamptz, 'I25', ' ', 'CRASH', 1, 'N', 240.04, 'exact'),
                    (7, 1, '2026-11-01T06:02:00Z'::timestamptz, 'I25', null, 'CRASH', 1, 'S', 240.01, 'exact'),
                    (8, -1, '2026-11-01T06:02:00Z'::timestamptz, 'I25', 'off', 'CRASH', 1, 'N', 240.0, 'off_corridor'),
                    (9, 1, '2026-11-01T06:02:00Z'::timestamptz, 'I25', 'outside', 'CRASH', 1, 'N', 300.0, 'exact'),
                    (10, -1, '2026-11-01T06:02:00Z'::timestamptz, 'I25', 'jam', 'JAM', 5, 'N', 240.0, 'exact'),
                    (11, 1, '2026-11-01T06:02:00Z'::timestamptz, 'I70', 'event', 'CONSTRUCTION', 9, 'E', 240.0, 'exact'),
                    (1, -1, '2026-11-01T06:02:00Z'::timestamptz, 'I70', null, null, 14, null, 241.0, 'exact'),
                    (12, 1, '2026-11-01T09:00:00Z'::timestamptz, 'I25', 'later', 'CRASH', 1, 'N', 240.0, 'exact')
                ) fixture(id, sign, time, corridor, event, category, icon, direction, marker, method)
                """);
            String reference;
            // Frozen query from accepted experimental 4ee2055, before narrowing the sort records.
            try (var input = getClass().getResourceAsStream("/historical-timeline-reference.sql")) {
                reference = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            }
            var named = new NamedParameterJdbcTemplate(jdbc);
            for (String timezone : List.of("UTC", "America/Denver")) {
                jdbc.execute("set time zone '" + timezone + "'");
                for (String corridor : List.of("I25", "I70", "EMPTY")) {
                    for (String start : List.of("2026-11-01T06:00:00Z", "2026-11-01T06:00:00.000001Z", "2026-11-01T06:03:00Z")) {
                        for (int limit : List.of(1, 1000)) {
                            var params = Map.of("corridor", corridor, "since", OffsetDateTime.parse(start),
                                "until", OffsetDateTime.parse("2026-11-01T06:06:00.000001Z"),
                                "activeSince", OffsetDateTime.parse("2026-11-01T06:03:00Z"), "limit", limit);
                            var expected = named.queryForList(reference, params);
                            var actual = named.queryForList(CurrentIncidentRepository.HISTORICAL_TIMELINE_SELECT, params);
                            assertEquals(expected, actual, timezone + " " + params);
                            if (corridor.equals("I25") && start.endsWith("06:00:00Z") && limit == 1000) {
                                assertEquals(4, actual.size());
                                assertTrue(actual.stream().noneMatch(row -> List.of(8L, 9L, 10L).contains(Math.abs(((Number) row.get("eventid")).longValue()))));
                            }
                        }
                    }
                }
            }
        } finally { source.destroy(); }
    }
}
