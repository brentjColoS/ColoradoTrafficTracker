package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class TomTomResetProbeHistoryTest {

    @Test
    void keepsTimestampedResultsWithoutCredentials() {
        JdbcTemplate jdbc = probeDatabase("history");
        Clock firstRun = fixedClock("2026-07-31T04:17:00Z");
        Clock secondRun = fixedClock("2026-08-01T04:17:00Z");

        new TomTomResetProbeHistory(jdbc, firstRun).record(
            "secondary",
            TomTomResetProbeOutcome.CREDITS_EXHAUSTED,
            403,
            "InsufficientFunds"
        );
        TomTomResetProbeHistory history = new TomTomResetProbeHistory(jdbc, secondRun);
        history.record("secondary", TomTomResetProbeOutcome.AVAILABLE, 200, null);

        assertThat(history.latest("secondary")).get().satisfies(latest -> {
            assertThat(latest.probedAt()).isEqualTo(Instant.parse("2026-08-01T04:17:00Z"));
            assertThat(latest.outcome()).isEqualTo(TomTomResetProbeOutcome.AVAILABLE);
            assertThat(latest.httpStatus()).isEqualTo(200);
            assertThat(latest.providerCode()).isNull();
        });
        assertThat(history.recent(90))
            .extracting(TomTomResetProbeEvent::outcome)
            .containsExactly(
                TomTomResetProbeOutcome.AVAILABLE,
                TomTomResetProbeOutcome.CREDITS_EXHAUSTED
            );
    }

    @Test
    void boundsHistoryReadsAndProviderCodes() {
        JdbcTemplate jdbc = probeDatabase("bounds");
        TomTomResetProbeHistory history = new TomTomResetProbeHistory(
            jdbc,
            fixedClock("2026-07-31T04:17:00Z")
        );

        history.record(
            "secondary",
            TomTomResetProbeOutcome.ERROR,
            503,
            "x".repeat(120)
        );

        assertThat(history.recent(10_000)).singleElement().satisfies(event ->
            assertThat(event.providerCode()).hasSize(96)
        );
    }

    @Test
    void keepsDailyRunEvidenceSeparateFromProviderResults() {
        JdbcTemplate jdbc = probeDatabase("runs");
        TomTomResetProbeHistory history = new TomTomResetProbeHistory(
            jdbc,
            fixedClock("2026-08-01T04:17:00Z")
        );

        history.recordRun(0, 0);

        assertThat(history.latestRun()).get().satisfies(run -> {
            assertThat(run.ranAt()).isEqualTo(Instant.parse("2026-08-01T04:17:00Z"));
            assertThat(run.eligibleAccountCount()).isZero();
            assertThat(run.attemptedAccountCount()).isZero();
        });
        assertThat(history.recentRuns(90)).hasSize(1);
        assertThat(history.recent(90)).isEmpty();
    }

    private static JdbcTemplate probeDatabase(String name) {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:reset-probe-" + name + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
            create table tomtom_account_reset_probe (
                id bigint generated always as identity primary key,
                account_id varchar(64) not null,
                probed_at timestamp with time zone not null,
                outcome varchar(32) not null,
                http_status integer,
                provider_code varchar(96)
            )
            """);
        jdbc.execute("""
            create table tomtom_reset_probe_run (
                id bigint generated always as identity primary key,
                ran_at timestamp with time zone not null,
                eligible_account_count integer not null,
                attempted_account_count integer not null
            )
            """);
        return jdbc;
    }

    private static Clock fixedClock(String instant) {
        return Clock.fixed(Instant.parse(instant), ZoneOffset.UTC);
    }
}
