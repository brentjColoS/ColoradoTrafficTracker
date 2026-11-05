package com.example.ingest_service;

import static com.example.ingest_service.ProviderCyclePolicy.*;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;
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
    private static final String STATE_RECOVERING = "RECOVERING";
    private static final String STATE_HALTED = "HALTED";
    private static final String CREDITS_EXHAUSTED_CODE = "CREDITS_EXHAUSTED_RECOVERING";

    private final TrafficProviderGuardStatusRepository statusRepository;
    private final TrafficObservabilityProps observabilityProps;
    private final TomTomProviderProbe providerProbe;
    private final TomTomRequestGovernor requestGovernor;
    private final AtomicReference<RecoverableProviderFailure> lastRecoverableFailure;
    private volatile boolean pollingHalted;

    public TrafficProviderGuardService(
        TrafficProviderGuardStatusRepository statusRepository,
        TrafficObservabilityProps observabilityProps,
        @Qualifier("tomtomWebClient") WebClient tomtomWebClient,
        TomTomRequestGovernor requestGovernor
    ) {
        this.statusRepository = statusRepository;
        this.observabilityProps = observabilityProps;
        this.providerProbe = new TomTomProviderProbe(tomtomWebClient, requestGovernor);
        this.requestGovernor = requestGovernor;
        this.lastRecoverableFailure = new AtomicReference<>();
        this.pollingHalted = false;
    }

    public boolean isPollingHalted() {
        if (pollingHalted) {
            return true;
        }
        pollingHalted = statusRepository.findById(PROVIDER_NAME)
            .map(TrafficProviderGuardService::blocksPolling)
            .orElse(false);
        return pollingHalted;
    }

    public Optional<TrafficProviderGuardStatus> statusSnapshot() {
        return statusRepository.findById(PROVIDER_NAME);
    }

    public boolean isRecovering() {
        return statusRepository.findById(PROVIDER_NAME)
            .map(TrafficProviderGuardService::isRecoverableStatus)
            .orElse(false);
    }

    public void recordRecoverableProviderFailure(String endpoint, Throwable error) {
        ProviderFailureCategory category = classifyFailure(error);
        if (!category.recoverable()) {
            return;
        }
        recordRecoverableProviderFailure(category, endpoint, failureSummary(error));
    }

    public void recordRecoverableProviderFailure(
        ProviderFailureCategory category,
        String endpoint,
        String summary
    ) {
        if (category == null || !category.recoverable()) {
            return;
        }
        RecoverableProviderFailure candidate = new RecoverableProviderFailure(
            category,
            endpoint == null || endpoint.isBlank() ? "unknown" : endpoint,
            summarizeBody(summary)
        );
        lastRecoverableFailure.accumulateAndGet(candidate, TrafficProviderGuardService::higherPriorityFailure);
    }

    @Transactional
    public void recordRecoverableCycleFailure(
        ProviderFailureCategory category,
        String endpoint,
        String message
    ) {
        recordRecoverableProviderFailure(category, endpoint, message);
        RecoverableProviderFailure failure = consumeRecoverableFailure().orElse(
            new RecoverableProviderFailure(ProviderFailureCategory.UNKNOWN, endpoint, message)
        );
        markRecovering(
            failure.category().recoveringFailureCode(),
            failure.category().recoveryMessage(),
            failure.endpoint(),
            0,
            failure.summary()
        );
    }

    @Transactional
    public void verifyProviderAccessAtStartup() {
        List<TomTomAccount> accounts = requestGovernor.configuredAccounts();
        if (accounts.isEmpty()) {
            halt(
                "CONFIG_MISSING_KEY",
                "Ingestion halted because no enabled TomTom API key is configured.",
                "startup-smoke",
                0,
                "No TomTom account was available for the startup authorization check."
            );
            return;
        }

        int passed = 0;
        int authorizationFailures = 0;
        List<String> failedAccounts = new ArrayList<>();
        String lastFailure = "";
        int lastStatusCode = 0;

        for (TomTomAccount account : accounts) {
            try {
                providerProbe.verifyMapAccess(account);
                passed++;
            } catch (WebClientResponseException e) {
                failedAccounts.add(account.id());
                lastStatusCode = e.getStatusCode().value();
                lastFailure = summarizeBody(e.getResponseBodyAsString());
                if (isAuthorizationFailure(e)) {
                    authorizationFailures++;
                }
            } catch (Exception e) {
                failedAccounts.add(account.id());
                lastFailure = summarizeBody(e.toString());
            }
        }

        if (passed == accounts.size()) {
            markHealthy("TomTom provider authorization smoke tests passed for all enabled accounts.");
            return;
        }
        if (passed > 0) {
            markDegraded(
                "ACCOUNT_STARTUP_CHECK_FAILED",
                "TomTom startup validation failed for account(s) "
                    + String.join(", ", failedAccounts)
                    + "; polling will continue with the validated account(s).",
                "startup-smoke",
                lastStatusCode,
                lastFailure
            );
            return;
        }
        if (authorizationFailures == accounts.size()) {
            halt(
                "AUTH_FORBIDDEN",
                "Ingestion halted because TomTom rejected every enabled API key during startup authorization validation.",
                "startup-smoke",
                lastStatusCode,
                lastFailure
            );
        } else {
            markDegraded(
                "STARTUP_CHECK_FAILED",
                "TomTom startup authorization smoke tests could not be completed, but ingestion remains enabled.",
                "startup-smoke",
                lastStatusCode,
                lastFailure
            );
        }
    }

    @Transactional
    public void attemptRecoveryProbe() {
        Optional<TrafficProviderGuardStatus> current = statusRepository.findById(PROVIDER_NAME);
        if (current.isEmpty() || !isRecoverableStatus(current.get())) {
            return;
        }
        boolean probingTrafficCredits = isCreditsExhaustedStatus(current.get());

        if (requestGovernor.configuredAccounts().isEmpty()) {
            halt(
                "CONFIG_MISSING_KEY",
                "Ingestion halted because no enabled TomTom API key is configured during provider recovery.",
                "recovery-smoke",
                0,
                "No TomTom account was available for the recovery authorization check."
            );
            return;
        }

        try {
            if (probingTrafficCredits) {
                providerProbe.verifyTrafficCredits();
            } else {
                providerProbe.verifyMapAccess();
            }

            markDegraded(
                "RECOVERY_PROBE_PASSED",
                probingTrafficCredits
                    ? "TomTom traffic credits are available again; waiting for the next poll cycle with usable traffic speeds."
                    : "TomTom is reachable again; waiting for the next poll cycle with usable traffic speeds.",
                probingTrafficCredits ? "traffic-credit-recovery-smoke" : "recovery-smoke",
                200,
                "ok"
            );
        } catch (WebClientResponseException e) {
            if (isInsufficientFunds(e)) {
                pauseForExhaustedCredits(
                    "traffic-credit-recovery-smoke",
                    e.getStatusCode().value(),
                    summarizeBody(e.getResponseBodyAsString())
                );
                return;
            }
            if (isAuthorizationFailure(e)) {
                halt(
                    "AUTH_FORBIDDEN",
                    "Ingestion halted because TomTom rejected the configured API key during provider recovery.",
                    "recovery-smoke",
                    e.getStatusCode().value(),
                    summarizeBody(e.getResponseBodyAsString())
                );
                return;
            }

            if (probingTrafficCredits) {
                pauseForExhaustedCredits(
                    "traffic-credit-recovery-smoke",
                    e.getStatusCode().value(),
                    "Traffic-credit probe failed: " + summarizeBody(e.getResponseBodyAsString())
                );
                return;
            }

            markRecovering(
                "RECOVERY_PROBE_FAILED",
                "TomTom recovery probe did not succeed yet; ingestion will keep retrying.",
                "recovery-smoke",
                e.getStatusCode().value(),
                summarizeBody(e.getResponseBodyAsString())
            );
        } catch (Exception e) {
            if (probingTrafficCredits) {
                pauseForExhaustedCredits(
                    "traffic-credit-recovery-smoke",
                    0,
                    "Traffic-credit probe failed: " + summarizeBody(e.toString())
                );
                return;
            }
            markRecovering(
                "RECOVERY_PROBE_FAILED",
                "TomTom recovery probe did not succeed yet; ingestion will keep retrying.",
                "recovery-smoke",
                0,
                summarizeBody(e.toString())
            );
        }
    }

    @Transactional
    public void tripAuthorizationFailure(String endpoint, int statusCode, String responseBody) {
        if (requestGovernor.hasAvailableAccount()) {
            markDegraded(
                "ACCOUNT_AUTH_FAILED",
                "One TomTom account was quarantined after an authorization failure; polling will continue with another account.",
                endpoint,
                statusCode,
                summarizeBody(responseBody)
            );
            return;
        }
        halt(
            "AUTH_FORBIDDEN",
            "Ingestion halted because TomTom rejected the configured API key while polling live data.",
            endpoint,
            statusCode,
            summarizeBody(responseBody)
        );
    }

    @Transactional
    public void recordCycleOutcome(String mode, List<ProviderCycleSnapshot> cycleSnapshots, int corridorCount) {
        if (pollingHalted || corridorCount <= 0 || cycleSnapshots.isEmpty()) return;

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficProviderGuardStatus status = loadOrCreate(now);
        RecoverableProviderFailure failure = currentRecoverableFailure().orElse(
            new RecoverableProviderFailure(ProviderFailureCategory.EMPTY_PAYLOAD,
                "traffic-poll-cycle", "No usable speed data was returned for any corridor."));
        var decision = ProviderCyclePolicy.evaluate(mode, cycleSnapshots, corridorCount, status, observabilityProps, failure);
        status.setLastCheckedAt(now);
        status.setConsecutiveNullCycles(decision.nullCycles());
        status.setConsecutiveStaleCycles(decision.staleCycles());
        status.setLastCycleSignature(decision.signature());
        if (decision.successful()) {
            clearRecoverableFailure();
            status.setLastSuccessAt(now);
        }
        if (decision.kind() != Kind.HEALTHY) status.setLastFailureAt(now);
        if (decision.kind() == Kind.CREDITS_EXHAUSTED) {
            pauseForExhaustedCredits(failure.endpoint(), 403, failure.summary());
            return;
        }
        status.setState(switch (decision.kind()) {
            case HEALTHY -> STATE_HEALTHY;
            case NULL_RECOVERY -> STATE_RECOVERING;
            default -> STATE_DEGRADED;
        });
        status.setHalted(false);
        status.setFailureCode(decision.failureCode());
        status.setShutdownTriggeredAt(null);
        status.setMessage(decision.message());
        status.setDetailsJson(decision.detailsJson());
        statusRepository.save(status);
        if (decision.kind() != Kind.NULL_WARNING) pollingHalted = false;
        if (decision.kind() == Kind.REPEATED) {
            if (decision.staleCycles() == decision.threshold()) {
                log.warn("Provider guard detected a repeated usable payload across {} consecutive cycles", decision.staleCycles());
            } else {
                log.debug("Provider guard continues to observe a repeated usable payload across {} consecutive cycles", decision.staleCycles());
            }
        } else if (decision.kind() == Kind.NULL_RECOVERY) {
            log.warn("Provider guard entered recoverable null-data state after {} consecutive poll cycles", decision.nullCycles());
        }
    }

    public boolean isAuthorizationFailure(WebClientResponseException exception) {
        return ProviderFailureClassifier.isAuthorizationFailure(exception);
    }

    public boolean isInsufficientFunds(WebClientResponseException exception) {
        return ProviderFailureClassifier.isInsufficientFunds(exception);
    }

    public ProviderFailureCategory classifyFailure(Throwable error) {
        return ProviderFailureClassifier.classifyFailure(error);
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
    protected void markRecovering(String failureCode, String message, String endpoint, int statusCode, String body) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficProviderGuardStatus status = loadOrCreate(now);
        status.setState(STATE_RECOVERING);
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

    private void pauseForExhaustedCredits(String endpoint, int statusCode, String body) {
        if (requestGovernor.hasAvailableAccount()) {
            markDegraded(
                "ACCOUNT_CREDITS_EXHAUSTED",
                "One TomTom account has no available traffic credits; polling will continue with another account.",
                endpoint,
                statusCode,
                body
            );
            return;
        }
        markRecovering(
            CREDITS_EXHAUSTED_CODE,
            "Traffic polling is paused because the TomTom account has no available traffic credits. "
                + "A single traffic tile will be checked periodically so ingestion can resume automatically.",
            endpoint,
            statusCode,
            body
        );
        pollingHalted = true;
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

    private void clearRecoverableFailure() {
        lastRecoverableFailure.set(null);
    }

    private Optional<RecoverableProviderFailure> consumeRecoverableFailure() {
        return Optional.ofNullable(lastRecoverableFailure.getAndSet(null));
    }

    private Optional<RecoverableProviderFailure> currentRecoverableFailure() {
        return Optional.ofNullable(lastRecoverableFailure.get());
    }

    private static RecoverableProviderFailure higherPriorityFailure(
        RecoverableProviderFailure current,
        RecoverableProviderFailure candidate
    ) {
        if (current == null) {
            return candidate;
        }
        return candidate.category().priority() >= current.category().priority() ? candidate : current;
    }

    private static boolean blocksPolling(TrafficProviderGuardStatus status) {
        return isCreditsExhaustedStatus(status) || (status.isHalted() && !isRecoverableStatus(status));
    }

    private static boolean isCreditsExhaustedStatus(TrafficProviderGuardStatus status) {
        return status != null && CREDITS_EXHAUSTED_CODE.equalsIgnoreCase(status.getFailureCode());
    }

    static boolean isRecoverableStatus(TrafficProviderGuardStatus status) {
        if (status == null) {
            return false;
        }
        String state = status.getState();
        String failureCode = status.getFailureCode();
        return STATE_RECOVERING.equalsIgnoreCase(state)
            || "NULL_DATA_RECOVERING".equalsIgnoreCase(failureCode)
            || "NULL_DATA_THRESHOLD_EXCEEDED".equalsIgnoreCase(failureCode)
            || "RECOVERY_PROBE_FAILED".equalsIgnoreCase(failureCode)
            || "RECOVERY_PROBE_PASSED".equalsIgnoreCase(failureCode)
            || failureCodeEndsRecovering(failureCode);
    }

    private static boolean failureCodeEndsRecovering(String failureCode) {
        return failureCode != null && failureCode.toUpperCase(Locale.ROOT).endsWith("_RECOVERING");
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

    private static String failureSummary(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof WebClientResponseException responseException) {
                return summarizeBody(responseException.getResponseBodyAsString());
            }
            current = current.getCause();
        }
        return summarizeBody(error == null ? "" : error.toString());
    }


}
