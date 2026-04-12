package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

@ExtendWith(MockitoExtension.class)
class TimeseriesOptimizationServiceTest {
    @Mock
    private JdbcTemplate jdbcTemplate;

    @Captor
    private ArgumentCaptor<String> sqlCaptor;

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
}
