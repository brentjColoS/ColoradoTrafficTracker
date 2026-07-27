package com.example.ingest_service;

import java.time.Duration;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class TrafficSchedulerLease {

    private final JdbcTemplate jdbcTemplate;
    private final String ownerId;

    @Autowired
    public TrafficSchedulerLease(JdbcTemplate jdbcTemplate) {
        this(jdbcTemplate, UUID.randomUUID().toString());
    }

    TrafficSchedulerLease(JdbcTemplate jdbcTemplate, String ownerId) {
        this.jdbcTemplate = jdbcTemplate;
        this.ownerId = ownerId;
    }

    public boolean tryRun(
        String leaseName,
        Duration minimumInterval,
        Duration maximumRunTime,
        Runnable work
    ) {
        if (leaseName == null || leaseName.isBlank()) {
            throw new IllegalArgumentException("leaseName must not be blank");
        }
        if (work == null) throw new IllegalArgumentException("work must not be null");

        long intervalSeconds = positiveSeconds(minimumInterval);
        long runSeconds = positiveSeconds(maximumRunTime);
        String normalizedName = leaseName.trim();
        ensureLeaseRow(normalizedName);

        int acquired = jdbcTemplate.update(
            """
                update traffic_scheduler_lease
                set owner_id = ?,
                    lease_until = now() + make_interval(secs => cast(? as integer)),
                    last_started_at = now(),
                    updated_at = now()
                where lease_name = ?
                  and lease_until <= now()
                  and next_run_at <= now()
                """,
            ownerId,
            runSeconds,
            normalizedName
        );
        if (acquired != 1) return false;

        try {
            work.run();
            return true;
        } finally {
            jdbcTemplate.update(
                """
                update traffic_scheduler_lease
                set owner_id = null,
                    lease_until = now(),
                    next_run_at = now() + make_interval(secs => cast(? as integer)),
                    last_finished_at = now(),
                    updated_at = now()
                where lease_name = ?
                  and owner_id = ?
                """,
                intervalSeconds,
                normalizedName,
                ownerId
            );
        }
    }

    private void ensureLeaseRow(String leaseName) {
        try {
            jdbcTemplate.update(
                """
                    insert into traffic_scheduler_lease (lease_name)
                    values (?)
                    """,
                leaseName
            );
        } catch (DuplicateKeyException ignored) {
            // The lease is shared by every ingest instance.
        }
    }

    private static long positiveSeconds(Duration duration) {
        if (duration == null || duration.isNegative() || duration.isZero()) return 1;
        return Math.max(1, duration.toSeconds());
    }
}
