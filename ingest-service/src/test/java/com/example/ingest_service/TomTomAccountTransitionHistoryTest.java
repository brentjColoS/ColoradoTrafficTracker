package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class TomTomAccountTransitionHistoryTest {

    @Test
    void recordsOnlyInitialHandoffAndMonthBoundarySelections() {
        JdbcTemplate jdbc = transitionDatabase("sequence");
        TomTomAccountTransitionHistory history = new TomTomAccountTransitionHistory(
            jdbc,
            Clock.fixed(Instant.parse("2026-08-01T00:00:05Z"), ZoneOffset.UTC)
        );

        history.record(reservation("primary", "primary-secret", "2026-07-01", "2026-08-01", 8));
        history.record(reservation("primary", "primary-secret", "2026-07-01", "2026-08-01", 16));
        history.record(reservation("secondary", "secondary-secret", "2026-07-01", "2026-08-01", 8));
        history.record(reservation("primary", "primary-secret", "2026-08-01", "2026-09-01", 8));

        List<TomTomAccountTransitionEvent> events = history.recent(90);

        assertThat(events)
            .extracting(TomTomAccountTransitionEvent::eventType)
            .containsExactly(
                TomTomAccountTransitionType.MONTH_BOUNDARY,
                TomTomAccountTransitionType.ACCOUNT_HANDOFF,
                TomTomAccountTransitionType.INITIAL_SELECTION
            );
        assertThat(events.get(1)).satisfies(event -> {
            assertThat(event.fromAccountId()).isEqualTo("primary");
            assertThat(event.toAccountId()).isEqualTo("secondary");
            assertThat(event.fromAccountRequestsUsed()).isEqualTo(16);
            assertThat(event.toAccountRequestsUsed()).isEqualTo(8);
        });
        assertThat(events.toString())
            .doesNotContain("primary-secret")
            .doesNotContain("secondary-secret");
    }

    @Test
    void boundsHistoryReads() {
        JdbcTemplate jdbc = transitionDatabase("limit");
        TomTomAccountTransitionHistory history = new TomTomAccountTransitionHistory(
            jdbc,
            Clock.systemUTC()
        );
        history.record(reservation("primary", "secret", "2026-08-01", "2026-09-01", 8));

        assertThat(history.recent(0)).hasSize(1);
        assertThat(history.recent(500)).hasSize(1);
    }

    private static TomTomAccountQuotaManager.AccountReservation reservation(
        String accountId,
        String apiKey,
        String periodStart,
        String periodEnd,
        long requestsUsed
    ) {
        return new TomTomAccountQuotaManager.AccountReservation(
            new TomTomAccount(accountId, apiKey),
            new TrafficRequestBudget.MonthlyReservation(
                true,
                8,
                requestsUsed,
                195_000,
                LocalDate.parse(periodStart),
                LocalDate.parse(periodEnd),
                "tomtom",
                accountId,
                "traffic-flow-incidents-vector-tiles"
            )
        );
    }

    private static JdbcTemplate transitionDatabase(String name) {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:account-transition-" + name + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
            create table tomtom_account_selection_state (
                provider varchar(64) not null,
                product varchar(96) not null,
                current_account_id varchar(32) not null,
                period_start date not null,
                period_end date not null,
                requests_used bigint not null,
                updated_at timestamp with time zone not null,
                primary key (provider, product)
            )
            """);
        jdbc.execute("""
            create table tomtom_account_transition (
                id bigint generated always as identity primary key,
                observed_at timestamp with time zone not null,
                event_type varchar(32) not null,
                provider varchar(64) not null,
                product varchar(96) not null,
                period_start date not null,
                period_end date not null,
                from_account_id varchar(32),
                to_account_id varchar(32) not null,
                calls_reserved integer not null,
                from_account_requests_used bigint,
                to_account_requests_used bigint not null
            )
            """);
        return jdbc;
    }
}
