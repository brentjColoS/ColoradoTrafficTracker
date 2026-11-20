package com.example.ingest_service;

import static org.junit.jupiter.api.Assertions.*;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

@EnabledIfEnvironmentVariable(named = "CTT_COUNTER_DISPOSABLE_DB_URL", matches = ".+")
class VariableSpeedSignHistoryDatabaseTest {
    @Configuration @EnableTransactionManagement static class Transactions {}

    @Test void preservesEveryExistingReadAtomicallyWithoutRewritingHistory() throws Exception {
        var source = new SingleConnectionDataSource(System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL"), "postgres", "", true);
        try (var context = new AnnotationConfigApplicationContext()) {
            var jdbc = new JdbcTemplate(source);
            jdbc.execute("create temporary table traffic_variable_speed_sign_current (sign_id varchar(64) primary key, last_attempt_at timestamptz not null, payload_json text not null)");
            String migration = Files.readString(Path.of("src/main/resources/db/migration/V29__variable_speed_sign_history.sql"));
            jdbc.execute(migration.replace("create table ", "create temporary table "));
            var mapper = new ObjectMapper().findAndRegisterModules();
            context.register(Transactions.class);
            context.registerBean(PlatformTransactionManager.class, () -> new DataSourceTransactionManager(source));
            context.registerBean(VariableSpeedSignStore.class, () -> new VariableSpeedSignStore(jdbc, mapper));
            context.refresh();
            var store = context.getBean(VariableSpeedSignStore.class);
            var device = I70VariableSpeedSigns.devices().getFirst();
            Instant time = Instant.parse("2026-11-18T12:00:00.123456789Z");
            var reduced = new VariableSpeedSign(device.id(), device.mileMarker(), device.direction(), device.longitude(),
                device.latitude(), device.location(), device.regularLimitMph(), 40, "AVAILABLE", "on", "operational",
                time.minusSeconds(86400), time.minusSeconds(86400), time, time);
            store.save(reduced); store.save(reduced);
            assertEquals(1, jdbc.queryForObject("select count(*) from traffic_variable_speed_sign_history", Integer.class));
            assertEquals(mapper.writeValueAsString(reduced), jdbc.queryForObject("select payload_json from traffic_variable_speed_sign_history", String.class));
            var failed = reduced.failed(time.plusSeconds(21600));
            store.save(failed);
            assertEquals(2, jdbc.queryForObject("select count(*) from traffic_variable_speed_sign_history", Integer.class));
            assertEquals(failed, store.current().get(device.id()));
            store.save(reduced);
            assertEquals(failed, store.current().get(device.id()), "late saves cannot rewind the current snapshot");
            assertThrows(IllegalStateException.class, () -> store.save(reduced.failed(time)));
            assertEquals(2, jdbc.queryForObject("select count(*) from traffic_variable_speed_sign_history", Integer.class));
            jdbc.execute("alter table traffic_variable_speed_sign_current add constraint reject_future_test check(last_attempt_at < '2026-11-18T19:00:00Z')");
            assertThrows(RuntimeException.class, () -> store.save(reduced.failed(time.plusSeconds(43200))));
            assertEquals(2, jdbc.queryForObject("select count(*) from traffic_variable_speed_sign_history", Integer.class), "current write failure rolls back history too");
            assertEquals(failed, store.current().get(device.id()));
        } finally { source.destroy(); }
    }
}
