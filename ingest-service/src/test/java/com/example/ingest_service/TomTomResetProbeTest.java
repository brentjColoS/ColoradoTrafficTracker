package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

class TomTomResetProbeTest {

    private static final Clock CLOCK = Clock.fixed(
        Instant.parse("2026-07-31T04:17:00Z"),
        ZoneOffset.UTC
    );

    @Test
    void probesADormantAccountOnceAndRecordsAvailability() {
        Fixture fixture = fixture("secondary-key", false, true, successfulClient());

        fixture.probe().probeWaitingAccounts();

        verify(fixture.history()).record(
            "secondary",
            TomTomResetProbeOutcome.AVAILABLE,
            200,
            null
        );
        verify(fixture.lease()).tryRun(
            eq("tomtom-reset-probe-secondary-2026-07-31"),
            eq(Duration.ofDays(1)),
            eq(Duration.ofMinutes(2)),
            any(Runnable.class)
        );
    }

    @Test
    void stopsCheckingADormantAccountAfterResetWasObserved() {
        Fixture fixture = fixture("secondary-key", false, true, successfulClient());
        when(fixture.history().latest("secondary")).thenReturn(Optional.of(
            new TomTomResetProbeEvent(
                1,
                "secondary",
                Instant.parse("2026-07-30T04:17:00Z"),
                TomTomResetProbeOutcome.AVAILABLE,
                200,
                null
            )
        ));

        fixture.probe().probeWaitingAccounts();

        verify(fixture.lease(), never()).tryRun(
            anyString(),
            any(Duration.class),
            any(Duration.class),
            any(Runnable.class)
        );
    }

    @Test
    void recordsExhaustedCreditsWithoutRetrying() {
        AtomicInteger requests = new AtomicInteger();
        WebClient client = WebClient.builder()
            .exchangeFunction(request -> {
                requests.incrementAndGet();
                return Mono.just(ClientResponse.create(HttpStatus.FORBIDDEN)
                    .header(HttpHeaders.CONTENT_TYPE, "application/json")
                    .body("""
                        {"detailedError":{"code":"InsufficientFunds","message":"Not enough credits"}}
                        """)
                    .build());
            })
            .build();
        Fixture fixture = fixture("secondary-key", false, true, client);

        fixture.probe().probeWaitingAccounts();

        assertThat(requests).hasValue(1);
        verify(fixture.history()).record(
            "secondary",
            TomTomResetProbeOutcome.CREDITS_EXHAUSTED,
            403,
            "InsufficientFunds"
        );
    }

    @Test
    void checksAnEnabledAccountOnlyAfterItRunsOutOfCredits() {
        Fixture fixture = fixture("", false, true, successfulClient());
        fixture.availability().markCreditsExhausted("primary");

        assertThat(fixture.probe().accountsWaitingForReset())
            .extracting(TomTomAccount::id)
            .containsExactly("primary");
    }

    @Test
    void canDisableResetChecksWithoutRemovingTheDormantCredential() {
        Fixture fixture = fixture("secondary-key", false, false, successfulClient());

        fixture.probe().probeWaitingAccounts();

        verify(fixture.lease(), never()).tryRun(
            anyString(),
            any(Duration.class),
            any(Duration.class),
            any(Runnable.class)
        );
    }

    private static Fixture fixture(
        String secondaryKey,
        boolean secondaryEnabled,
        boolean probeEnabled,
        WebClient client
    ) {
        TomTomAccountsProps props = new TomTomAccountsProps(
            secondaryKey,
            secondaryEnabled,
            probeEnabled
        );
        TomTomAccountPool pool = new TomTomAccountPool(trafficProps(), props);
        TomTomAccountAvailability availability = new TomTomAccountAvailability(pool, CLOCK);
        TomTomResetProbeHistory history = mock(TomTomResetProbeHistory.class);
        TrafficSchedulerLease lease = mock(TrafficSchedulerLease.class);
        when(history.latest(anyString())).thenReturn(Optional.empty());
        when(lease.tryRun(
            anyString(),
            any(Duration.class),
            any(Duration.class),
            any(Runnable.class)
        )).thenAnswer(invocation -> {
            Runnable work = invocation.getArgument(3);
            work.run();
            return true;
        });

        return new Fixture(
            new TomTomResetProbe(
                pool,
                props,
                availability,
                history,
                lease,
                client,
                CLOCK
            ),
            history,
            lease,
            availability
        );
    }

    private static WebClient successfulClient() {
        return WebClient.builder()
            .exchangeFunction(request -> Mono.just(
                ClientResponse.create(HttpStatus.OK)
                    .body("tile")
                    .build()
            ))
            .build();
    }

    private static TrafficProps trafficProps() {
        return new TrafficProps(
            "primary-key",
            60,
            "tile",
            10,
            "",
            2,
            500,
            0,
            0,
            0,
            true
        );
    }

    private record Fixture(
        TomTomResetProbe probe,
        TomTomResetProbeHistory history,
        TrafficSchedulerLease lease,
        TomTomAccountAvailability availability
    ) {}
}
