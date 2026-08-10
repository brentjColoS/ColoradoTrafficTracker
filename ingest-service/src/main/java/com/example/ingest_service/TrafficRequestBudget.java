package com.example.ingest_service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class TrafficRequestBudget {

    public static final String DEFAULT_ACCOUNT_ID = "primary";

    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    @Autowired
    public TrafficRequestBudget(JdbcTemplate jdbcTemplate) {
        this(jdbcTemplate, Clock.systemUTC());
    }

    TrafficRequestBudget(JdbcTemplate jdbcTemplate, Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    public Reservation reserve(String budgetKey, int requestCount, int dailyLimit) {
        if (budgetKey == null || budgetKey.isBlank()) {
            throw new IllegalArgumentException("budgetKey must not be blank");
        }
        if (requestCount <= 0 || dailyLimit <= 0) {
            return new Reservation(false, usedToday(budgetKey), Math.max(0, dailyLimit));
        }

        if (requestCount > dailyLimit) return new Reservation(false, usedToday(budgetKey), dailyLimit);

        LocalDate today = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        String key = budgetKey.trim();
        jdbcTemplate.update(
            """
                insert into traffic_provider_request_budget
                    (budget_day, budget_key, requests_used, updated_at)
                values (?, ?, 0, now())
                on conflict do nothing
                """,
            today,
            key
        );
        int updated = incrementExisting(today, key, requestCount, dailyLimit);

        long used = usedForDay(today, key);
        return new Reservation(updated == 1, used, dailyLimit);
    }

    public long usedToday(String budgetKey) {
        return usedForDay(LocalDate.now(clock.withZone(ZoneOffset.UTC)), budgetKey.trim());
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
            LocalDate.now(clock.withZone(ZoneOffset.UTC)),
            budgetKey.trim()
        );
    }

    public MonthlyReservation reserveMonthly(
        String provider,
        String product,
        int requestCount,
        int monthlyLimit
    ) {
        return reserveMonthlyForAccount(
            provider,
            DEFAULT_ACCOUNT_ID,
            product,
            requestCount,
            monthlyLimit
        );
    }

    public MonthlyReservation reserveMonthlyForAccount(
        String provider,
        String accountId,
        String product,
        int requestCount,
        int monthlyLimit
    ) {
        String normalizedProvider = normalizeDimension(provider, "provider");
        String normalizedAccountId = normalizeDimension(accountId, "accountId");
        String normalizedProduct = normalizeDimension(product, "product");
        MonthPeriod period = currentMonth();

        if (requestCount <= 0 || monthlyLimit <= 0) {
            return blockedMonthlyReservation(
                normalizedProvider,
                normalizedAccountId,
                normalizedProduct,
                period,
                Math.max(0, monthlyLimit)
            );
        }
        if (requestCount > monthlyLimit) {
            return blockedMonthlyReservation(
                normalizedProvider,
                normalizedAccountId,
                normalizedProduct,
                period,
                monthlyLimit
            );
        }

        jdbcTemplate.update(
            """
                insert into traffic_provider_request_budget_monthly
                    (period_start, period_end, provider, account_id, product, requests_used, updated_at)
                values (?, ?, ?, ?, ?, 0, now())
                on conflict do nothing
                """,
            period.start(),
            period.end(),
            normalizedProvider,
            normalizedAccountId,
            normalizedProduct
        );

        int updated = jdbcTemplate.update(
            """
                update traffic_provider_request_budget_monthly
                set requests_used = requests_used + ?,
                    updated_at = now()
                where period_start = ?
                  and provider = ?
                  and account_id = ?
                  and product = ?
                  and requests_used + ? <= ?
                """,
            requestCount,
            period.start(),
            normalizedProvider,
            normalizedAccountId,
            normalizedProduct,
            requestCount,
            monthlyLimit
        );
        long used = usedForMonth(
            period.start(),
            normalizedProvider,
            normalizedAccountId,
            normalizedProduct
        );
        return new MonthlyReservation(
            updated == 1,
            updated == 1 ? requestCount : 0,
            used,
            monthlyLimit,
            period.start(),
            period.end(),
            normalizedProvider,
            normalizedAccountId,
            normalizedProduct
        );
    }

    public MonthlyUsage monthlyUsage(String provider, String product) {
        return monthlyUsageForAccount(provider, DEFAULT_ACCOUNT_ID, product);
    }

    public MonthlyUsage monthlyUsageForAccount(String provider, String accountId, String product) {
        String normalizedProvider = normalizeDimension(provider, "provider");
        String normalizedAccountId = normalizeDimension(accountId, "accountId");
        String normalizedProduct = normalizeDimension(product, "product");
        MonthPeriod period = currentMonth();
        return new MonthlyUsage(
            usedForMonth(
                period.start(),
                normalizedProvider,
                normalizedAccountId,
                normalizedProduct
            ),
            period.start(),
            period.end(),
            normalizedProvider,
            normalizedAccountId,
            normalizedProduct
        );
    }

    public void releaseMonthly(MonthlyReservation reservation, int requestCount) {
        if (reservation == null || requestCount <= 0 || reservation.callsReserved() <= 0) return;

        int releasable = Math.min(requestCount, reservation.callsReserved());
        jdbcTemplate.update(
            """
                update traffic_provider_request_budget_monthly
                set requests_used = greatest(0, requests_used - ?),
                    updated_at = now()
                where period_start = ?
                  and provider = ?
                  and account_id = ?
                  and product = ?
                """,
            releasable,
            reservation.periodStart(),
            reservation.provider(),
            reservation.accountId(),
            reservation.product()
        );
    }

    private MonthlyReservation blockedMonthlyReservation(
        String provider,
        String accountId,
        String product,
        MonthPeriod period,
        int monthlyLimit
    ) {
        return new MonthlyReservation(
            false,
            0,
            usedForMonth(period.start(), provider, accountId, product),
            monthlyLimit,
            period.start(),
            period.end(),
            provider,
            accountId,
            product
        );
    }

    private long usedForMonth(
        LocalDate periodStart,
        String provider,
        String accountId,
        String product
    ) {
        Long used = jdbcTemplate.queryForObject(
            """
                select coalesce(max(requests_used), 0)
                from traffic_provider_request_budget_monthly
                where period_start = ?
                  and provider = ?
                  and account_id = ?
                  and product = ?
                """,
            Long.class,
            periodStart,
            provider,
            accountId,
            product
        );
        return used == null ? 0 : used;
    }

    private MonthPeriod currentMonth() {
        YearMonth month = YearMonth.from(LocalDate.now(clock.withZone(ZoneOffset.UTC)));
        return new MonthPeriod(month.atDay(1), month.plusMonths(1).atDay(1));
    }

    private static String normalizeDimension(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private record MonthPeriod(LocalDate start, LocalDate end) {}

    public record Reservation(boolean allowed, long usedToday, int dailyLimit) {}

    public record MonthlyUsage(
        long requestsUsed,
        LocalDate periodStart,
        LocalDate periodEnd,
        String provider,
        String accountId,
        String product
    ) {
        public MonthlyUsage(
            long requestsUsed,
            LocalDate periodStart,
            LocalDate periodEnd,
            String provider,
            String product
        ) {
            this(
                requestsUsed,
                periodStart,
                periodEnd,
                provider,
                DEFAULT_ACCOUNT_ID,
                product
            );
        }
    }

    public record MonthlyReservation(
        boolean allowed,
        int callsReserved,
        long requestsUsed,
        int monthlyLimit,
        LocalDate periodStart,
        LocalDate periodEnd,
        String provider,
        String accountId,
        String product
    ) {
        public MonthlyReservation(
            boolean allowed,
            int callsReserved,
            long requestsUsed,
            int monthlyLimit,
            LocalDate periodStart,
            LocalDate periodEnd,
            String provider,
            String product
        ) {
            this(
                allowed,
                callsReserved,
                requestsUsed,
                monthlyLimit,
                periodStart,
                periodEnd,
                provider,
                DEFAULT_ACCOUNT_ID,
                product
            );
        }
    }
}
