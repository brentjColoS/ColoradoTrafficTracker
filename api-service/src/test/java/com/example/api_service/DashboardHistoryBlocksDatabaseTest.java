package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Opt-in, bounded parity check against retained local data; never creates or changes rows. */
@EnabledIfEnvironmentVariable(named = "CTT_HISTORY_DB_URL", matches = ".+")
class DashboardHistoryBlocksDatabaseTest {
    @Test void retainedZoneWindowsMatchDirectWeightedQueriesAndReuseBlocks() {
        DriverManagerDataSource source = new DriverManagerDataSource() {
            @Override public Connection getConnection() throws SQLException {
                Connection connection = super.getConnection();
                connection.setReadOnly(true);
                return connection;
            }
        };
        source.setUrl(System.getenv("CTT_HISTORY_DB_URL"));
        source.setUsername(System.getenv("CTT_HISTORY_DB_USER"));
        source.setPassword(System.getenv("CTT_HISTORY_DB_PASSWORD"));
        class Reads extends JdbcTemplate {
            int calls;
            Reads() { super(source); setQueryTimeout(15); }
            @Override public <T> List<T> query(String sql, RowMapper<T> mapper, Object... args) {
                calls++;
                return super.query(sql, mapper, args);
            }
        }
        Reads jdbc = new Reads();
        @SuppressWarnings("unchecked") ObjectProvider<JdbcTemplate> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(jdbc);
        var zones = new TrafficSpeedZoneTrendRepository(provider);
        var blocks = new DashboardHistoryBlocks(mock(TrafficAnalyticsController.class), mock(TrafficController.class),
            zones, new ObjectMapper().findAndRegisterModules(), Clock.systemUTC());
        OffsetDateTime end = OffsetDateTime.parse(System.getenv().getOrDefault("CTT_HISTORY_AS_OF", "2026-06-19T02:51:46.160498Z"));
        for (String corridor : List.of("I25", "I70")) for (int hours : List.of(2, 6, 24, 168, 720)) {
            int minutes = switch (hours) {case 2 -> 1; case 6 -> 5; case 24 -> 15; case 168 -> 60; default -> 180;};
            var direct = TrafficSpeedZoneTrendController.trendResponse(corridor, hours, end.minusHours(hours).toInstant(),
                end.toInstant(), minutes, zones.find(corridor, end.minusHours(hours).toInstant(), end.toInstant(), minutes));
            int before = jdbc.calls;
            long began = System.nanoTime();
            var cold = blocks.zones(corridor, hours, end);
            long coldMillis = (System.nanoTime() - began) / 1_000_000;
            assertEquals(direct.getStatusCode(), cold.getStatusCode());
            assertParity(direct.getBody(), cold.getBody());
            assertEquals(2, jdbc.calls - before);
            before = jdbc.calls; began = System.nanoTime();
            var warm = blocks.zones(corridor, hours, end.minusMinutes(1));
            long warmMillis = (System.nanoTime() - began) / 1_000_000;
            assertEquals(1, jdbc.calls - before, "Only exact edge buckets should be queried on an overlapping warm read");
            var shifted = end.minusMinutes(1);
            var expected = TrafficSpeedZoneTrendController.trendResponse(corridor, hours, shifted.minusHours(hours).toInstant(),
                shifted.toInstant(), minutes, zones.find(corridor, shifted.minusHours(hours).toInstant(), shifted.toInstant(), minutes));
            assertParity(expected.getBody(), warm.getBody());
            System.out.printf("Retained parity %s %dh: cold=%dms/2 queries, overlap=%dms/1 edge query, rows=%d%n",
                corridor, hours, coldMillis, warmMillis, cold.getBody() == null ? 0 : cold.getBody().returned());
        }
    }

    private void assertParity(com.example.api_service.dto.TrafficSpeedZoneTrendResponseDto expected,
        com.example.api_service.dto.TrafficSpeedZoneTrendResponseDto actual) {
        if (expected == null) { assertNull(actual); return; }
        assertNotNull(actual);
        ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
        var expectedJson = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(expected);
        var actualJson = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(actual);
        expectedJson.remove("points"); actualJson.remove("points");
        assertEquals(expectedJson, actualJson);
        assertEquals(expected.points().size(), actual.points().size());
        for (int i = 0; i < expected.points().size(); i++) {
            var left = expected.points().get(i); var right = actual.points().get(i);
            var leftJson = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(left);
            var rightJson = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.valueToTree(right);
            leftJson.remove("avgCurrentSpeed"); rightJson.remove("avgCurrentSpeed");
            assertEquals(leftJson, rightJson, "Bucket metadata, counts and minimum must match exactly at row " + i);
            // PostgreSQL may sum floating-point inputs in a different order for a wider indexed read.
            if (left.avgCurrentSpeed() == null) assertNull(right.avgCurrentSpeed());
            else assertEquals(left.avgCurrentSpeed(), right.avgCurrentSpeed(), 1e-9, "Weighted speed at row " + i);
        }
    }
}
