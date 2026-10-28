package com.example.api_service;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/map/variable-speed-limits", "/dashboard-api/traffic/map/variable-speed-limits"})
public class VariableSpeedLimitController {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final Clock clock;

    @Autowired
    public VariableSpeedLimitController(ObjectProvider<JdbcTemplate> jdbc, ObjectMapper mapper) {
        this(jdbc.getIfAvailable(), mapper, Clock.systemUTC());
    }

    VariableSpeedLimitController(JdbcTemplate jdbc, ObjectMapper mapper, Clock clock) {
        this.jdbc = jdbc; this.mapper = mapper; this.clock = clock;
    }

    @GetMapping("/current")
    @Cacheable(cacheNames = "apiLatest", key = "'i70-variable-speeds|' + #p0")
    public ResponseEntity<Snapshot> current(@RequestParam(name = "corridor", defaultValue = "I70") String corridor) {
        if (!"I70".equalsIgnoreCase(corridor)) return ResponseEntity.badRequest().build();
        Map<String, VariableSpeedSign> stored = new LinkedHashMap<>();
        boolean readable = jdbc != null;
        if (jdbc != null) {
            try {
                String placeholders = I70VariableSpeedSigns.devices().stream().map(device -> "?").collect(Collectors.joining(","));
                jdbc.query("select sign_id, payload_json from traffic_variable_speed_sign_current where sign_id in ("
                    + placeholders + ")", result -> {
                        try {
                            VariableSpeedSign sign = mapper.readValue(result.getString("payload_json"), VariableSpeedSign.class);
                            if (result.getString("sign_id").equals(sign.id())) stored.put(sign.id(), sign);
                        } catch (java.io.IOException error) {
                            throw new IllegalStateException("Stored sign is unreadable");
                        }
                    }, I70VariableSpeedSigns.devices().stream().map(I70VariableSpeedSigns.Device::id).toArray());
            } catch (DataAccessException | IllegalStateException error) {
                readable = false;
                stored.clear();
            }
        }
        Instant now = clock.instant();
        List<VariableSpeedSign> signs = I70VariableSpeedSigns.devices().stream()
            .map(device -> stored.getOrDefault(device.id(), VariableSpeedSign.unobserved(device)).at(now)).toList();
        Instant fetchedAt = signs.stream().map(VariableSpeedSign::fetchedAt).filter(java.util.Objects::nonNull)
            .max(Instant::compareTo).orElse(null);
        long available = signs.stream().filter(sign -> "AVAILABLE".equals(sign.status())).count();
        long reduced = signs.stream().filter(VariableSpeedSign::belowRegularLimit).count();
        long reported = signs.stream().filter(sign -> ("AVAILABLE".equals(sign.status()) || "STALE".equals(sign.status()))
            && sign.reportedLimitMph() != null && sign.fetchedAt() != null).count();
        String status = !readable ? "UNAVAILABLE" : available == 0 ? reported > 0 ? "LAST_REPORTED" : "UNAVAILABLE"
            : available < signs.size() ? "PARTIAL" : "CURRENT";
        String detail = "Last-reported CDOT limits; scheduled reads are normally staggered over six hours. "
            + "Reads older than one hour are unconfirmed, not current limits. Source updates and successful read times are separate.";
        if (!readable) detail = "I-70 sign reads are unavailable. Verify the new table and the API's read permissions.";
        else if (fetchedAt == null) detail = signs.stream().anyMatch(sign -> "FETCH_FAILED".equals(sign.status()))
            ? "Scoped CDOT sign reads failed. Check ingestion logs and CDOT key access."
            : "No I-70 sign observations yet. Enable the reviewed poller and allow its initial staggered sweep to complete.";
        return ResponseEntity.ok(new Snapshot("I70", "CDOT", now, fetchedAt, status, detail,
            "Configured regular road limits; not a CDOT per-sign maximum.", available, reduced, signs, reported));
    }

    public record Snapshot(String corridor, String provider, Instant generatedAt, Instant fetchedAt, String status,
        String detail, String referenceDescription, long availableSignCount, long belowRegularSignCount,
        List<VariableSpeedSign> signs, long lastReportedSignCount) {}
}
