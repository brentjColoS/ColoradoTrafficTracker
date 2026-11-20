package com.example.ingest_service;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class VariableSpeedSignStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public VariableSpeedSignStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public Map<String, VariableSpeedSign> current() {
        Map<String, VariableSpeedSign> signs = new LinkedHashMap<>();
        String placeholders = I70VariableSpeedSigns.devices().stream().map(device -> "?").collect(Collectors.joining(","));
        jdbc.query("select sign_id, payload_json from traffic_variable_speed_sign_current where sign_id in ("
            + placeholders + ")", result -> {
                try {
                    VariableSpeedSign sign = mapper.readValue(result.getString("payload_json"), VariableSpeedSign.class);
                    if (result.getString("sign_id").equals(sign.id())) signs.put(sign.id(), sign);
                } catch (java.io.IOException error) {
                    throw new IllegalStateException("Stored sign state is unreadable");
                }
            }, I70VariableSpeedSigns.devices().stream().map(I70VariableSpeedSigns.Device::id).toArray());
        return signs;
    }

    @Transactional
    public void save(VariableSpeedSign sign) {
        if (I70VariableSpeedSigns.device(sign.id()) == null || sign.lastAttemptAt() == null) {
            throw new IllegalArgumentException("Cannot store an untracked sign");
        }
        try {
            String payload = mapper.writeValueAsString(sign);
            if (payload.length() > 4096) throw new IllegalArgumentException("Sign state is too large");
            var observedAt = sign.lastAttemptAt().truncatedTo(java.time.temporal.ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
            int inserted = jdbc.update("""
                insert into traffic_variable_speed_sign_history (sign_id, observed_at, payload_json)
                values (?, ?, ?) on conflict (sign_id, observed_at) do nothing
                """, sign.id(), observedAt, payload);
            if (inserted == 0 && !payload.equals(jdbc.queryForObject("""
                select payload_json from traffic_variable_speed_sign_history where sign_id = ? and observed_at = ?
                """, String.class, sign.id(), observedAt))) {
                throw new IllegalStateException("A different sign observation already exists at this read time");
            }
            jdbc.update("""
                insert into traffic_variable_speed_sign_current (sign_id, last_attempt_at, payload_json)
                values (?, ?, ?)
                on conflict (sign_id) do update set last_attempt_at = excluded.last_attempt_at,
                    payload_json = excluded.payload_json
                where traffic_variable_speed_sign_current.last_attempt_at <= excluded.last_attempt_at
                """, sign.id(), observedAt, payload);
        } catch (java.io.IOException error) {
            throw new IllegalStateException("Cannot serialize sign state");
        }
    }
}
