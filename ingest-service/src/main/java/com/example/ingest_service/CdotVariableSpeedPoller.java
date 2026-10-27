package com.example.ingest_service;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CdotVariableSpeedPoller {
    private static final Logger log = LoggerFactory.getLogger(CdotVariableSpeedPoller.class);
    private final CdotVariableSpeedProps config;
    private final CdotProps cdot;
    private final CdotVariableSpeedClient client;
    private final VariableSpeedSignStore store;
    private final TrafficSchedulerLease lease;
    private final Clock clock;

    @Autowired
    public CdotVariableSpeedPoller(CdotVariableSpeedProps config, CdotProps cdot, CdotVariableSpeedClient client,
        VariableSpeedSignStore store, TrafficSchedulerLease lease) {
        this(config, cdot, client, store, lease, Clock.systemUTC());
    }

    CdotVariableSpeedPoller(CdotVariableSpeedProps config, CdotProps cdot, CdotVariableSpeedClient client,
        VariableSpeedSignStore store, TrafficSchedulerLease lease, Clock clock) {
        this.config = config; this.cdot = cdot; this.client = client; this.store = store; this.lease = lease; this.clock = clock;
    }

    @Scheduled(initialDelay = 30_000, fixedDelay = 30_000, scheduler = "variableSpeedSignTaskScheduler")
    public void poll() {
        if (!config.enabled() || cdot.apiKey() == null || cdot.apiKey().isBlank()) return;
        lease.tryRun("cdot-i70-variable-speed-signs", Duration.ofSeconds(config.requestSpacingSeconds()),
            Duration.ofMinutes(2), this::pollOnce);
    }

    void pollOnce() {
        Map<String, VariableSpeedSign> current = store.current();
        Instant attemptedAt = clock.instant();
        I70VariableSpeedSigns.Device device = I70VariableSpeedSigns.devices().stream()
            .filter(candidate -> {
                VariableSpeedSign sign = current.get(candidate.id());
                return sign == null || sign.lastAttemptAt() == null
                    || !sign.lastAttemptAt().plusSeconds(config.boundedRefreshSeconds()).isAfter(attemptedAt);
            })
            .min(Comparator.comparing(candidate -> {
                VariableSpeedSign sign = current.get(candidate.id());
                return sign == null || sign.lastAttemptAt() == null ? Instant.EPOCH : sign.lastAttemptAt();
            })).orElse(null);
        if (device == null) return;
        VariableSpeedSign next;
        try {
            next = client.fetch(cdot.apiKey(), device, attemptedAt).block(CdotVariableSpeedClient.READ_TIMEOUT.plusSeconds(2));
            if (next == null) throw new IllegalStateException("Empty sign response");
        } catch (RuntimeException error) {
            next = current.getOrDefault(device.id(), VariableSpeedSign.unobserved(device)).failed(attemptedAt);
            CdotVariableSpeedClient.ReadFailure failure = CdotVariableSpeedClient.readFailure(error);
            log.warn("CDOT I-70 sign {} could not be refreshed ({}). Its limit is unconfirmed; "
                + "check CDOT access and response. The normal refresh schedule will continue without an automatic retry",
                device.id(), failure.getMessage());
        }
        store.save(next);
    }
}
