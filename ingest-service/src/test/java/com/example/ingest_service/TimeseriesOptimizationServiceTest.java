package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

@ExtendWith(MockitoExtension.class)
class TimeseriesOptimizationServiceTest {
    @Mock
    private JdbcTemplate jdbcTemplate;

    @Test
    void skipsWhenFeatureDisabled() {
        TimeseriesOptimizationService service = new TimeseriesOptimizationService(
            jdbcTemplate,
            new TrafficTimeseriesProps(false, true, true, true, 7)
        );

        service.applyOptimizations();

        assertThat(service.statusSnapshot().enabled()).isFalse();
        verify(jdbcTemplate, never()).queryForObject("select version()", String.class);
    }

    @Test
    void skipsOnNonPostgresDatabases() {
        when(jdbcTemplate.queryForObject("select version()", String.class)).thenReturn("H2 2.3.232");

        TimeseriesOptimizationService service = new TimeseriesOptimizationService(
            jdbcTemplate,
            new TrafficTimeseriesProps(true, true, true, true, 7)
        );

        service.applyOptimizations();

        assertThat(service.statusSnapshot().postgresCompatible()).isFalse();
        assertThat(service.statusSnapshot().optimized()).isFalse();
        verify(jdbcTemplate, never()).queryForObject(
            "select exists (select 1 from pg_available_extensions where name = 'timescaledb')",
            Boolean.class
        );
    }

    @Test
    void appliesTimescaleStatementsWhenExtensionIsAvailable() {
        when(jdbcTemplate.queryForObject("select version()", String.class)).thenReturn("PostgreSQL 16 with TimescaleDB");
        when(jdbcTemplate.queryForObject(
            "select exists (select 1 from pg_available_extensions where name = 'timescaledb')",
            Boolean.class
        )).thenReturn(true);
        when(jdbcTemplate.queryForList(anyString(), eq(String.class), eq("traffic_sample"))).thenReturn(java.util.List.of());
        when(jdbcTemplate.queryForList(anyString(), eq(String.class), eq("traffic_sample_archive"))).thenReturn(java.util.List.of());

        TimeseriesOptimizationService service = new TimeseriesOptimizationService(
            jdbcTemplate,
            new TrafficTimeseriesProps(true, true, true, true, 7)
        );

        service.applyOptimizations();

        assertThat(service.statusSnapshot().optimized()).isTrue();
        assertThat(service.statusSnapshot().hypertablesConfigured()).isTrue();
        assertThat(service.statusSnapshot().compressionConfigured()).isTrue();
        assertThat(service.statusSnapshot().continuousAggregatesConfigured()).isTrue();
        verify(jdbcTemplate).execute("create extension if not exists timescaledb");
    }

    @Test
    void reportsDegradedWhenOptionalTimescaleStepsAreSkipped() {
        when(jdbcTemplate.queryForObject("select version()", String.class)).thenReturn("PostgreSQL 16 with TimescaleDB");
        when(jdbcTemplate.queryForObject(
            "select exists (select 1 from pg_available_extensions where name = 'timescaledb')",
            Boolean.class
        )).thenReturn(true);
        when(jdbcTemplate.queryForList(anyString(), eq(String.class), eq("traffic_sample"))).thenReturn(java.util.List.of());
        when(jdbcTemplate.queryForList(anyString(), eq(String.class), eq("traffic_sample_archive"))).thenReturn(java.util.List.of());
        org.mockito.Mockito.doAnswer(invocation -> {
            String sql = invocation.getArgument(0, String.class);
            if ("alter table traffic_sample set (timescaledb.compress, timescaledb.compress_segmentby = 'corridor')".equals(sql)) {
                throw new RuntimeException("not a hypertable");
            }
            return null;
        }).when(jdbcTemplate).execute(anyString());

        TimeseriesOptimizationService service = new TimeseriesOptimizationService(
            jdbcTemplate,
            new TrafficTimeseriesProps(true, true, true, true, 7)
        );

        service.applyOptimizations();

        assertThat(service.statusSnapshot().optimized()).isFalse();
        assertThat(service.statusSnapshot().compressionConfigured()).isFalse();
        assertThat(service.statusSnapshot().message()).contains("compression");
    }

    @Test
    void skipsTimescaleStepsWhenUniqueConstraintsDoNotIncludePartitionColumn() {
        when(jdbcTemplate.queryForObject("select version()", String.class)).thenReturn("PostgreSQL 16 with TimescaleDB");
        when(jdbcTemplate.queryForObject(
            "select exists (select 1 from pg_available_extensions where name = 'timescaledb')",
            Boolean.class
        )).thenReturn(true);
        when(jdbcTemplate.queryForList(anyString(), eq(String.class), eq("traffic_sample")))
            .thenReturn(java.util.List.of("traffic_sample_pkey(id)"));
        when(jdbcTemplate.queryForList(anyString(), eq(String.class), eq("traffic_sample_archive")))
            .thenReturn(java.util.List.of("traffic_sample_archive_source_id_key(source_id)"));

        TimeseriesOptimizationService service = new TimeseriesOptimizationService(
            jdbcTemplate,
            new TrafficTimeseriesProps(true, true, true, true, 7)
        );

        service.applyOptimizations();

        assertThat(service.statusSnapshot().optimized()).isFalse();
        assertThat(service.statusSnapshot().hypertablesConfigured()).isFalse();
        assertThat(service.statusSnapshot().compressionConfigured()).isFalse();
        assertThat(service.statusSnapshot().continuousAggregatesConfigured()).isFalse();
        assertThat(service.statusSnapshot().message()).contains("partition-incompatible constraints");
        assertThat(service.statusSnapshot().message()).contains("traffic_sample.traffic_sample_pkey(id)");
        assertThat(service.statusSnapshot().message()).contains("traffic_sample_archive.traffic_sample_archive_source_id_key(source_id)");
        verify(jdbcTemplate, never()).execute("create extension if not exists timescaledb");
    }
}
