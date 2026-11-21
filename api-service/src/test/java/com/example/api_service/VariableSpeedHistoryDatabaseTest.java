package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

@EnabledIfEnvironmentVariable(named = "CTT_COUNTER_DISPOSABLE_DB_URL", matches = ".+")
class VariableSpeedHistoryDatabaseTest {
    @Test void readsOnlyTheBoundedWindowAndRejectsCorruptionWithoutAffectingCurrentReads() throws Exception {
        var source = new SingleConnectionDataSource(System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL"), "postgres", "", true);
        try {
            var jdbc = new JdbcTemplate(source);
            jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/V29__variable_speed_sign_history.sql"))
                .replace("create table ", "create temporary table "));
            var mapper = new ObjectMapper().findAndRegisterModules();
            var now = Instant.parse("2026-11-18T12:00:00Z");
            var controller = new VariableSpeedHistoryController(jdbc, mapper, Clock.fixed(now, ZoneOffset.UTC));
            assertTrue(controller.history("I70", 24, now).getBody().observations().isEmpty());
            var device = I70VariableSpeedSigns.devices().getFirst();
            for (long seconds : new long[]{-90001, -90000, -1800, 1}) {
                var at = now.plusSeconds(seconds);
                var sign = new VariableSpeedSign(device.id(), device.mileMarker(), device.direction(), device.longitude(),
                    device.latitude(), device.location(), device.regularLimitMph(), 40, "AVAILABLE", "on", "operational", at, at, at, at);
                jdbc.update("insert into traffic_variable_speed_sign_history values (?, ?, ?)", device.id(), at.atOffset(ZoneOffset.UTC), mapper.writeValueAsString(sign));
            }
            var response = controller.history("i70", 24, now);
            assertEquals(200, response.getStatusCode().value());
            assertEquals(now.minusSeconds(86400), response.getBody().start());
            assertEquals(2, response.getBody().observations().size(), "includes only one hour of left-edge context and no future reads");
            jdbc.update("update traffic_variable_speed_sign_history set payload_json = '{}' where observed_at = ?", now.minusSeconds(1800).atOffset(ZoneOffset.UTC));
            assertEquals(503, controller.history("I70", 24, now).getStatusCode().value());
            jdbc.execute("drop table traffic_variable_speed_sign_history");
            assertEquals(503, controller.history("I70", 24, now).getStatusCode().value());
            assertEquals(200, new VariableSpeedLimitController(jdbc, mapper, Clock.fixed(now, ZoneOffset.UTC)).current("I70").getStatusCode().value());
        } finally { source.destroy(); }
    }
}
