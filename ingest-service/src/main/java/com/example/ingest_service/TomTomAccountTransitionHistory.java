package com.example.ingest_service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class TomTomAccountTransitionHistory {

    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;

    @Autowired
    public TomTomAccountTransitionHistory(JdbcTemplate jdbcTemplate) {
        this(jdbcTemplate, Clock.systemUTC());
    }

    TomTomAccountTransitionHistory(JdbcTemplate jdbcTemplate, Clock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    @Transactional
    public void record(TomTomAccountQuotaManager.AccountReservation reservation) {
        if (reservation == null) {
            throw new IllegalArgumentException("reservation must not be null");
        }

        TrafficRequestBudget.MonthlyReservation budget = reservation.budgetReservation();
        SelectionState previous = currentState(budget.provider(), budget.product());
        TomTomAccountTransitionType eventType = transitionType(previous, reservation);
        OffsetDateTime observedAt = OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);

        if (eventType != null) {
            jdbcTemplate.update(
                """
                    insert into tomtom_account_transition
                        (observed_at, event_type, provider, product,
                         period_start, period_end, from_account_id, to_account_id,
                         calls_reserved, from_account_requests_used, to_account_requests_used)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                observedAt,
                eventType.name(),
                budget.provider(),
                budget.product(),
                budget.periodStart(),
                budget.periodEnd(),
                previous == null ? null : previous.accountId(),
                reservation.account().id(),
                Math.toIntExact(reservation.callsReserved()),
                previous == null ? null : previous.requestsUsed(),
                reservation.requestsUsed()
            );
        }

        if (previous == null) {
            jdbcTemplate.update(
                """
                    insert into tomtom_account_selection_state
                        (provider, product, current_account_id, period_start,
                         period_end, requests_used, updated_at)
                    values (?, ?, ?, ?, ?, ?, ?)
                    """,
                budget.provider(),
                budget.product(),
                reservation.account().id(),
                budget.periodStart(),
                budget.periodEnd(),
                reservation.requestsUsed(),
                observedAt
            );
        } else {
            jdbcTemplate.update(
                """
                    update tomtom_account_selection_state
                    set current_account_id = ?,
                        period_start = ?,
                        period_end = ?,
                        requests_used = ?,
                        updated_at = ?
                    where provider = ? and product = ?
                    """,
                reservation.account().id(),
                budget.periodStart(),
                budget.periodEnd(),
                reservation.requestsUsed(),
                observedAt,
                budget.provider(),
                budget.product()
            );
        }
    }

    public List<TomTomAccountTransitionEvent> recent(int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, 365));
        return jdbcTemplate.query(
            """
                select id, observed_at, event_type, provider, product,
                       period_start, period_end, from_account_id, to_account_id,
                       calls_reserved, from_account_requests_used, to_account_requests_used
                from tomtom_account_transition
                order by observed_at desc, id desc
                limit ?
                """,
            (resultSet, rowNum) -> new TomTomAccountTransitionEvent(
                resultSet.getLong("id"),
                resultSet.getObject("observed_at", OffsetDateTime.class).toInstant(),
                TomTomAccountTransitionType.valueOf(resultSet.getString("event_type")),
                resultSet.getString("provider"),
                resultSet.getString("product"),
                resultSet.getObject("period_start", LocalDate.class),
                resultSet.getObject("period_end", LocalDate.class),
                resultSet.getString("from_account_id"),
                resultSet.getString("to_account_id"),
                resultSet.getInt("calls_reserved"),
                (Long) resultSet.getObject("from_account_requests_used"),
                resultSet.getLong("to_account_requests_used")
            ),
            boundedLimit
        );
    }

    private SelectionState currentState(String provider, String product) {
        return jdbcTemplate.query(
            """
                select current_account_id, period_start, requests_used
                from tomtom_account_selection_state
                where provider = ? and product = ?
                for update
                """,
            (resultSet, rowNum) -> new SelectionState(
                resultSet.getString("current_account_id"),
                resultSet.getObject("period_start", LocalDate.class),
                resultSet.getLong("requests_used")
            ),
            provider,
            product
        ).stream().findFirst().orElse(null);
    }

    private static TomTomAccountTransitionType transitionType(
        SelectionState previous,
        TomTomAccountQuotaManager.AccountReservation reservation
    ) {
        if (previous == null) return TomTomAccountTransitionType.INITIAL_SELECTION;
        if (!previous.periodStart().equals(reservation.budgetReservation().periodStart())) {
            return TomTomAccountTransitionType.MONTH_BOUNDARY;
        }
        if (!previous.accountId().equals(reservation.account().id())) {
            return TomTomAccountTransitionType.ACCOUNT_HANDOFF;
        }
        return null;
    }

    private record SelectionState(String accountId, LocalDate periodStart, long requestsUsed) {}
}
