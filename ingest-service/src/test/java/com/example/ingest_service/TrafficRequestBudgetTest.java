package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class TrafficRequestBudgetTest {

    @Test
    void reservationsSurviveServiceRecreationAndRespectTheLimit() {
        JdbcDataSource dataSource = new JdbcDataSource();
        dataSource.setURL("jdbc:h2:mem:request-budget;MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("drop table if exists traffic_provider_request_budget");
        jdbc.execute("""
            create table traffic_provider_request_budget (
                budget_day date not null,
                budget_key varchar(64) not null,
                requests_used bigint not null default 0,
                updated_at timestamp with time zone not null default now(),
                primary key (budget_day, budget_key)
            )
            """);

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
}
