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

    private static String cleanProviderCode(String providerCode) {
        if (providerCode == null || providerCode.isBlank()) return null;
        String cleaned = providerCode.trim();
        return cleaned.length() <= MAX_PROVIDER_CODE_LENGTH
            ? cleaned
            : cleaned.substring(0, MAX_PROVIDER_CODE_LENGTH);
    }
}
