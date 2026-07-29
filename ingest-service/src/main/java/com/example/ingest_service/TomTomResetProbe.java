package com.example.ingest_service;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpHeaders;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

@Component
public class TomTomResetProbe {

    private static final Logger log = LoggerFactory.getLogger(TomTomResetProbe.class);
    private static final Pattern PROVIDER_CODE = Pattern.compile(
        "\"code\"\\s*:\\s*\"([^\"]+)\"",
        Pattern.CASE_INSENSITIVE
    );
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(8);
    private static final Duration MAXIMUM_RUN_TIME = Duration.ofMinutes(2);

    private final TomTomAccountPool accountPool;
    private final TomTomAccountsProps accountsProps;
    private final TomTomAccountAvailability availability;
    private final TomTomResetProbeHistory history;
    private final TrafficSchedulerLease schedulerLease;
    private final WebClient tomtomWebClient;
    private final Clock clock;

    @Autowired
    public TomTomResetProbe(
        TomTomAccountPool accountPool,
        TomTomAccountsProps accountsProps,
        TomTomAccountAvailability availability,
        TomTomResetProbeHistory history,
        TrafficSchedulerLease schedulerLease,
        @Qualifier("tomtomWebClient") WebClient tomtomWebClient
    ) {
        this(
            accountPool,
            accountsProps,
            availability,
            history,
            schedulerLease,
            tomtomWebClient,
            Clock.systemUTC()
        );
    }

    TomTomResetProbe(
        TomTomAccountPool accountPool,
        TomTomAccountsProps accountsProps,
        TomTomAccountAvailability availability,
        TomTomResetProbeHistory history,
        TrafficSchedulerLease schedulerLease,
        WebClient tomtomWebClient,
        Clock clock
    ) {
        this.accountPool = accountPool;
        this.accountsProps = accountsProps;
        this.availability = availability;
        this.history = history;
        this.schedulerLease = schedulerLease;
        this.tomtomWebClient = tomtomWebClient;
        this.clock = clock;
    }

    @Scheduled(
        cron = "${traffic.tomtom-accounts.resetProbeCron:0 17 4 * * *}",
        zone = "UTC"
    )
    public void probeWaitingAccounts() {
        if (!accountsProps.resetProbeEnabled()) return;

        LocalDate probeDay = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        for (TomTomAccount account : accountsWaitingForReset()) {
            String leaseName = "tomtom-reset-probe-" + account.id() + "-" + probeDay;
            schedulerLease.tryRun(
                leaseName,
                Duration.ofDays(1),
                MAXIMUM_RUN_TIME,
                () -> probe(account)
            );
        }
    }

    List<TomTomAccount> accountsWaitingForReset() {
        Set<String> enabledAccountIds = new HashSet<>();
        accountPool.accounts().forEach(account -> enabledAccountIds.add(account.id()));

        return accountPool.configuredAccounts().stream()
            .filter(account -> {
                if (enabledAccountIds.contains(account.id())) {
                    return availability.state(account.id())
                        == TomTomAccountAvailability.State.CREDITS_EXHAUSTED;
                }
                return history.latest(account.id())
                    .map(event -> event.outcome() != TomTomResetProbeOutcome.AVAILABLE)
                    .orElse(true);
            })
            .toList();
    }

    private void probe(TomTomAccount account) {
        try {
            tomtomWebClient.get()
                .uri(uri -> uri
                    .path("/traffic/map/4/tile/flow/absolute/11/426/776.pbf")
                    .queryParam("roadTypes", "[0,1,2]")
                    .queryParam("margin", "0")
                    .queryParam("key", account.apiKey())
                    .build())
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .header("Pragma", "no-cache")
                .header("Tracking-ID", UUID.randomUUID().toString())
                .retrieve()
                .bodyToMono(byte[].class)
                .timeout(REQUEST_TIMEOUT)
                .block();

            history.record(account.id(), TomTomResetProbeOutcome.AVAILABLE, 200, null);
            availability.markAvailable(account.id());
            log.info("TomTom reset probe found account {} available", account.id());
        } catch (Exception error) {
            ProbeFailure failure = classify(error);
            history.record(
                account.id(),
                failure.outcome(),
                failure.httpStatus(),
                failure.providerCode()
            );
            log.info(
                "TomTom reset probe for account {} finished with {} (status={})",
                account.id(),
                failure.outcome(),
                failure.httpStatus() == null ? 0 : failure.httpStatus()
            );
        }
    }

    private static ProbeFailure classify(Throwable error) {
        WebClientResponseException response = findResponse(error);
        if (response == null) {
            return new ProbeFailure(TomTomResetProbeOutcome.ERROR, null, errorCode(error));
        }

        int status = response.getStatusCode().value();
        String body = response.getResponseBodyAsString(StandardCharsets.UTF_8);
        String normalizedBody = body.toLowerCase(Locale.ROOT);
        String providerCode = providerCode(body);
        if (
            status == 403
                && (
                    normalizedBody.contains("insufficientfunds")
                        || normalizedBody.contains("not enough credits")
                )
        ) {
            return new ProbeFailure(
                TomTomResetProbeOutcome.CREDITS_EXHAUSTED,
                status,
                providerCode
            );
        }
        if (status == 401 || status == 403) {
            return new ProbeFailure(TomTomResetProbeOutcome.AUTH_FAILED, status, providerCode);
        }
        if (status == 429) {
            return new ProbeFailure(TomTomResetProbeOutcome.RATE_LIMITED, status, providerCode);
        }
        return new ProbeFailure(TomTomResetProbeOutcome.ERROR, status, providerCode);
    }

    private static WebClientResponseException findResponse(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof WebClientResponseException response) return response;
            current = current.getCause();
        }
        return null;
    }

    private static String providerCode(String body) {
        if (body == null || body.isBlank()) return null;
        Matcher matcher = PROVIDER_CODE.matcher(body);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static String errorCode(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null) current = current.getCause();
        return current.getClass().getSimpleName();
    }

    private record ProbeFailure(
        TomTomResetProbeOutcome outcome,
        Integer httpStatus,
        String providerCode
    ) {}
}
