package com.example.ingest_service;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.EnableTransactionManagement;

@EnabledIfEnvironmentVariable(named = "CTT_PRECISION_DB_URL", matches = "jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/postgres")
class IncidentEventPersistenceTest {
    @EnableTransactionManagement
    static class Transactions {}

    @Test
    void retainsIdentityObservationsAndTransitionsAcrossTheCompleteCorridorBatch() {
        withWriter((writer, jdbc) -> {
            writer.publish(batch(0, event("initial"), event("initial")));
            Long id = jdbc.queryForObject("select id from traffic_incident_event", Long.class);
            writer.publish(batch(1, event("initial"), event("initial")));
            assertThat(count(jdbc, "traffic_incident_event_observation")).isEqualTo(1);
            assertThat(count(jdbc, "traffic_incident_event_transition")).isEqualTo(1);
            assertThat(count(jdbc, "traffic_incident_event_corridor_transition")).isEqualTo(2);

            writer.publish(batch(2, "{\"incidents\":[]}", event("changed")));
            assertThat(jdbc.queryForObject("select id from traffic_incident_event", Long.class)).isEqualTo(id);
            assertThat(jdbc.queryForObject("select active from traffic_incident_event", Boolean.class)).isTrue();
            assertThat(jdbc.queryForObject("select active from traffic_incident_event_corridor where corridor='I25'", Boolean.class)).isFalse();
            assertThat(jdbc.queryForObject("select active from traffic_incident_event_corridor where corridor='I70'", Boolean.class)).isTrue();
            assertThat(count(jdbc, "traffic_incident_event_observation")).isEqualTo(2);

            writer.publish(batch(3, "{\"incidents\":[]}", "{\"incidents\":[]}"));
            assertThat(jdbc.queryForObject("select active from traffic_incident_event", Boolean.class)).isFalse();
            writer.publish(batch(4, event("changed"), "{\"incidents\":[]}"));
            assertThat(jdbc.queryForObject("select id from traffic_incident_event", Long.class)).isEqualTo(id);
            assertThat(count(jdbc, "traffic_incident_event_observation")).isEqualTo(2);
            assertThat(jdbc.queryForList("select transition_type from traffic_incident_event_transition order by occurred_at", String.class))
                .containsExactly("FIRST_SEEN", "PAYLOAD_CHANGED", "INACTIVE", "REACTIVATED");
            assertThat(jdbc.queryForList("select transition_type from traffic_incident_event_corridor_transition where corridor='I25' order by occurred_at", String.class))
                .containsExactly("FIRST_MATCHED", "UNMATCHED", "REMATCHED");
        });
    }

    @Test
    void rollsBackEarlierCorridorsWhenALaterSnapshotIsMalformed() {
        withWriter((writer, jdbc) -> {
            writer.publish(batch(0, event("initial"), event("initial")));
            var before = jdbc.queryForList("select * from traffic_incident_event");
            assertThatThrownBy(() -> writer.publish(batch(1, event("changed"), "{}")))
                .isInstanceOf(IllegalArgumentException.class);
            assertThat(jdbc.queryForList("select * from traffic_incident_event")).isEqualTo(before);
            assertThat(count(jdbc, "traffic_incident_event_observation")).isEqualTo(1);
            assertThat(count(jdbc, "traffic_incident_event_transition")).isEqualTo(1);
        });
    }

    @Test
    void rollsBackTheBatchWhenPersistenceFailsAfterTheEventUpsert() {
        withWriter((writer, jdbc) -> {
            jdbc.execute("alter table traffic_incident_event_corridor add constraint reject_fixture check (corridor <> 'I70')");
            assertThatThrownBy(() -> writer.publish(batch(0, event("initial"), event("initial"))))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
            for (String table : new String[]{"traffic_incident_event", "traffic_incident_event_observation",
                "traffic_incident_event_transition", "traffic_incident_event_corridor", "traffic_incident_event_corridor_transition"}) {
                assertThat(count(jdbc, table)).as(table).isZero();
            }
        });
    }

    private static void withWriter(java.util.function.BiConsumer<IncidentEventWriter, JdbcTemplate> assertions) {
        String schema = "incident_" + UUID.randomUUID().toString().replace("-", "");
        var dataSource = new DriverManagerDataSource(System.getenv("CTT_PRECISION_DB_URL") + "?currentSchema=" + schema, "postgres", "");
        var jdbc = new JdbcTemplate(dataSource);
        try (var context = new AnnotationConfigApplicationContext()) {
            Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();
            context.register(Transactions.class);
            context.registerBean(JdbcTemplate.class, () -> jdbc);
            context.registerBean(ObjectMapper.class, () -> new ObjectMapper());
            context.registerBean(org.springframework.transaction.PlatformTransactionManager.class,
                () -> new DataSourceTransactionManager(dataSource));
            context.register(IncidentEventWriter.class);
            context.refresh();
            assertions.accept(context.getBean(IncidentEventWriter.class), jdbc);
        } finally {
            jdbc.execute("drop schema if exists " + schema + " cascade");
        }
    }

    private static int count(JdbcTemplate jdbc, String table) {
        return jdbc.queryForObject("select count(*) from " + table, Integer.class);
    }

    private static Map<String, CorridorIncidentSnapshot> batch(int minute, String i25, String i70) {
        var batch = new LinkedHashMap<String, CorridorIncidentSnapshot>();
        Instant at = Instant.parse("2026-11-01T00:00:00Z").plusSeconds(minute * 60L);
        batch.put("I25", new CorridorIncidentSnapshot("I25", "cdot", "incidents", at, null, i25, 1));
        batch.put("I70", new CorridorIncidentSnapshot("I70", "cdot", "incidents", at, null, i70, 1));
        return batch;
    }

    private static String event(String description) {
        return "{\"incidents\":[{\"properties\":{\"providerEventId\":\"shared-event\",\"description\":\""
            + description + "\",\"roadNumber\":\"I-25\",\"marker\":235.4}}]}";
    }
}
