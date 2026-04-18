package com.example.ingest_service;

import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class TimeseriesOptimizationService implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(TimeseriesOptimizationService.class);
    private static final String SAMPLE_TABLE = "traffic_sample";
    private static final String ARCHIVE_TABLE = "traffic_sample_archive";

    private final JdbcTemplate jdbcTemplate;
    private final TrafficTimeseriesProps props;

    private volatile TimeseriesOptimizationStatus status = new TimeseriesOptimizationStatus(
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        "unknown",
        "Timeseries optimization has not run yet"
    );

    public TimeseriesOptimizationService(JdbcTemplate jdbcTemplate, TrafficTimeseriesProps props) {
        this.jdbcTemplate = jdbcTemplate;
        this.props = props;
    }

    @Override
    public void run(ApplicationArguments args) {
        applyOptimizations();
    }

    public TimeseriesOptimizationStatus statusSnapshot() {
        return status;
    }

    void applyOptimizations() {
        if (!props.enabled()) {
            status = new TimeseriesOptimizationStatus(
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                "disabled",
                "Timeseries optimization is disabled by configuration"
            );
            return;
        }

        String databaseVersion = safeStringQuery("select version()", "unknown");
        boolean postgresCompatible = databaseVersion != null && databaseVersion.toLowerCase().contains("postgresql");
        if (!postgresCompatible) {
            status = new TimeseriesOptimizationStatus(
                true,
                false,
                false,
                false,
                false,
                false,
                false,
                databaseVersion,
                "Skipping Timescale optimization because the active database is not PostgreSQL"
            );
            return;
        }

        boolean timescaleAvailable = Boolean.TRUE.equals(safeBooleanQuery(
            "select exists (select 1 from pg_available_extensions where name = 'timescaledb')"
        ));
        if (!timescaleAvailable) {
            status = new TimeseriesOptimizationStatus(
                true,
                true,
                false,
                false,
                false,
                false,
                false,
                databaseVersion,
                "Skipping Timescale optimization because the timescaledb extension is unavailable"
            );
            return;
        }

        boolean hypertablesConfigured = false;
        boolean compressionConfigured = false;
        boolean continuousAggregatesConfigured = false;
        List<String> skippedSteps = new ArrayList<>();
        List<String> incompatibleConstraints = incompatibleHypertableConstraints();

        if (!incompatibleConstraints.isEmpty()) {
            if (props.createHypertables()) skippedSteps.add("hypertables");
            if (props.enableCompression()) skippedSteps.add("compression");
            if (props.createContinuousAggregates()) skippedSteps.add("continuous aggregates");

            status = new TimeseriesOptimizationStatus(
                true,
                true,
                true,
                false,
                false,
                false,
                false,
                databaseVersion,
                "Skipping Timescale optimization because partition-incompatible constraints do not include polled_at: "
                    + String.join(", ", incompatibleConstraints)
            );
            return;
        }

        try {
            jdbcTemplate.execute("create extension if not exists timescaledb");

            if (props.createHypertables()) {
                boolean sampleHypertableCreated = safeExecute(
                    "select create_hypertable('" + SAMPLE_TABLE + "', 'polled_at', if_not_exists => TRUE, migrate_data => TRUE)"
                );
                boolean archiveHypertableCreated = safeExecute(
                    "select create_hypertable('" + ARCHIVE_TABLE + "', 'polled_at', if_not_exists => TRUE, migrate_data => TRUE)"
                );
                hypertablesConfigured = sampleHypertableCreated && archiveHypertableCreated;
                if (!hypertablesConfigured) skippedSteps.add("hypertables");
            }

            if (props.enableCompression()) {
                boolean sampleCompressionEnabled = safeExecute(
                    "alter table " + SAMPLE_TABLE + " set (timescaledb.compress, timescaledb.compress_segmentby = 'corridor')"
                );
                boolean archiveCompressionEnabled = safeExecute(
                    "alter table " + ARCHIVE_TABLE + " set (timescaledb.compress, timescaledb.compress_segmentby = 'corridor')"
                );
                boolean sampleCompressionPolicyAdded = safeExecute(
                    "select add_compression_policy('" + SAMPLE_TABLE + "', interval '" + Math.max(1, props.compressionAfterDays()) + " days', if_not_exists => TRUE)"
                );
                boolean archiveCompressionPolicyAdded = safeExecute(
                    "select add_compression_policy('" + ARCHIVE_TABLE + "', interval '" + Math.max(1, props.compressionAfterDays()) + " days', if_not_exists => TRUE)"
                );
                compressionConfigured = sampleCompressionEnabled
                    && archiveCompressionEnabled
                    && sampleCompressionPolicyAdded
                    && archiveCompressionPolicyAdded;
                if (!compressionConfigured) skippedSteps.add("compression");
            }

            if (props.createContinuousAggregates()) {
                boolean fiveMinuteAggregateCreated = safeExecute(
                    """
                    create materialized view if not exists traffic_sample_5m_cagg
                    with (timescaledb.continuous) as
                    select
                        corridor,
                        time_bucket(interval '5 minutes', polled_at) as bucket_start,
                        count(*) as sample_count,
                        avg(avg_current_speed) as avg_current_speed,
                        avg(speed_stddev) as avg_speed_stddev,
                        sum(incident_count) as total_incidents
                    from """
                        + SAMPLE_TABLE
                        + """
                    group by corridor, bucket_start
                    with no data
                    """
                );
                boolean hourlyAggregateCreated = safeExecute(
                    """
                    create materialized view if not exists traffic_sample_hourly_cagg
                    with (timescaledb.continuous) as
                    select
                        corridor,
                        time_bucket(interval '1 hour', polled_at) as bucket_start,
                        count(*) as sample_count,
                        avg(avg_current_speed) as avg_current_speed,
                        avg(speed_stddev) as avg_speed_stddev,
                        sum(incident_count) as total_incidents
                    from """
                        + SAMPLE_TABLE
                        + """
                    group by corridor, bucket_start
                    with no data
                    """
                );
                continuousAggregatesConfigured = fiveMinuteAggregateCreated && hourlyAggregateCreated;
                if (!continuousAggregatesConfigured) skippedSteps.add("continuous aggregates");
            }

            boolean optimized = skippedSteps.isEmpty();
            String message = optimized
                ? "Timeseries optimization applied successfully"
                : "Timeseries optimization completed with skipped steps: " + String.join(", ", skippedSteps);

            status = new TimeseriesOptimizationStatus(
                true,
                true,
                true,
                optimized,
                hypertablesConfigured,
                compressionConfigured,
                continuousAggregatesConfigured,
                databaseVersion,
                message
            );
        } catch (Exception e) {
            log.warn("Timeseries optimization did not complete cleanly: {}", e.toString());
            status = new TimeseriesOptimizationStatus(
                true,
                true,
                true,
                false,
                hypertablesConfigured,
                compressionConfigured,
                continuousAggregatesConfigured,
                databaseVersion,
                "Timeseries optimization failed: " + e.getMessage()
            );
        }
    }

    private String safeStringQuery(String sql, String fallback) {
        try {
            String value = jdbcTemplate.queryForObject(sql, String.class);
            return value == null ? fallback : value;
        } catch (Exception e) {
            return fallback;
        }
    }

    private Boolean safeBooleanQuery(String sql) {
        try {
            return jdbcTemplate.queryForObject(sql, Boolean.class);
        } catch (Exception e) {
            return false;
        }
    }

    private List<String> incompatibleHypertableConstraints() {
        List<String> incompatible = new ArrayList<>();
        incompatible.addAll(incompatibleHypertableConstraints(SAMPLE_TABLE));
        incompatible.addAll(incompatibleHypertableConstraints(ARCHIVE_TABLE));
        return incompatible;
    }

    private List<String> incompatibleHypertableConstraints(String tableName) {
        try {
            return jdbcTemplate.queryForList(
                """
                select tc.constraint_name || '(' || string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) || ')'
                from information_schema.table_constraints tc
                join information_schema.key_column_usage kcu
                  on tc.constraint_name = kcu.constraint_name
                 and tc.table_schema = kcu.table_schema
                 and tc.table_name = kcu.table_name
                where tc.table_schema = current_schema()
                  and tc.table_name = ?
                  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
                group by tc.constraint_name
                having bool_or(kcu.column_name = 'polled_at') = false
                """,
                String.class,
                tableName
            ).stream().map(constraint -> tableName + "." + constraint).toList();
        } catch (Exception e) {
            log.info("Unable to inspect hypertable constraints for [{}]: {}", tableName, e.toString());
            return List.of();
        }
    }

    private boolean safeExecute(String sql) {
        try {
            jdbcTemplate.execute(sql);
            return true;
        } catch (Exception e) {
            log.info("Skipping optional Timescale statement [{}]: {}", sql, e.toString());
            return false;
        }
    }
}
