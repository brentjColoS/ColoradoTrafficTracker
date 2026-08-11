package com.example.ingest_service;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class TomTomResetProbeHistory {

    private static final int MAX_PROVIDER_CODE_LENGTH = 96;

    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    @Autowired
    public TomTomResetProbeHistory(JdbcTemplate jdbcTemplate) {
        this(jdbcTemplate, Clock.systemUTC());
    }

    TomTomResetProbeHistory(JdbcTemplate jdbcTemplate, Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    public void record(
        String accountId,
        TomTomResetProbeOutcome outcome,
        Integer httpStatus,
        String providerCode
    ) {
        if (accountId == null || accountId.isBlank()) {
            throw new IllegalArgumentException("accountId must not be blank");
        }
        if (outcome == null) {
            throw new IllegalArgumentException("outcome must not be null");
        }

        jdbcTemplate.update(
            """
                insert into tomtom_account_reset_probe
                    (account_id, probed_at, outcome, http_status, provider_code)
                values (?, ?, ?, ?, ?)
                """,
            accountId.trim(),
            OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC),
            outcome.name(),
            httpStatus,
            cleanProviderCode(providerCode)
        );
    }

    public Optional<TomTomResetProbeEvent> latest(String accountId) {
        if (accountId == null || accountId.isBlank()) return Optional.empty();

        return jdbcTemplate.query(
            """
                select id, account_id, probed_at, outcome, http_status, provider_code
                from tomtom_account_reset_probe
                where account_id = ?
                order by probed_at desc, id desc
                limit 1
                """,
            (rs, rowNum) -> mapEvent(rs),
            accountId.trim()
        ).stream().findFirst();
    }

    public void recordRun(int eligibleAccountCount, int attemptedAccountCount) {
        if (eligibleAccountCount < 0) {
            throw new IllegalArgumentException("eligibleAccountCount must not be negative");
        }
        if (attemptedAccountCount < 0 || attemptedAccountCount > eligibleAccountCount) {
            throw new IllegalArgumentException("attemptedAccountCount must be between zero and eligibleAccountCount");
        }

        jdbcTemplate.update(
            """
                insert into tomtom_reset_probe_run
                    (ran_at, eligible_account_count, attempted_account_count)
                values (?, ?, ?)
                """,
            OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC),
            eligibleAccountCount,
            attemptedAccountCount
        );
    }

    public Optional<TomTomResetProbeRun> latestRun() {
        return jdbcTemplate.query(
            """
                select id, ran_at, eligible_account_count, attempted_account_count
                from tomtom_reset_probe_run
                order by ran_at desc, id desc
                limit 1
                """,
            (rs, rowNum) -> mapRun(rs)
        ).stream().findFirst();
    }

    public List<TomTomResetProbeRun> recentRuns(int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 365));
        return jdbcTemplate.query(
            """
                select id, ran_at, eligible_account_count, attempted_account_count
                from tomtom_reset_probe_run
                order by ran_at desc, id desc
                limit ?
                """,
            (rs, rowNum) -> mapRun(rs),
            boundedLimit
        );
    }

    public List<TomTomResetProbeEvent> recent(int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 365));
        return jdbcTemplate.query(
            """
                select id, account_id, probed_at, outcome, http_status, provider_code
                from tomtom_account_reset_probe
                order by probed_at desc, id desc
                limit ?
                """,
            (rs, rowNum) -> mapEvent(rs),
            boundedLimit
        );
    }

    private static TomTomResetProbeEvent mapEvent(java.sql.ResultSet resultSet)
        throws java.sql.SQLException {
        OffsetDateTime probedAt = resultSet.getObject("probed_at", OffsetDateTime.class);
        return new TomTomResetProbeEvent(
            resultSet.getLong("id"),
            resultSet.getString("account_id"),
            probedAt.toInstant(),
            TomTomResetProbeOutcome.valueOf(resultSet.getString("outcome")),
            (Integer) resultSet.getObject("http_status"),
            resultSet.getString("provider_code")
        );
    }

    private static TomTomResetProbeRun mapRun(java.sql.ResultSet resultSet)
        throws java.sql.SQLException {
        OffsetDateTime ranAt = resultSet.getObject("ran_at", OffsetDateTime.class);
        return new TomTomResetProbeRun(
            resultSet.getLong("id"),
            ranAt.toInstant(),
            resultSet.getInt("eligible_account_count"),
            resultSet.getInt("attempted_account_count")
        );
    }

    private static String cleanProviderCode(String providerCode) {
        if (providerCode == null || providerCode.isBlank()) return null;
        String cleaned = providerCode.trim();
        return cleaned.length() <= MAX_PROVIDER_CODE_LENGTH
            ? cleaned
            : cleaned.substring(0, MAX_PROVIDER_CODE_LENGTH);
    }
}
