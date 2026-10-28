package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Clock;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/** Disposable PostgreSQL only: creates session-local tables and never uses production credentials. */
@EnabledIfEnvironmentVariable(named = "CTT_COUNTER_DISPOSABLE_DB_URL", matches = ".+")
class StoredObservationDatabaseTest {
    @Test void countsArchivesWithoutAWindowAndRetentionDoesNotChangeTheTotal() {
        var source = new SingleConnectionDataSource(System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL"),"postgres","",true);
        try {
            JdbcTemplate jdbc = new JdbcTemplate(source);
            jdbc.execute("create temporary table traffic_sample(id bigint, corridor text, polled_at timestamptz default '2026-10-14Z')");
            jdbc.execute("create temporary table traffic_sample_archive(source_id bigint, corridor text, polled_at timestamptz default '2026-04-12Z')");
            jdbc.execute("insert into traffic_sample(id,corridor) values(1,'I25'),(2,'I25'),(3,'I70'),(4,'I80')");
            jdbc.execute("insert into traffic_sample_archive(source_id,corridor) values(10,'I25'),(11,'I70')");
            var repository = new StoredObservationRepository(jdbc,Clock.systemUTC());
            assertEquals(5,repository.totals().total());
            assertEquals(Map.of("I25",3L,"I70",2L),repository.totals().corridors());
            assertEquals(java.time.Instant.parse("2026-04-12T00:00:00Z"), repository.totals().firstObservedAt());
            jdbc.execute("begin");
            jdbc.execute("insert into traffic_sample_archive select id,corridor,polled_at from traffic_sample where id=1");
            jdbc.execute("delete from traffic_sample where id=1");
            jdbc.execute("commit");
            assertEquals(5,repository.totals().total());
            assertEquals(java.time.Instant.parse("2026-04-12T00:00:00Z"), repository.totals().firstObservedAt());
            jdbc.execute("insert into traffic_sample(id,corridor) values(12,'I70')");
            assertEquals(6,repository.totals().total());
            assertEquals(Map.of("I25",3L,"I70",3L),repository.totals().corridors());
        } finally { source.destroy(); }
    }
}
