package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

class TrafficRequestBudgetPostgresTest {
    @Test
    @EnabledIfEnvironmentVariable(named = "CTT_PRECISION_DB_URL", matches = "jdbc:postgresql://127\\.0\\.0\\.1:[0-9]+/postgres")
    void competingConnectionsCannotOverspendOrRefundAnotherQuotaBucket() throws Exception {
        String schema = "quota_test_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getenv("CTT_PRECISION_DB_URL");
        var source = new DriverManagerDataSource(url + "?currentSchema=" + schema, "postgres", "");
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, "postgres", ""));
        var clock = Clock.fixed(Instant.parse("2026-01-31T23:59:59Z"), ZoneOffset.UTC);
        var january = new TrafficRequestBudget(new JdbcTemplate(source), clock);
        var february = new TrafficRequestBudget(new JdbcTemplate(source),
            Clock.fixed(Instant.parse("2026-02-01T00:00:01Z"), ZoneOffset.UTC));
        try {
            Flyway.configure().dataSource(source).schemas(schema).load().migrate();
            int limit = 70;
            List<TrafficRequestBudget.MonthlyReservation> reservations = race(source, clock, limit);
            var accepted = reservations.stream().filter(TrafficRequestBudget.MonthlyReservation::allowed).toList();
            assertThat(accepted).hasSize(7).allSatisfy(row -> {
                assertThat(row.callsReserved()).isEqualTo(10);
                assertThat(row.periodStart()).isEqualTo(LocalDate.of(2026, 1, 1));
                assertThat(row.provider()).isEqualTo("tomtom");
                assertThat(row.accountId()).isEqualTo("primary");
                assertThat(row.product()).isEqualTo("traffic vector");
            });
            assertThat(reservations).filteredOn(row -> !row.allowed()).hasSize(5)
                .allSatisfy(row -> assertThat(row.callsReserved()).isZero());
            assertThat(january.monthlyUsage("tomtom", "traffic vector").requestsUsed()).isEqualTo(limit);
            assertThat(january.reserveMonthly("tomtom", "traffic vector", 1, limit).allowed()).isFalse();

            assertThat(january.reserveMonthlyForAccount("tomtom", "secondary", "traffic vector", 9, limit).allowed()).isTrue();
            assertThat(january.reserveMonthly("tomtom", "incident details", 8, limit).allowed()).isTrue();
            assertThat(january.reserveMonthly("cdot", "traffic vector", 7, limit).allowed()).isTrue();
            assertThat(february.reserveMonthly("tomtom", "traffic vector", 6, limit).allowed()).isTrue();
            february.releaseMonthly(reservations.stream().filter(row -> !row.allowed()).findFirst().orElseThrow(), 3);
            assertThat(january.monthlyUsage("tomtom", "traffic vector").requestsUsed()).isEqualTo(limit);
            february.releaseMonthly(accepted.getFirst(), 3);
            assertThat(january.monthlyUsage("tomtom", "traffic vector").requestsUsed()).isEqualTo(limit - 3);
            assertThat(january.monthlyUsageForAccount("tomtom", "secondary", "traffic vector").requestsUsed()).isEqualTo(9);
            assertThat(january.monthlyUsage("tomtom", "incident details").requestsUsed()).isEqualTo(8);
            assertThat(january.monthlyUsage("cdot", "traffic vector").requestsUsed()).isEqualTo(7);
            assertThat(february.monthlyUsage("tomtom", "traffic vector").requestsUsed()).isEqualTo(6);
        } finally {
            admin.execute("drop schema if exists " + schema + " cascade");
        }
    }

    private static List<TrafficRequestBudget.MonthlyReservation> race(DriverManagerDataSource source, Clock clock,
        int limit) throws Exception {
        int attempts = 12;
        var workers = Executors.newFixedThreadPool(attempts);
        var connected = new CountDownLatch(attempts);
        var start = new CountDownLatch(1);
        List<Future<TrafficRequestBudget.MonthlyReservation>> work = new ArrayList<>();
        try {
            for (int i = 0; i < attempts; i++) {
                work.add(workers.submit(() -> {
                    try (var connection = source.getConnection()) {
                        var budget = new TrafficRequestBudget(new JdbcTemplate(new SingleConnectionDataSource(connection, true)), clock);
                        connected.countDown();
                        assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
                        return budget.reserveMonthly("tomtom", "traffic vector", 10, limit);
                    }
                }));
            }
            assertThat(connected.await(5, TimeUnit.SECONDS)).as("independent connections ready to race").isTrue();
            start.countDown();
            List<TrafficRequestBudget.MonthlyReservation> results = new ArrayList<>();
            for (var attempt : work) results.add(attempt.get(5, TimeUnit.SECONDS));
            return results;
        } finally {
            workers.shutdownNow();
            assertThat(workers.awaitTermination(5, TimeUnit.SECONDS)).as("all race workers stopped").isTrue();
        }
    }
}
