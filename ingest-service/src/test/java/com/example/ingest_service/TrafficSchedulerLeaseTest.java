package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

class TrafficSchedulerLeaseTest {

    @Test
    void runsOnceAndStoresTheNextEligibleTime() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.update(anyString(), any(Object[].class))).thenReturn(1);
        TrafficSchedulerLease lease = new TrafficSchedulerLease(jdbcTemplate, "instance-one");
        AtomicInteger runs = new AtomicInteger();

        boolean acquired = lease.tryRun(
            "traffic-flow",
            Duration.ofSeconds(125),
            Duration.ofMinutes(2),
            runs::incrementAndGet
        );

        assertThat(acquired).isTrue();
        assertThat(runs).hasValue(1);
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate, times(3)).update(sql.capture(), any(Object[].class));
        assertThat(sql.getAllValues().get(1))
            .contains("lease_until <= now()")
            .contains("next_run_at <= now()");
        assertThat(sql.getAllValues().get(2))
            .contains("next_run_at = now()")
            .contains("owner_id = ?");
    }

    @Test
    void doesNotRunWhenAnotherInstanceOwnsTheWindow() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.update(anyString(), any(Object[].class)))
            .thenReturn(1, 0);
        TrafficSchedulerLease lease = new TrafficSchedulerLease(jdbcTemplate, "instance-two");
        AtomicInteger runs = new AtomicInteger();

        boolean acquired = lease.tryRun(
            "traffic-incidents",
            Duration.ofMinutes(15),
            Duration.ofMinutes(5),
            runs::incrementAndGet
        );

        assertThat(acquired).isFalse();
        assertThat(runs).hasValue(0);
        verify(jdbcTemplate, times(2)).update(anyString(), any(Object[].class));
    }

    @Test
    void releasesTheLeaseAfterAFailedRun() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.update(anyString(), any(Object[].class))).thenReturn(1);
        TrafficSchedulerLease lease = new TrafficSchedulerLease(jdbcTemplate, "instance-three");

        assertThatThrownBy(() -> lease.tryRun(
            "traffic-flow",
            Duration.ofSeconds(125),
            Duration.ofMinutes(2),
            () -> {
                throw new IllegalStateException("provider unavailable");
            }
        )).isInstanceOf(IllegalStateException.class);

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate, times(3)).update(sql.capture(), any(Object[].class));
        assertThat(sql.getAllValues().get(2))
            .contains("owner_id = null")
            .contains("next_run_at = now()");
    }
}
