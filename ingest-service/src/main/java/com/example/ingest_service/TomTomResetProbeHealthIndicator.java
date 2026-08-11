package com.example.ingest_service;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("tomtomResetProbe")
public class TomTomResetProbeHealthIndicator implements HealthIndicator {

    private final TomTomAccountPool accountPool;
    private final TomTomAccountsProps accountsProps;
    private final TomTomAccountAvailability availability;
    private final TomTomResetProbeHistory history;

    public TomTomResetProbeHealthIndicator(
        TomTomAccountPool accountPool,
        TomTomAccountsProps accountsProps,
        TomTomAccountAvailability availability,
        TomTomResetProbeHistory history
    ) {
        this.accountPool = accountPool;
        this.accountsProps = accountsProps;
        this.availability = availability;
        this.history = history;
    }

    @Override
    public Health health() {
        if (!accountsProps.resetProbeEnabled()) {
            return Health.up()
                .withDetail("enabled", false)
                .withDetail("reason", "TomTom reset probes are disabled")
                .build();
        }

        Set<String> enabledAccountIds = new HashSet<>();
        accountPool.accounts().forEach(account -> enabledAccountIds.add(account.id()));
        List<Map<String, Object>> accountDetails = accountPool.configuredAccounts().stream()
            .map(account -> accountDetail(account, enabledAccountIds.contains(account.id())))
            .toList();
        boolean waiting = accountDetails.stream()
            .anyMatch(detail -> Boolean.TRUE.equals(detail.get("awaitingReset")));
        Optional<TomTomResetProbeRun> latestRun = history.latestRun();

        Health.Builder builder = waiting ? Health.status("DEGRADED") : Health.up();
        builder
            .withDetail("enabled", true)
            .withDetail("purpose", "credit-exhaustion-recovery")
            .withDetail("resetDetectionCapable", false)
            .withDetail("scheduleZone", "UTC")
            .withDetail("dailySchedulerObserved", latestRun.isPresent())
            .withDetail("awaitingReset", waiting)
            .withDetail("accounts", accountDetails);
        latestRun.ifPresent(run -> builder
            .withDetail("lastSchedulerRunAt", run.ranAt())
            .withDetail("lastEligibleAccountCount", run.eligibleAccountCount())
            .withDetail("lastAttemptedAccountCount", run.attemptedAccountCount()));
        return builder.build();
    }

    private Map<String, Object> accountDetail(TomTomAccount account, boolean pollingEnabled) {
        Optional<TomTomResetProbeEvent> latest = history.latest(account.id());
        boolean awaitingReset = pollingEnabled
            ? availability.state(account.id()) == TomTomAccountAvailability.State.CREDITS_EXHAUSTED
            : latest.map(event -> event.outcome() != TomTomResetProbeOutcome.AVAILABLE)
                .orElse(true);

        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("accountId", account.id());
        detail.put("pollingEnabled", pollingEnabled);
        detail.put("awaitingReset", awaitingReset);
        detail.put("probeEligible", awaitingReset);
        detail.put("eligibilityReason", eligibilityReason(pollingEnabled, awaitingReset, latest));
        latest.ifPresent(event -> {
            detail.put("lastOutcome", event.outcome());
            detail.put("lastProbedAt", event.probedAt());
            if (event.httpStatus() != null) detail.put("httpStatus", event.httpStatus());
            if (event.providerCode() != null) detail.put("providerCode", event.providerCode());
        });
        return Map.copyOf(detail);
    }

    private String eligibilityReason(
        boolean pollingEnabled,
        boolean awaitingReset,
        Optional<TomTomResetProbeEvent> latest
    ) {
        if (pollingEnabled) {
            return awaitingReset
                ? "provider_reported_credit_exhaustion"
                : "enabled_account_has_not_reported_exhaustion";
        }
        return latest.map(event -> event.outcome() == TomTomResetProbeOutcome.AVAILABLE)
            .orElse(false)
            ? "dormant_account_already_confirmed_available"
            : "dormant_account_awaiting_availability";
    }
}
