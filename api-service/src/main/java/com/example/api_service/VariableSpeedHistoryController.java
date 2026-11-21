package com.example.api_service;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/map/variable-speed-limits", "/dashboard-api/traffic/map/variable-speed-limits"})
public class VariableSpeedHistoryController {
    static final int MAX_ROWS = 6_000;
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final Clock clock;

    @Autowired
    public VariableSpeedHistoryController(ObjectProvider<JdbcTemplate> jdbc, ObjectMapper mapper) {
        this(jdbc.getIfAvailable(), mapper, Clock.systemUTC());
    }

    VariableSpeedHistoryController(JdbcTemplate jdbc, ObjectMapper mapper, Clock clock) {
        this.jdbc = jdbc; this.mapper = mapper; this.clock = clock;
    }

    @GetMapping("/history")
    public ResponseEntity<History> history(
        @RequestParam(name = "corridor", defaultValue = "I70") String corridor,
        @RequestParam(name = "windowHours", defaultValue = "24") int windowHours,
        @RequestParam(name = "asOf", required = false) Instant asOf) {
        Instant now = clock.instant(), end = asOf == null ? now : asOf;
        if (!"I70".equalsIgnoreCase(corridor) || windowHours < 1 || windowHours > 720
            || end.isAfter(now.plusSeconds(60)) || end.isBefore(Instant.parse("2000-01-01T00:00:00Z"))) {
            return ResponseEntity.badRequest().build();
        }
        if (jdbc == null) return ResponseEntity.status(503).build();
        Instant start = end.minusSeconds(windowHours * 3600L);
        try {
            // One extra hour supplies observations still fresh at the left edge. No backfill or provider read.
            List<VariableSpeedSign> observations = jdbc.query(connection -> {
                var statement = connection.prepareStatement("""
                    select sign_id, observed_at, payload_json from traffic_variable_speed_sign_history
                    where observed_at >= ? and observed_at <= ?
                    order by observed_at, sign_id limit ?
                    """);
                statement.setObject(1, start.minusSeconds(3600).atOffset(ZoneOffset.UTC));
                statement.setObject(2, end.atOffset(ZoneOffset.UTC));
                statement.setInt(3, MAX_ROWS + 1);
                statement.setQueryTimeout(5);
                return statement;
            }, (row, index) -> {
                try {
                    VariableSpeedSign sign = mapper.readValue(row.getString("payload_json"), VariableSpeedSign.class);
                    if (sign == null || sign.id() == null || I70VariableSpeedSigns.device(sign.id()) == null || !sign.id().equals(row.getString("sign_id"))
                        || sign.lastAttemptAt() == null || !sign.lastAttemptAt().truncatedTo(java.time.temporal.ChronoUnit.MICROS)
                            .equals(row.getTimestamp("observed_at").toInstant())) {
                        throw new IllegalStateException("Stored sign observation does not match its key");
                    }
                    return sign;
                } catch (java.io.IOException error) {
                    throw new IllegalStateException("Stored sign observation is unreadable");
                }
            });
            // Never draw an incomplete prefix as if it describes the whole requested window.
            if (observations.size() > MAX_ROWS) return ResponseEntity.status(422).build();
            return ResponseEntity.ok(new History("I70", start, end, List.copyOf(observations)));
        } catch (DataAccessException | IllegalStateException error) {
            return ResponseEntity.status(503).build();
        }
    }

    public record History(String corridor, Instant start, Instant end, List<VariableSpeedSign> observations) {}
}
