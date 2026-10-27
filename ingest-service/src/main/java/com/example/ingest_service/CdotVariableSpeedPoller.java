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
    private String retryDeviceId;

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
        lease.tryRun("cdot-i70-variable-speed-signs", Duration.ofSeconds(config.boundedPollSeconds()),
            Duration.ofMinutes(2), this::pollOnce);
    }

    void pollOnce() {
        Map<String, VariableSpeedSign> current = store.current();
        boolean retrying = retryDeviceId != null;
        I70VariableSpeedSigns.Device device = retrying ? I70VariableSpeedSigns.device(retryDeviceId)
            : I70VariableSpeedSigns.devices().stream()
            .min(Comparator.comparing(candidate -> {
                VariableSpeedSign sign = current.get(candidate.id());
                return sign == null || sign.lastAttemptAt() == null ? Instant.EPOCH : sign.lastAttemptAt();
            })).orElseThrow();
        retryDeviceId = null;
        Instant attemptedAt = clock.instant();
        VariableSpeedSign next;
        try {
            next = client.fetch(cdot.apiKey(), device, attemptedAt).block(CdotVariableSpeedClient.READ_TIMEOUT.plusSeconds(2));
            if (next == null) throw new IllegalStateException("Empty sign response");
            if (retrying) log.info("CDOT I-70 sign {} completed its scheduled recovery read", device.id());
        } catch (RuntimeException error) {
            next = current.getOrDefault(device.id(), VariableSpeedSign.unobserved(device)).failed(attemptedAt);
            CdotVariableSpeedClient.ReadFailure failure = CdotVariableSpeedClient.readFailure(error);
            if (!retrying && failure.retryable()) retryDeviceId = device.id();
            log.warn("CDOT I-70 sign {} could not be refreshed ({}). Its limit is unconfirmed; {}",
                device.id(), failure.getMessage(), retryDeviceId == null
                    ? "check CDOT access and response; the normal sweep will continue"
                    : "one recovery read is queued for the next scheduled slot, without increasing the request rate");
        }
        store.save(next);
    }
}
