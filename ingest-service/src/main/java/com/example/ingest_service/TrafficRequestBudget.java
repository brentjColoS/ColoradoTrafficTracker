package com.example.ingest_service;

import java.time.LocalDate;
import java.time.ZoneOffset;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class TrafficRequestBudget {

    private final JdbcTemplate jdbcTemplate;

    public TrafficRequestBudget(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Reservation reserve(String budgetKey, int requestCount, int dailyLimit) {
        if (budgetKey == null || budgetKey.isBlank()) {
            throw new IllegalArgumentException("budgetKey must not be blank");
        }
        if (requestCount <= 0 || dailyLimit <= 0) {
            return new Reservation(false, usedToday(budgetKey), Math.max(0, dailyLimit));
        }

        if (requestCount > dailyLimit) return new Reservation(false, usedToday(budgetKey), dailyLimit);

        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        String key = budgetKey.trim();
        try {
            jdbcTemplate.update(
                """
                    insert into traffic_provider_request_budget
                        (budget_day, budget_key, requests_used, updated_at)
                    values (?, ?, 0, now())
                    """,
                today,
                key
            );
        } catch (DuplicateKeyException ignored) {
            // Another process already established today's shared counter.
        }
        int updated = incrementExisting(today, key, requestCount, dailyLimit);

        long used = usedForDay(today, key);
        return new Reservation(updated == 1, used, dailyLimit);
    }

    public long usedToday(String budgetKey) {
        return usedForDay(LocalDate.now(ZoneOffset.UTC), budgetKey.trim());
    }

    private int incrementExisting(LocalDate day, String budgetKey, int requestCount, int dailyLimit) {
        return jdbcTemplate.update(
            """
                update traffic_provider_request_budget
                set requests_used = requests_used + ?,
                    updated_at = now()
                where budget_day = ?
                  and budget_key = ?
                  and requests_used + ? <= ?
                """,
            requestCount,
            day,
            budgetKey,
            requestCount,
            dailyLimit
        );
    }

    private long usedForDay(LocalDate day, String budgetKey) {
        Long used = jdbcTemplate.queryForObject(
            """
                select coalesce(max(requests_used), 0)
                from traffic_provider_request_budget
                where budget_day = ?
                  and budget_key = ?
                """,
            Long.class,
            day,
            budgetKey
        );
        return used == null ? 0 : used;
    }

    public void release(String budgetKey, int requestCount) {
        if (budgetKey == null || budgetKey.isBlank() || requestCount <= 0) return;
        jdbcTemplate.update(
            """
                update traffic_provider_request_budget
                set requests_used = greatest(0, requests_used - ?),
                    updated_at = now()
                where budget_day = ?
                  and budget_key = ?
                """,
            requestCount,
            LocalDate.now(ZoneOffset.UTC),
            budgetKey.trim()
        );
    }

    public record Reservation(boolean allowed, long usedToday, int dailyLimit) {}
}
