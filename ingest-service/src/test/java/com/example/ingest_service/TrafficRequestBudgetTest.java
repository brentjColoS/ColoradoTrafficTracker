package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class TrafficRequestBudgetTest {

    @Test
    void reservationsSurviveServiceRecreationAndRespectTheLimit() {
        JdbcTemplate jdbc = budgetDatabase("daily");

        TrafficRequestBudget firstProcess = new TrafficRequestBudget(jdbc);
        TrafficRequestBudget.Reservation first = firstProcess.reserve("tomtom_tile", 30, 50);

        TrafficRequestBudget secondProcess = new TrafficRequestBudget(jdbc);
        TrafficRequestBudget.Reservation blocked = secondProcess.reserve("tomtom_tile", 25, 50);
        TrafficRequestBudget.Reservation second = secondProcess.reserve("tomtom_tile", 20, 50);

        assertThat(first.allowed()).isTrue();
        assertThat(blocked.allowed()).isFalse();
        assertThat(second.allowed()).isTrue();
        assertThat(secondProcess.usedToday("tomtom_tile")).isEqualTo(50);
    }

    @Test
    void monthlyReservationsAreSeparatedByProviderAndProduct() {
        JdbcTemplate jdbc = budgetDatabase("product-split");
        Clock clock = utcClock("2026-07-27T12:00:00Z");
        TrafficRequestBudget budget = new TrafficRequestBudget(jdbc, clock);

        var vector = budget.reserveMonthly("TomTom", "Traffic Vector", 190_000, 195_000);
        var blockedVector = budget.reserveMonthly("tomtom", "traffic vector", 5_001, 195_000);
        var incidentDetails = budget.reserveMonthly("tomtom", "incident details", 2_000, 2_500);
        var cdot = budget.reserveMonthly("cdot", "incidents", 100, 10_000);

        assertThat(vector.allowed()).isTrue();
        assertThat(vector.provider()).isEqualTo("tomtom");
        assertThat(vector.product()).isEqualTo("traffic vector");
        assertThat(blockedVector.allowed()).isFalse();
        assertThat(blockedVector.requestsUsed()).isEqualTo(190_000);
        assertThat(incidentDetails.allowed()).isTrue();
        assertThat(cdot.allowed()).isTrue();
        assertThat(budget.monthlyUsage("tomtom", "traffic vector").requestsUsed()).isEqualTo(190_000);
        assertThat(budget.monthlyUsage("tomtom", "incident details").requestsUsed()).isEqualTo(2_000);
        assertThat(budget.monthlyUsage("cdot", "incidents").requestsUsed()).isEqualTo(100);
    }

    @Test
    void monthlyReservationsAreSeparatedByAccount() {
        JdbcTemplate jdbc = budgetDatabase("account-split");
        Clock clock = utcClock("2026-07-27T12:00:00Z");
        TrafficRequestBudget budget = new TrafficRequestBudget(jdbc, clock);

        var primary = budget.reserveMonthlyForAccount(
            "tomtom",
            "primary",
            "traffic vector",
            190_000,
            195_000
        );
        var secondary = budget.reserveMonthlyForAccount(
            "tomtom",
            "secondary",
            "traffic vector",
            20_000,
            195_000
        );
        var blockedPrimary = budget.reserveMonthlyForAccount(
            "tomtom",
            "primary",
            "traffic vector",
            5_001,
            195_000
        );

        assertThat(primary.allowed()).isTrue();
        assertThat(primary.accountId()).isEqualTo("primary");
        assertThat(secondary.allowed()).isTrue();
        assertThat(secondary.accountId()).isEqualTo("secondary");
        assertThat(blockedPrimary.allowed()).isFalse();

        budget.releaseMonthly(secondary, 5_000);

        assertThat(budget.monthlyUsageForAccount("tomtom", "primary", "traffic vector").requestsUsed())
            .isEqualTo(190_000);
        assertThat(budget.monthlyUsageForAccount("tomtom", "secondary", "traffic vector").requestsUsed())
            .isEqualTo(15_000);
    }

    @Test
    void anExistingMonthlyCounterCanBeReservedInsideATransaction() {
        JdbcTemplate jdbc = budgetDatabase("existing-monthly-counter");
        Clock clock = utcClock("2026-07-27T12:00:00Z");
        TrafficRequestBudget budget = new TrafficRequestBudget(jdbc, clock);
        budget.reserveMonthlyForAccount("tomtom", "primary", "traffic vector", 1, 100);

        var transaction = new TransactionTemplate(
            new DataSourceTransactionManager(jdbc.getDataSource())
        );
        var reservation = transaction.execute(ignored ->
            budget.reserveMonthlyForAccount("tomtom", "primary", "traffic vector", 1, 100)
        );

        assertThat(reservation).isNotNull();
        assertThat(reservation.allowed()).isTrue();
        assertThat(reservation.requestsUsed()).isEqualTo(2);
    }

    @Test
    void monthlyPeriodsCoverEveryCalendarMonthLength() {
        List<PeriodExpectation> expectations = List.of(
            new PeriodExpectation("2026-02-12T00:00:00Z", "2026-02-01", "2026-03-01", 28),
            new PeriodExpectation("2028-02-12T00:00:00Z", "2028-02-01", "2028-03-01", 29),
            new PeriodExpectation("2026-04-12T00:00:00Z", "2026-04-01", "2026-05-01", 30),
            new PeriodExpectation("2026-07-12T00:00:00Z", "2026-07-01", "2026-08-01", 31)
        );

        for (int i = 0; i < expectations.size(); i++) {
            PeriodExpectation expected = expectations.get(i);
            TrafficRequestBudget budget = new TrafficRequestBudget(
                budgetDatabase("month-length-" + i),
                utcClock(expected.instant())
            );

            var reservation = budget.reserveMonthly("tomtom", "traffic vector", 1, 195_000);

            assertThat(reservation.periodStart()).isEqualTo(LocalDate.parse(expected.start()));
            assertThat(reservation.periodEnd()).isEqualTo(LocalDate.parse(expected.end()));
            assertThat(reservation.periodEnd().toEpochDay() - reservation.periodStart().toEpochDay())
                .isEqualTo(expected.days());
        }
    }

    @Test
    void concurrentMonthlyReservationsCannotCrossTheHardStop() throws Exception {
        JdbcTemplate jdbc = budgetDatabase("concurrent");
        Clock clock = utcClock("2026-07-27T12:00:00Z");
        var executor = Executors.newFixedThreadPool(8);
        try {
            List<Callable<TrafficRequestBudget.MonthlyReservation>> attempts = java.util.stream.IntStream.range(0, 20)
                .mapToObj(ignored -> (Callable<TrafficRequestBudget.MonthlyReservation>) () ->
                    new TrafficRequestBudget(jdbc, clock)
                        .reserveMonthly("tomtom", "traffic vector", 10, 100)
                )
                .toList();

            long allowed = executor.invokeAll(attempts).stream()
                .map(future -> {
                    try {
                        return future.get();
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                })
                .filter(TrafficRequestBudget.MonthlyReservation::allowed)
                .count();

            assertThat(allowed).isEqualTo(10);
            assertThat(new TrafficRequestBudget(jdbc, clock)
                .monthlyUsage("tomtom", "traffic vector")
                .requestsUsed()).isEqualTo(100);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void unusedCallsAreReleasedFromTheMonthTheyWereReserved() {
        JdbcTemplate jdbc = budgetDatabase("month-boundary-release");
        TrafficRequestBudget januaryBudget = new TrafficRequestBudget(
            jdbc,
            utcClock("2026-01-31T23:59:59Z")
        );
        var januaryReservation = januaryBudget.reserveMonthly("tomtom", "traffic vector", 30, 100);

        TrafficRequestBudget februaryBudget = new TrafficRequestBudget(
            jdbc,
            utcClock("2026-02-01T00:00:01Z")
        );
        februaryBudget.releaseMonthly(januaryReservation, 10);

        assertThat(januaryBudget.monthlyUsage("tomtom", "traffic vector").requestsUsed()).isEqualTo(20);
        assertThat(februaryBudget.monthlyUsage("tomtom", "traffic vector").requestsUsed()).isZero();
    }

    private static JdbcTemplate budgetDatabase(String name) {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:request-budget-" + name + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
            create table traffic_provider_request_budget (
                budget_day date not null,
                budget_key varchar(64) not null,
                requests_used bigint not null default 0,
                updated_at timestamp with time zone not null default now(),
                primary key (budget_day, budget_key)
            )
            """);
        jdbc.execute("""
            create table traffic_provider_request_budget_monthly (
                period_start date not null,
                period_end date not null,
                provider varchar(64) not null,
                account_id varchar(64) not null default 'primary',
                product varchar(96) not null,
                requests_used bigint not null default 0,
                updated_at timestamp with time zone not null default now(),
                primary key (period_start, provider, account_id, product)
            )
            """);
        return jdbc;
    }

    private static Clock utcClock(String instant) {
        return Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
    }

    private record PeriodExpectation(String instant, String start, String end, int days) {}
}
