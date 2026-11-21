package com.example.api_service;

import java.sql.SQLException;
import java.time.Clock;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.TransactionException;
import org.springframework.web.client.RestClientException;

final class DashboardReadDiagnostics {
    enum Dataset {
        HEALTH, SYSTEM, CORRIDORS, OBSERVATIONS, CURRENT_SUMMARY, HISTORY, TRENDS, ZONE_TRENDS,
        BASELINES, FLOW_CELLS, SIGN_LIMITS, INCIDENTS, WINDOW_SUMMARY, BOOTSTRAP, UNKNOWN
    }
    enum Corridor { I25, I70, ALL, UNKNOWN }
    enum Stage {
        LOAD, ENCODE, WAIT, REFRESH_QUEUE, INCIDENT_REVISION, INCIDENT_SECTION,
        SUMMARY_SPEED, SUMMARY_ZONES, SUMMARY_INCIDENTS, SUMMARY_WAIT, SUMMARY_ADMISSION,
        STARTUP_PAGE, STARTUP_DECODE, STARTUP_TRANSACTION, STARTUP_WAIT
    }
    enum Cause { SOURCE_READ, SERIALIZATION, WAIT_TIMEOUT, CAPACITY_REJECTED, UNEXPECTED }

    record Scope(Dataset dataset, Corridor corridor) {}
    private record Key(Scope scope, Stage stage, Cause cause) {}
    private record Repeat(long lastWarning, long lastSeen, long suppressed) {}
    record Event(Scope scope, Stage stage, Cause cause, long suppressed, List<String> types, List<String> frames) {}

    private static final Logger log = LoggerFactory.getLogger(DashboardReadDiagnostics.class);
    private static final DashboardReadDiagnostics SHARED = new DashboardReadDiagnostics(Clock.systemUTC(), event ->
        log.warn("Dashboard read diagnostic dataset={} corridor={} stage={} cause={} suppressed={} types={} frames={}",
            event.scope().dataset(), event.scope().corridor(), event.stage(), event.cause(), event.suppressed(),
            event.types(), event.frames()));
    private static final long WARNING_INTERVAL = 60_000;
    private static final long IDLE_EXPIRY = 300_000;
    private static final int DETAIL_LIMIT = 4;

    private final Clock clock;
    private final Consumer<Event> sink;
    // All keys consist solely of finite enum values, regardless of request or exception content.
    private final Map<Key, Repeat> repeats = new HashMap<>();

    DashboardReadDiagnostics(Clock clock, Consumer<Event> sink) {
        this.clock = clock;
        this.sink = sink;
    }

    static DashboardReadDiagnostics shared() { return SHARED; }

    void report(Scope scope, Stage stage, Throwable error) { report(scope, stage, null, error); }

    void report(Scope scope, Stage stage, Cause explicit, Throwable error) {
        try {
            Cause cause = Cause.UNEXPECTED;
            List<String> types = new ArrayList<>(DETAIL_LIMIT);
            for (Throwable current = error; current != null && types.size() < DETAIL_LIMIT; current = current.getCause()) {
                if (current instanceof InterruptedException || current instanceof CancellationException) return;
                types.add(current.getClass().getName());
                if (current instanceof DataAccessException || current instanceof SQLException
                    || current instanceof TransactionException || current instanceof RestClientException) cause = Cause.SOURCE_READ;
            }
            if (explicit != null) cause = explicit;
            Long suppressed = acquire(new Key(scope, stage, cause));
            if (suppressed == null) return;
            List<String> frames = error == null ? List.of() : Arrays.stream(error.getStackTrace())
                .filter(frame -> frame.getClassName().startsWith("com.example.api_service."))
                .limit(DETAIL_LIMIT).map(frame -> frame.getClassName() + "." + frame.getMethodName()).toList();
            sink.accept(new Event(scope, stage, cause, suppressed, List.copyOf(types), frames));
        } catch (RuntimeException ignored) {
            // Diagnostics must not interfere with the owner completing the read.
        }
    }

    private synchronized Long acquire(Key key) {
        long now = clock.millis();
        repeats.values().removeIf(value -> now - value.lastSeen() >= IDLE_EXPIRY);
        Repeat prior = repeats.get(key);
        if (prior != null && now - prior.lastWarning() < WARNING_INTERVAL) {
            repeats.put(key, new Repeat(prior.lastWarning(), now, prior.suppressed() + 1));
            return null;
        }
        repeats.put(key, new Repeat(now, now, 0));
        return prior == null ? 0L : prior.suppressed();
    }

    static Corridor corridor(String value) {
        return switch (value) {
            case "I25" -> Corridor.I25;
            case "I70" -> Corridor.I70;
            case "ALL" -> Corridor.ALL;
            default -> Corridor.UNKNOWN;
        };
    }

    static Scope cacheScope(String key) {
        String[] parts = key.split("[?&|]", -1);
        Dataset dataset = switch (parts[0]) {
            case "health" -> Dataset.HEALTH;
            case "/system/operational-status" -> Dataset.SYSTEM;
            case "/traffic/map/corridors" -> Dataset.CORRIDORS;
            case "/traffic/database/observations" -> Dataset.OBSERVATIONS;
            case "/traffic/summary" -> Dataset.CURRENT_SUMMARY;
            case "/traffic/history" -> Dataset.HISTORY;
            case "/traffic/analytics/trends" -> Dataset.TRENDS;
            case "/traffic/zones/trends" -> Dataset.ZONE_TRENDS;
            case "baseline" -> Dataset.BASELINES;
            case "/traffic/map/flow-cells/current", "/traffic/map/flow-cells/hourly", "/traffic/map/flow-cells/frequency" -> Dataset.FLOW_CELLS;
            case "/traffic/map/variable-speed-limits/current" -> Dataset.SIGN_LIMITS;
            case "/traffic/map/incidents/shared", "/traffic/map/incidents/recent", "/traffic/map/incidents/timeline" -> Dataset.INCIDENTS;
            default -> Dataset.UNKNOWN;
        };
        Corridor corridor = switch (dataset) {
            case HEALTH, SYSTEM, CORRIDORS, OBSERVATIONS -> Corridor.ALL;
            default -> Corridor.UNKNOWN;
        };
        if (dataset == Dataset.BASELINES && parts.length > 1) corridor = corridor(parts[1]);
        else for (String part : parts) {
            if (part.startsWith("corridor=")) {
                corridor = corridor(part.substring("corridor=".length()));
                break;
            }
        }
        return new Scope(dataset, corridor);
    }
}
