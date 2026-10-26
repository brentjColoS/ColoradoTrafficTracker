package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.*;
import java.time.*;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class FlowPrecisionPersistenceTest {
    @Test
    void bothServicesCarryIdenticalAdditiveMigrations() throws Exception {
        String name="src/main/resources/db/migration/V28__flow_collection_profile.sql";
        assertThat(Files.readAllBytes(Path.of(name)))
            .isEqualTo(Files.readAllBytes(Path.of("../api-service",name)));
    }

    @Test
    @EnabledIfEnvironmentVariable(named="CTT_PRECISION_DB_URL",matches="jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/postgres")
    void upgradesLegacyDataArchivesProfilesAndMarksMixedHoursWithoutBreakingOldReads() {
        String schema="precision_"+UUID.randomUUID().toString().replace("-","");
        var dataSource=new DriverManagerDataSource(System.getenv("CTT_PRECISION_DB_URL")+"?currentSchema="+schema,"postgres","");
        Flyway.configure().dataSource(dataSource).schemas(schema).target("27").load().migrate();
        var jdbc=new JdbcTemplate(dataSource);
        jdbc.update("insert into traffic_sample(corridor,avg_current_speed,polled_at) values('I70',60,'2000-01-01Z'::timestamptz)");
        var flyway=Flyway.configure().dataSource(dataSource).schemas(schema).load();
        flyway.migrate();flyway.validate();
        assertThat(jdbc.queryForObject("select flow_collection_profile from traffic_sample",String.class)).isNull();
        jdbc.update("insert into traffic_sample(corridor,avg_current_speed,polled_at,flow_collection_profile) values('I70',61,'2000-01-02Z'::timestamptz,'fine-test')");
        jdbc.update("""
            insert into traffic_speed_zone_sample(sample_id,corridor,zone_key,zone_order,zone_label,
                start_mile_marker,end_mile_marker,posted_speed_mph,polled_at)
            select id,corridor,'I70-test',1,'Test',206,213,60,polled_at from traffic_sample
            """);
        var transaction=new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        transaction.execute(status -> new TrafficRetentionBatchWriter(jdbc).archiveNext(
            OffsetDateTime.parse("2001-01-01T00:00:00Z"),OffsetDateTime.now(ZoneOffset.UTC),100));
        assertThat(jdbc.queryForObject("select count(*) from traffic_sample",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from traffic_sample_all",Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("select sum(avg_current_speed) from traffic_sample_all",Double.class)).isEqualTo(121.0);
        assertThat(jdbc.queryForObject("select count(*) from traffic_sample_collection_profiles where is_archived",Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("select count(*) from traffic_sample_collection_profiles where flow_collection_profile='fine-test'",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from traffic_sample_collection_profiles where flow_collection_profile is null",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("""
            select count(*) from traffic_speed_zone_sample z join traffic_sample_collection_profiles p
                on p.sample_ref_id=z.sample_id
            """,Integer.class)).isEqualTo(2);

        var writer=new CorridorFlowCellWriter(jdbc);
        transaction.executeWithoutResult(s -> writer.replace(List.of(snapshot("00:01:00","default-test"))));
        transaction.executeWithoutResult(s -> writer.replace(List.of(snapshot("00:02:00","fine-test"))));
        assertThat(jdbc.queryForObject("select flow_collection_profile from traffic_flow_cell_hourly",String.class)).isEqualTo("mixed");
        // A config rollback must retain the mixed-hour boundary, not erase it.
        transaction.executeWithoutResult(s -> writer.replace(List.of(snapshot("00:03:00","default-test"))));
        assertThat(jdbc.queryForObject("select flow_collection_profile from traffic_flow_cell_hourly",String.class)).isEqualTo("mixed");
        assertThat(jdbc.queryForObject("select observation_count from traffic_flow_cell_hourly",Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("select flow_collection_profile from traffic_flow_cell_snapshot_current",String.class)).isEqualTo("default-test");
        // Pre-upgrade writers can omit the nullable column; unknown remains unknown.
        jdbc.update("insert into traffic_sample(corridor,polled_at) values('I25',now())");
        assertThat(jdbc.queryForObject("select flow_collection_profile from traffic_sample",String.class)).isNull();
        transaction.executeWithoutResult(s -> writer.replace(List.of(snapshot("01:01:00",null))));
        transaction.executeWithoutResult(s -> writer.replace(List.of(snapshot("01:02:00","fine-test"))));
        assertThat(jdbc.queryForObject("select flow_collection_profile from traffic_flow_cell_hourly where hour_start='2026-10-26T01:00:00Z'",String.class)).isEqualTo("mixed");
        transaction.executeWithoutResult(s -> writer.replace(List.of(snapshot("02:01:00","fine-test"))));
        transaction.executeWithoutResult(s -> writer.replace(List.of(snapshot("02:02:00","fine-test"))));
        assertThat(jdbc.queryForObject("select flow_collection_profile from traffic_flow_cell_hourly where hour_start='2026-10-26T02:00:00Z'",String.class)).isEqualTo("fine-test");
    }

    private static CorridorFlowCellSnapshot snapshot(String time,String profile) {
        var cell=new CorridorFlowCellSnapshot.Cell("I70:206-206.5",206,206.5,
            CorridorFlowCellSnapshot.Direction.COMBINED,60,1,0,1,0,
            CorridorFlowCellSnapshot.ClosureEvidence.NONE,.5,.5,.5,.5,206,206.5,
            CorridorFlowCellSnapshot.Quality.FULL_CELL);
        return new CorridorFlowCellSnapshot("I70",Instant.parse("2026-10-26T"+time+"Z"),10,"OBSERVED","Test",
            .5,136,1,1,0,List.of(cell),profile);
    }
}
