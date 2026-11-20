package com.example.ingest_service;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.ZoneOffset;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class VariableSpeedSignStore {
    private static final Logger log = LoggerFactory.getLogger(VariableSpeedSignStore.class);
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final TransactionTemplate transaction;
    private final boolean historyEnabled;

    public VariableSpeedSignStore(JdbcTemplate jdbc, ObjectMapper mapper, PlatformTransactionManager manager,
        @Value("${traffic.cdot-variable-speeds.history-enabled:false}") boolean historyEnabled) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.historyEnabled = historyEnabled;
        this.transaction = new TransactionTemplate(manager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.transaction.setTimeout(3);
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

    public void save(VariableSpeedSign sign) {
        if (I70VariableSpeedSigns.device(sign.id()) == null || sign.lastAttemptAt() == null) {
            throw new IllegalArgumentException("Cannot store an untracked sign");
        }
        try {
            String payload = mapper.writeValueAsString(sign);
            if (payload.length() > 4096) throw new IllegalArgumentException("Sign state is too large");
            var observedAt = sign.lastAttemptAt().truncatedTo(ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
            transaction.executeWithoutResult(status -> saveCurrent(sign.id(), observedAt, payload));
            if (historyEnabled) appendHistory(sign.id(), observedAt, payload);
        } catch (java.io.IOException error) {
            throw new IllegalStateException("Cannot serialize sign state");
        }
    }

    private void saveCurrent(String id, OffsetDateTime observedAt, String payload) {
        boundedStatements();
        int updated = jdbc.update("""
                insert into traffic_variable_speed_sign_current (sign_id, last_attempt_at, payload_json)
                values (?, ?, ?)
                on conflict (sign_id) do update set last_attempt_at = excluded.last_attempt_at,
                    payload_json = excluded.payload_json
                where traffic_variable_speed_sign_current.last_attempt_at < excluded.last_attempt_at
                   or traffic_variable_speed_sign_current.payload_json = excluded.payload_json
                """, id, observedAt, payload);
        if (updated == 0 && !jdbc.queryForList("""
            select sign_id from traffic_variable_speed_sign_current
            where sign_id = ? and last_attempt_at = ?
            """, String.class, id, observedAt).isEmpty()) {
            throw new IllegalStateException("A different sign observation already exists at this read time");
        }
    }

    private void appendHistory(String id, OffsetDateTime observedAt, String payload) {
        try {
            // Commit current state first: optional history must never trigger another provider read.
            transaction.executeWithoutResult(status -> {
                boundedStatements();
                int inserted = jdbc.update("""
                    insert into traffic_variable_speed_sign_history (sign_id, observed_at, payload_json)
                    values (?, ?, ?) on conflict (sign_id, observed_at) do nothing
                    """, id, observedAt, payload);
                if (inserted == 0 && !payload.equals(jdbc.queryForObject("""
                    select payload_json from traffic_variable_speed_sign_history
                    where sign_id = ? and observed_at = ?
                    """, String.class, id, observedAt))) {
                    throw new IllegalStateException("Conflicting historical sign observation");
                }
            });
        } catch (RuntimeException error) {
            log.warn("Sign history was not retained for {} ({}). Current state was committed; check history storage "
                + "and permissions, or disable CDOT_VSL_HISTORY_ENABLED. No provider retry is needed",
                id, error.getClass().getSimpleName());
        }
    }

    private void boundedStatements() {
        jdbc.execute("set local lock_timeout = '1s'");
        jdbc.execute("set local statement_timeout = '2s'");
    }
}
