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

        Health.Builder builder = waiting ? Health.status("DEGRADED") : Health.up();
        return builder
            .withDetail("enabled", true)
            .withDetail("scheduleZone", "UTC")
            .withDetail("awaitingReset", waiting)
            .withDetail("accounts", accountDetails)
            .build();
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
        latest.ifPresent(event -> {
            detail.put("lastOutcome", event.outcome());
            detail.put("lastProbedAt", event.probedAt());
            if (event.httpStatus() != null) detail.put("httpStatus", event.httpStatus());
            if (event.providerCode() != null) detail.put("providerCode", event.providerCode());
        });
        return Map.copyOf(detail);
    }
}
