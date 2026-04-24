package com.example.ingest_service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Locale;
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
    public void recordOptionalAuthorizationFailure(String endpoint, int statusCode, String responseBody, String message) {
        markDegraded(
            "OPTIONAL_AUTH_FORBIDDEN",
            message == null || message.isBlank()
                ? "Optional TomTom validation endpoint rejected the configured API key; ingest remains enabled with fallback data."
                : message,
            endpoint,
            statusCode,
            summarizeBody(responseBody)
        );
    }

    @Transactional
    public void recordCycleOutcome(String mode, List<ProviderCycleSnapshot> cycleSnapshots, int corridorCount) {
        if (pollingHalted || corridorCount <= 0 || cycleSnapshots.isEmpty()) {
            return;
        }

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficProviderGuardStatus status = loadOrCreate(now);
        status.setLastCheckedAt(now);

        List<ProviderCycleSnapshot> usableSnapshots = cycleSnapshots.stream()
            .filter(TrafficProviderGuardService::hasUsableSpeedData)
            .toList();
        long usableCorridorCount = usableSnapshots.size();

        if (usableCorridorCount > 0) {
            String cycleSignature = cycleSignature(mode, usableSnapshots);
            int nextStaleCycleCount = nextStaleCycleCount(status, cycleSignature);
            int staleThreshold = Math.max(2, observabilityProps.providerStaleCycleThreshold());

            status.setConsecutiveNullCycles(0);
            status.setConsecutiveStaleCycles(nextStaleCycleCount);
            status.setLastCycleSignature(cycleSignature);
            status.setLastSuccessAt(now);

            if (nextStaleCycleCount >= staleThreshold) {
            status.setState(STATE_DEGRADED);
            status.setHalted(false);
            status.setFailureCode("STALE_PAYLOAD_WARNING");
            status.setShutdownTriggeredAt(null);
            status.setMessage(
                "Provider data is still reachable, but the same usable corridor payload has repeated for "
                    + nextStaleCycleCount + " consecutive cycles. Ingestion remains enabled while this is investigated."
            );
                status.setDetailsJson(
                    "{\"mode\":\"" + escapeJson(mode)
                        + "\",\"usableCorridors\":" + usableCorridorCount
                        + ",\"corridorCount\":" + corridorCount
                        + ",\"consecutiveStaleCycles\":" + nextStaleCycleCount
                        + ",\"threshold\":" + staleThreshold + "}"
                );
                status.setLastFailureAt(now);
                statusRepository.save(status);
                pollingHalted = false;
                log.warn(
                    "Provider guard detected a repeated usable payload across {} consecutive cycles",
                    nextStaleCycleCount
                );
                return;
            }

            status.setState(STATE_HEALTHY);
            status.setHalted(false);
            status.setFailureCode(null);
            status.setShutdownTriggeredAt(null);
            status.setMessage("Provider traffic data is returning usable corridor speeds.");
            status.setDetailsJson(
                "{\"mode\":\"" + escapeJson(mode)
                    + "\",\"usableCorridors\":" + usableCorridorCount
                    + ",\"corridorCount\":" + corridorCount
                    + ",\"consecutiveStaleCycles\":" + nextStaleCycleCount + "}"
            );
            statusRepository.save(status);
            pollingHalted = false;
            return;
        }

        int nextNullCycleCount = status.getConsecutiveNullCycles() + 1;
        status.setConsecutiveNullCycles(nextNullCycleCount);
        status.setConsecutiveStaleCycles(0);
        status.setLastCycleSignature(null);
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
        status.setShutdownTriggeredAt(null);
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
        status.setConsecutiveStaleCycles(0);
        status.setLastCycleSignature(null);
        status.setLastCheckedAt(now);
        status.setLastSuccessAt(now);
        status.setShutdownTriggeredAt(null);
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
        status.setConsecutiveStaleCycles(0);
        status.setLastCycleSignature(null);
        status.setLastCheckedAt(now);
        status.setLastFailureAt(now);
        status.setShutdownTriggeredAt(null);
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
        status.setConsecutiveStaleCycles(0);
        status.setLastCycleSignature(null);
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
                status.setConsecutiveStaleCycles(0);
                status.setLastCheckedAt(now);
                return status;
            });
    }

    private static boolean hasUsableSpeedData(ProviderCycleSnapshot snapshot) {
        return snapshot != null && snapshot.sampledSpeeds() != null && !snapshot.sampledSpeeds().isEmpty();
    }

    private static int nextStaleCycleCount(TrafficProviderGuardStatus status, String cycleSignature) {
        if (cycleSignature == null || cycleSignature.isBlank()) {
            return 0;
        }
        String previousSignature = status.getLastCycleSignature();
        if (previousSignature == null || previousSignature.isBlank()) {
            return 0;
        }
        return previousSignature.equals(cycleSignature)
            ? status.getConsecutiveStaleCycles() + 1
            : 0;
    }

    private static String cycleSignature(String mode, List<ProviderCycleSnapshot> usableSnapshots) {
        StringBuilder payload = new StringBuilder(mode == null ? "" : mode);
        usableSnapshots.stream()
            .sorted(Comparator.comparing(ProviderCycleSnapshot::corridor))
            .forEach(snapshot -> payload
                .append('|')
                .append(escapeJson(snapshot.corridor()))
                .append(':')
                .append(escapeJson(snapshot.payloadSignature())));
        return sha256(payload.toString());
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(bytes.length * 2);
            for (byte valueByte : bytes) {
                out.append(String.format(Locale.ROOT, "%02x", valueByte));
            }
            return out.toString();
        } catch (Exception e) {
            throw new IllegalStateException("Unable to hash provider cycle payload", e);
        }
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
