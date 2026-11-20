package com.example.ingest_service;

import static org.junit.jupiter.api.Assertions.*;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;

@EnabledIfEnvironmentVariable(named = "CTT_COUNTER_DISPOSABLE_DB_URL", matches = ".+")
class VariableSpeedSignHistoryDatabaseTest {
    private static final Instant TIME = Instant.parse("2026-11-18T12:00:00.123456789Z");
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    @Test void captureOffDoesNotRequireHistoryStorage() throws Exception {
        try (var database = new Database(false)) {
            var sign = sign();
            database.store(false).save(sign);
            assertEquals(sign, database.store(false).current().get(sign.id()));
            assertNull(database.jdbc.queryForObject("select to_regclass('traffic_variable_speed_sign_history')", String.class));
        }
    }

    @Test void retainsOriginalReadsIdempotentlyAndDoesNotRewindCurrentState() throws Exception {
        try (var database = new Database(true)) {
            var store = database.store(true);
            var sign = sign();
            store.save(sign);
            store.save(sign);
            assertEquals(1, database.count());
            assertEquals(mapper.writeValueAsString(sign), database.jdbc.queryForObject(
                "select payload_json from traffic_variable_speed_sign_history", String.class));
            var failed = sign.failed(TIME.plusSeconds(21600));
            store.save(failed);
            store.save(sign);
            assertEquals(2, database.count());
            assertEquals(failed, store.current().get(sign.id()));
            assertThrows(IllegalStateException.class, () -> store.save(sign(failed.lastAttemptAt())));
            assertEquals(failed, store.current().get(sign.id()), "same-time conflicts cannot rewrite current state");
            assertEquals(2, database.count());
        }
    }

    @Test void currentWriteFailureCannotCreateAHistoricalObservation() throws Exception {
        try (var database = new Database(true)) {
            database.jdbc.execute("alter table traffic_variable_speed_sign_current add constraint reject_test check(false)");
            assertThrows(RuntimeException.class, () -> database.store(true).save(sign()));
            assertEquals(0, database.count());
        }
    }

    @Test void missingHistoryDoesNotLoseCurrentStateOrItsRefreshTimestamp() throws Exception {
        try (var database = new Database(false)) {
            var failed = sign().failed(TIME.plusSeconds(21600));
            assertDoesNotThrow(() -> database.store(true).save(failed));
            assertEquals(failed, database.store(false).current().get(failed.id()));
        }
    }

    @Test void productionJpaTransactionsAlsoKeepCurrentStateWhenHistoryFails() throws Exception {
        try (var database = new Database(false)) {
            var factory = new LocalContainerEntityManagerFactoryBean();
            factory.setDataSource(database.source);
            factory.setPackagesToScan("com.example.ingest_service");
            factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
            factory.setJpaPropertyMap(java.util.Map.of("hibernate.hbm2ddl.auto", "none"));
            factory.afterPropertiesSet();
            try {
                var store = new VariableSpeedSignStore(database.jdbc, mapper,
                    new JpaTransactionManager(factory.getObject()), true);
                assertDoesNotThrow(() -> store.save(sign()));
                assertEquals(sign(), store.current().get(sign().id()));
            } finally {
                factory.destroy();
            }
        }
    }

    @Test void lockedHistoryTimesOutWithoutRollingBackCurrentState() throws Exception {
        try (var database = new Database(true); var connection = database.source.getConnection()) {
            connection.setAutoCommit(false);
            try (var statement = connection.createStatement()) {
                statement.execute("lock table traffic_variable_speed_sign_history in access exclusive mode");
            }
            try {
                assertTimeout(Duration.ofSeconds(5), () -> database.store(true).save(sign()));
                assertEquals(sign(), database.store(false).current().get(sign().id()));
            } finally {
                connection.rollback();
            }
            assertEquals(0, database.count(), "a failed append remains a gap, not a fabricated observation");
            database.store(true).save(sign().failed(TIME.plusSeconds(21600)));
            assertEquals(1, database.count(), "the next ordinary read can record after storage recovers");
        }
    }

    @Test void conflictingHistoryIsNeverOverwrittenAndDoesNotBreakCurrentUpdates() throws Exception {
        try (var database = new Database(true)) {
            var store = database.store(true);
            var sign = sign();
            store.save(sign);
            String original = database.jdbc.queryForObject("select payload_json from traffic_variable_speed_sign_history", String.class);
            store.save(sign.failed(TIME.plusSeconds(21600)));
            assertDoesNotThrow(() -> store.save(sign.failed(TIME)));
            assertEquals(2, database.count());
            assertEquals(original, database.jdbc.queryForObject(
                "select payload_json from traffic_variable_speed_sign_history order by observed_at limit 1", String.class));
            assertEquals(TIME.plusSeconds(21600), store.current().get(sign.id()).lastAttemptAt());
        }
    }

    private VariableSpeedSign sign() {
        return sign(TIME);
    }

    private VariableSpeedSign sign(Instant time) {
        var device = I70VariableSpeedSigns.devices().getFirst();
        return new VariableSpeedSign(device.id(), device.mileMarker(), device.direction(), device.longitude(),
            device.latitude(), device.location(), device.regularLimitMph(), 40, "AVAILABLE", "on", "operational",
            time.minusSeconds(86400), time.minusSeconds(86400), time, time);
    }

    private class Database implements AutoCloseable {
        final String schema = "sign_history_" + UUID.randomUUID().toString().replace("-", "");
        final JdbcTemplate admin;
        final DriverManagerDataSource source;
        final JdbcTemplate jdbc;

        Database(boolean history) throws Exception {
            String url = System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL");
            admin = new JdbcTemplate(new DriverManagerDataSource(url, "postgres", ""));
            admin.execute("create schema " + schema);
            source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema, "postgres", "");
            jdbc = new JdbcTemplate(source);
            jdbc.execute("create table traffic_variable_speed_sign_current (sign_id varchar(64) primary key, last_attempt_at timestamptz not null, payload_json text not null)");
            if (history) jdbc.execute(Files.readString(Path.of("src/main/resources/db/migration/V29__variable_speed_sign_history.sql")));
        }

        VariableSpeedSignStore store(boolean enabled) {
            return new VariableSpeedSignStore(jdbc, mapper, new DataSourceTransactionManager(source), enabled);
        }

        int count() {
            return jdbc.queryForObject("select count(*) from traffic_variable_speed_sign_history", Integer.class);
        }

        public void close() {
            admin.execute("drop schema " + schema + " cascade");
        }
    }
}
