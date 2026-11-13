package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;

/** Compare real repository queries with the existing hourly view using session-local synthetic rows. */
@EnabledIfEnvironmentVariable(named = "CTT_COUNTER_DISPOSABLE_DB_URL", matches = ".+")
class TrafficAnalyticsDatabaseTest {
    @Test void boundedReadsPreserveCompleteBucketsNullSpeedsAndArchiveCounts() {
        var source = new SingleConnectionDataSource(System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL"), "postgres", "", true);
        var factory = new LocalContainerEntityManagerFactoryBean();
        try {
            var jdbc = new JdbcTemplate(source);
            jdbc.setQueryTimeout(10);
            jdbc.execute("""
                create temporary table traffic_sample_all (
                    corridor text, polled_at timestamptz, avg_current_speed double precision,
                    avg_freeflow_speed double precision, min_current_speed double precision,
                    confidence double precision, speed_stddev double precision, p50_speed double precision,
                    p90_speed double precision, incident_count int, is_archived boolean)
                """);
            jdbc.execute("""
                insert into traffic_sample_all
                select corridor, time, case when n % 7 = 0 then null else 40.0 + n % 20 end,
                    65, 20 + n % 10, 0.9, case when n % 5 = 0 then null else 3.0 end,
                    45, 60, n % 4, n % 2 = 0
                from generate_series(timestamptz '2026-10-31 00:00Z', timestamptz '2026-11-03 00:00Z', interval '10 minutes')
                    with ordinality as times(time, n)
                cross join (values ('I25'), ('I70')) as corridors(corridor)
                """);
            jdbc.execute("""
                insert into traffic_sample_all values
                    ('I25', '2026-11-01 06:00Z', null, 70, null, null, null, null, null, 2, true),
                    ('I25', '2026-11-01 06:59:59.999999Z', 91, 100, 80, 1, 4, 88, 99, 3, false),
                    ('I25', '2026-11-04 00:00Z', null, 70, null, null, null, null, null, 1, true),
                    ('I25', '2026-11-05 00:00Z', 72, 75, 60, 1, 3, 70, 75, 0, false)
                """);
            // Reference is the unchanged V11 hourly view, including null-speed rows in sample_count.
            jdbc.execute("""
                create temporary view traffic_corridor_hourly_rollup as
                select corridor, date_trunc('hour', polled_at) as bucket_start,
                    count(*) as sample_count, avg(avg_current_speed) as avg_current_speed,
                    avg(avg_freeflow_speed) as avg_freeflow_speed, min(min_current_speed) as min_current_speed,
                    avg(confidence) as avg_confidence, avg(speed_stddev) as avg_speed_stddev,
                    avg(p50_speed) as avg_p50_speed, avg(p90_speed) as avg_p90_speed,
                    sum(incident_count) as total_incidents,
                    sum(case when is_archived then 1 else 0 end) as archived_sample_count
                from traffic_sample_all group by corridor, date_trunc('hour', polled_at)
                """);
            factory.setDataSource(source);
            factory.setManagedTypes(PersistenceManagedTypes.of(TrafficHistorySample.class.getName()));
            factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
            factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto", "none", "jakarta.persistence.query.timeout", "10000"));
            factory.afterPropertiesSet();
            var manager = factory.getObject().createEntityManager();
            try {
                var repository = new JpaRepositoryFactory(manager).getRepository(TrafficAnalyticsRepository.class);
                for (String timezone : List.of("UTC", "America/Denver")) {
                    jdbc.execute("set time zone '" + timezone + "'");
                    for (String corridor : List.of("I25", "I70", "EMPTY")) {
                        for (String[] bounds : List.of(
                            new String[]{"2026-11-01T06:00:00Z", "2026-11-01T09:00:00Z"},
                            new String[]{"2026-11-01T06:00:00.000001Z", "2026-11-01T08:30:00Z"},
                            new String[]{"2026-11-01T06:59:59.999999Z", "2026-11-01T09:00:00Z"},
                            new String[]{"2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z"})) {
                            var since = OffsetDateTime.parse(bounds[0]);
                            var until = OffsetDateTime.parse(bounds[1]);
                            var params = Map.of("corridor", corridor, "since", since, "until", until, "limit", 2);
                            String base = TrafficAnalyticsRepository.TREND_PROJECTION
                                + " from traffic_corridor_hourly_rollup where corridor=:corridor and bucket_start >= :since";
                            assertParity(jdbc, base + " order by bucket_start desc limit :limit", params,
                                repository.findTrend(corridor, since, 2));
                            assertParity(jdbc, base + " and avg_current_speed is not null order by bucket_start desc limit :limit", params,
                                repository.findTrendWithSpeed(corridor, since, 2));
                            assertParity(jdbc, base + " and bucket_start <= :until order by bucket_start desc limit :limit", params,
                                repository.findTrendBetween(corridor, since, until, 2));
                            assertParity(jdbc, base + " and bucket_start <= :until and avg_current_speed is not null order by bucket_start desc limit :limit", params,
                                repository.findTrendWithSpeedBetween(corridor, since, until, 2));
                            assertParity(jdbc, base + " and bucket_start < :until and avg_current_speed is not null order by bucket_start asc", params,
                                repository.findBaselineHistoryBetween(corridor, since, until));
                        }
                    }
                }
            } finally { manager.close(); }
        } finally { factory.destroy(); source.destroy(); }
    }

    private void assertParity(JdbcTemplate jdbc, String sql, Map<String, ?> params, List<TrafficCorridorTrendProjection> actual) {
        var expected = new NamedParameterJdbcTemplate(jdbc).queryForList(sql, params);
        assertEquals(expected.size(), actual.size());
        for (int i = 0; i < actual.size(); i++) {
            var row = actual.get(i);
            var reference = expected.get(i);
            assertEquals(reference.get("corridor"), row.getCorridor());
            assertEquals(((java.sql.Timestamp) reference.get("bucketStart")).toInstant(), row.getBucketStart());
            assertEquals(((Number) reference.get("sampleCount")).longValue(), row.getSampleCount());
            assertEquals(((Number) reference.get("totalIncidents")).longValue(), row.getTotalIncidents());
            assertEquals(((Number) reference.get("archivedSampleCount")).longValue(), row.getArchivedSampleCount());
            assertNumber(reference, "avgCurrentSpeed", row.getAvgCurrentSpeed());
            assertNumber(reference, "avgFreeflowSpeed", row.getAvgFreeflowSpeed());
            assertNumber(reference, "minCurrentSpeed", row.getMinCurrentSpeed());
            assertNumber(reference, "avgConfidence", row.getAvgConfidence());
            assertNumber(reference, "avgSpeedStddev", row.getAvgSpeedStddev());
            assertNumber(reference, "avgP50Speed", row.getAvgP50Speed());
            assertNumber(reference, "avgP90Speed", row.getAvgP90Speed());
        }
    }

    private void assertNumber(Map<String, Object> reference, String key, Double actual) {
        if (reference.get(key) == null) assertNull(actual, key);
        else { assertNotNull(actual, key); assertEquals(((Number) reference.get(key)).doubleValue(), actual, 1e-9, key); }
    }
}
