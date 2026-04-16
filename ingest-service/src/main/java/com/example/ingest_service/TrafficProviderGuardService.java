package com.example.ingest_service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

@Service
public class TrafficProviderGuardService {

    public static final String PROVIDER_NAME = "tomtom";
    private static final Logger log = LoggerFactory.getLogger(TrafficProviderGuardService.class);
    private static final String STATE_UNKNOWN = "UNKNOWN";
    private static final String STATE_HEALTHY = "HEALTHY";
    private static final String STATE_DEGRADED = "DEGRADED";
    private static final String STATE_HALTED = "HALTED";

    private final TrafficProviderGuardStatusRepository statusRepository;
    private final TrafficObservabilityProps observabilityProps;
    private final WebClient tomtomWebClient;
    private volatile boolean pollingHalted;

    public TrafficProviderGuardService(
        TrafficProviderGuardStatusRepository statusRepository,
        TrafficObservabilityProps observabilityProps,
        @Qualifier("tomtomWebClient") WebClient tomtomWebClient
    ) {
        this.statusRepository = statusRepository;
        this.observabilityProps = observabilityProps;
        this.tomtomWebClient = tomtomWebClient;
        this.pollingHalted = false;
    }

    public boolean isPollingHalted() {
        if (pollingHalted) {
            return true;
        }
        pollingHalted = statusRepository.findById(PROVIDER_NAME)
            .map(TrafficProviderGuardStatus::isHalted)
            .orElse(false);
        return pollingHalted;
    }

    public Optional<TrafficProviderGuardStatus> statusSnapshot() {
        return statusRepository.findById(PROVIDER_NAME);
    }

    @Transactional
    public void verifyProviderAccessAtStartup(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            halt(
                "CONFIG_MISSING_KEY",
                "Ingestion halted because TOMTOM_API_KEY is missing or blank.",
                "startup-smoke",
                0,
                "No API key was configured for the startup authorization check."
            );
            return;
        }

        try {
            tomtomWebClient.get()
                .uri(u -> u.path("/map/1/tile/basic/main/0/0/0.png")
                    .queryParam("view", "Unified")
                    .queryParam("key", apiKey)
                    .build())
                .retrieve()
                .bodyToMono(byte[].class)
                .timeout(Duration.ofSeconds(8))
                .block();

            markHealthy("TomTom provider authorization smoke test passed.");
        } catch (WebClientResponseException e) {
            if (isAuthorizationFailure(e)) {
                halt(
                    "AUTH_FORBIDDEN",
                    "Ingestion halted because TomTom rejected the configured API key during startup authorization validation.",
                    "startup-smoke",
                    e.getStatusCode().value(),
                    summarizeBody(e.getResponseBodyAsString())
                );
                return;
            }

            markDegraded(
                "STARTUP_CHECK_FAILED",
                "TomTom startup authorization smoke test could not be completed, but ingestion remains enabled.",
                "startup-smoke",
                e.getStatusCode().value(),
                summarizeBody(e.getResponseBodyAsString())
            );
        } catch (Exception e) {
            markDegraded(
                "STARTUP_CHECK_FAILED",
                "TomTom startup authorization smoke test could not be completed, but ingestion remains enabled.",
                "startup-smoke",
                0,
                summarizeBody(e.toString())
            );
        }
    }

    @Transactional
    public void tripAuthorizationFailure(String endpoint, int statusCode, String responseBody) {
        halt(
            "AUTH_FORBIDDEN",
            "Ingestion halted because TomTom rejected the configured API key while polling live data.",
            endpoint,
            statusCode,
            summarizeBody(responseBody)
        );
    }

    @Transactional
    public void recordCycleOutcome(String mode, List<List<Double>> sampledSpeedsByCorridor, int corridorCount) {
        if (pollingHalted || corridorCount <= 0 || sampledSpeedsByCorridor.isEmpty()) {
            return;
        }

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficProviderGuardStatus status = loadOrCreate(now);
        status.setLastCheckedAt(now);

        long usableCorridorCount = sampledSpeedsByCorridor.stream()
            .filter(speeds -> speeds != null && !speeds.isEmpty())
            .count();

        if (usableCorridorCount > 0) {
            status.setState(STATE_HEALTHY);
            status.setHalted(false);
            status.setFailureCode(null);
            status.setMessage("Provider traffic data is returning usable corridor speeds.");
            status.setDetailsJson(
                "{\"mode\":\"" + escapeJson(mode) + "\",\"usableCorridors\":" + usableCorridorCount + ",\"corridorCount\":" + corridorCount + "}"
            );
            status.setConsecutiveNullCycles(0);
            status.setLastSuccessAt(now);
            statusRepository.save(status);
            pollingHalted = false;
            return;
        }

        int nextNullCycleCount = status.getConsecutiveNullCycles() + 1;
        status.setConsecutiveNullCycles(nextNullCycleCount);
        status.setLastFailureAt(now);

        int threshold = Math.max(1, observabilityProps.providerNullCycleThreshold());
        if (nextNullCycleCount >= threshold) {
            status.setState(STATE_HALTED);
            status.setHalted(true);
            status.setFailureCode("NULL_DATA_THRESHOLD_EXCEEDED");
            status.setMessage(
                "Ingestion halted after " + nextNullCycleCount
                    + " consecutive poll cycles returned no usable speed data across "
                    + corridorCount + " corridors."
            );
            status.setDetailsJson(
                "{\"mode\":\"" + escapeJson(mode) + "\",\"usableCorridors\":0,\"corridorCount\":" + corridorCount
                    + ",\"threshold\":" + threshold + "}"
            );
            status.setShutdownTriggeredAt(now);
            statusRepository.save(status);
            pollingHalted = true;
            log.error("Provider guard halted ingestion after {} consecutive null-data poll cycles", nextNullCycleCount);
            return;
        }

        status.setState(STATE_DEGRADED);
        status.setHalted(false);
        status.setFailureCode("NULL_DATA_WARNING");
        status.setMessage(
            "Latest poll cycle returned no usable speed data. Guard will halt ingestion after "
                + threshold + " consecutive null-data cycles."
        );
        status.setDetailsJson(
            "{\"mode\":\"" + escapeJson(mode) + "\",\"usableCorridors\":0,\"corridorCount\":" + corridorCount
                + ",\"nextNullCycleCount\":" + nextNullCycleCount + ",\"threshold\":" + threshold + "}"
        );
        statusRepository.save(status);
    }

    public boolean isAuthorizationFailure(WebClientResponseException exception) {
        return exception.getStatusCode().value() == 401 || exception.getStatusCode().value() == 403;
    }

    @Transactional
    protected void markHealthy(String message) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficProviderGuardStatus status = loadOrCreate(now);
        status.setState(STATE_HEALTHY);
        status.setHalted(false);
        status.setFailureCode(null);
        status.setMessage(message);
        status.setDetailsJson(null);
        status.setConsecutiveNullCycles(0);
        status.setLastCheckedAt(now);
        status.setLastSuccessAt(now);
        statusRepository.save(status);
        pollingHalted = false;
    }

    @Transactional
    protected void markDegraded(String failureCode, String message, String endpoint, int statusCode, String body) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficProviderGuardStatus status = loadOrCreate(now);
        status.setState(STATE_DEGRADED);
        status.setHalted(false);
        status.setFailureCode(failureCode);
        status.setMessage(message);
        status.setDetailsJson(detailsJson(endpoint, statusCode, body));
        status.setLastCheckedAt(now);
        status.setLastFailureAt(now);
        statusRepository.save(status);
        pollingHalted = false;
        log.warn("{} [{} {}]", message, endpoint, statusCode);
    }

    @Transactional
    protected void halt(String failureCode, String message, String endpoint, int statusCode, String body) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficProviderGuardStatus status = loadOrCreate(now);
        status.setState(STATE_HALTED);
        status.setHalted(true);
        status.setFailureCode(failureCode);
        status.setMessage(message);
        status.setDetailsJson(detailsJson(endpoint, statusCode, body));
        status.setLastCheckedAt(now);
        status.setLastFailureAt(now);
        if (status.getShutdownTriggeredAt() == null) {
            status.setShutdownTriggeredAt(now);
        }
        statusRepository.save(status);
        pollingHalted = true;
        log.error("{} [{} {}]", message, endpoint, statusCode);
    }

    private TrafficProviderGuardStatus loadOrCreate(OffsetDateTime now) {
        return statusRepository.findById(PROVIDER_NAME)
            .orElseGet(() -> {
                TrafficProviderGuardStatus status = new TrafficProviderGuardStatus();
                status.setProviderName(PROVIDER_NAME);
                status.setState(STATE_UNKNOWN);
                status.setHalted(false);
                status.setConsecutiveNullCycles(0);
                status.setLastCheckedAt(now);
                return status;
            });
    }

    private static String detailsJson(String endpoint, int statusCode, String body) {
        return "{\"endpoint\":\"" + escapeJson(endpoint)
            + "\",\"statusCode\":" + statusCode
            + ",\"body\":\"" + escapeJson(body) + "\"}";
    }

    private static String summarizeBody(String body) {
        if (body == null) {
            return "";
        }
        String normalized = body.replaceAll("\\s+", " ").trim();
        return normalized.length() <= 280 ? normalized : normalized.substring(0, 280);
    }

    private static String escapeJson(String value) {
        return value == null ? "" : value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"");
    }
}
