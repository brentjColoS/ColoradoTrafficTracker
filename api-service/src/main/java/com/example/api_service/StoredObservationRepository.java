package com.example.api_service;

import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class StoredObservationRepository {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public record Totals(Instant observedAt, long total, Map<String, Long> corridors) {}

    @org.springframework.beans.factory.annotation.Autowired
    public StoredObservationRepository(ObjectProvider<JdbcTemplate> jdbc) {
        this(jdbc.getIfAvailable(), Clock.systemUTC());
    }

    StoredObservationRepository(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public Totals totals() {
        if (jdbc == null) throw new IllegalStateException("Observation database is unavailable");
        Instant observedAt = clock.instant();
        Map<String, Long> corridors = new LinkedHashMap<>(Map.of("I25", 0L, "I70", 0L));
        // Retention moves both storage tiers in one transaction; one statement sees a consistent total.
        jdbc.query(connection -> {
            var statement = connection.prepareStatement("""
                select corridor, sum(observations)::bigint as observations from (
                    select corridor, count(*) as observations from traffic_sample
                    where corridor in ('I25','I70') group by corridor
                    union all
                    select corridor, count(*) as observations from traffic_sample_archive
                    where corridor in ('I25','I70') group by corridor
                ) counts group by corridor
                """);
            statement.setQueryTimeout(1);
            return statement;
        }, (org.springframework.jdbc.core.RowCallbackHandler) row ->
            corridors.put(row.getString("corridor"), row.getLong("observations")));
        return new Totals(observedAt, Math.addExact(corridors.get("I25"), corridors.get("I70")), Map.copyOf(corridors));
    }
}
