package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

class TomTomRequestGovernorTest {

    @Test
    void everyRetryReservesAnotherProductRequest() {
        TomTomAccountQuotaManager quotaManager = allowingQuotaManager();
        TomTomRequestGovernor governor = new TomTomRequestGovernor(quotaManager, pullProps());
        AtomicInteger attempts = new AtomicInteger();

        String result = governor.flowSegment(account -> Mono.defer(() -> {
            if (attempts.incrementAndGet() < 3) {
                return Mono.error(new IOException("temporary failure"));
            }
            return Mono.just("ok");
        })).retry(2).block();

        assertThat(result).isEqualTo("ok");
        assertThat(attempts).hasValue(3);
        verify(quotaManager, times(3)).reserveUpTo(
            TomTomRequestGovernor.FLOW_SEGMENT_PRODUCT,
            1,
            19_500
        );
    }

    @Test
    void aBlockedReservationDoesNotCreateTheProviderRequest() {
        TomTomAccountQuotaManager quotaManager = mock(TomTomAccountQuotaManager.class);
        when(quotaManager.reserveUpTo(
            TomTomRequestGovernor.INCIDENT_DETAILS_PRODUCT,
            1,
            2_450
        )).thenReturn(Optional.empty());
        when(quotaManager.configuredAccountCount()).thenReturn(1);
        when(quotaManager.snapshots(
            TomTomRequestGovernor.INCIDENT_DETAILS_PRODUCT,
            2_450,
            2_450,
            2_450
        )).thenReturn(List.of(new TomTomAccountQuotaManager.AccountQuotaSnapshot(
            "primary",
            2_450,
            2_450,
            2_450,
            2_450,
            LocalDate.of(2026, 7, 1),
            LocalDate.of(2026, 8, 1)
        )));
        TomTomRequestGovernor governor = new TomTomRequestGovernor(quotaManager, pullProps());
        AtomicInteger requests = new AtomicInteger();

        assertThatThrownBy(() -> governor.incidentDetails(account -> {
            requests.incrementAndGet();
            return Mono.just("not called");
        }).block())
            .isInstanceOf(TomTomRequestQuotaExceededException.class)
            .hasMessageContaining(TomTomRequestGovernor.INCIDENT_DETAILS_PRODUCT);
        assertThat(requests).hasValue(0);
    }

    @Test
    void exhaustedCreditsQuarantineOnlyTheSelectedAccount() {
        TomTomAccountQuotaManager quotaManager = allowingQuotaManager();
        TomTomRequestGovernor governor = new TomTomRequestGovernor(quotaManager, pullProps());
        WebClientResponseException insufficientFunds = WebClientResponseException.create(
            403,
            "Forbidden",
            HttpHeaders.EMPTY,
            "{\"detailedError\":{\"code\":\"InsufficientFunds\"}}"
                .getBytes(StandardCharsets.UTF_8),
            StandardCharsets.UTF_8
        );

        assertThatThrownBy(() ->
            governor.flowSegment(account -> Mono.error(insufficientFunds)).block()
        ).isSameAs(insufficientFunds);

        verify(quotaManager).markCreditsExhausted("primary");
    }

    private static TomTomAccountQuotaManager allowingQuotaManager() {
        TomTomAccountQuotaManager quotaManager = mock(TomTomAccountQuotaManager.class);
        TomTomAccount account = new TomTomAccount("primary", "test-key");
        when(quotaManager.reserveUpTo(
            TomTomRequestGovernor.FLOW_SEGMENT_PRODUCT,
            1,
            19_500
        )).thenReturn(Optional.of(new TomTomAccountQuotaManager.AccountReservation(
            account,
            new TrafficRequestBudget.MonthlyReservation(
                true,
                1,
                1,
                19_500,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 8, 1),
                TomTomRequestGovernor.PROVIDER,
                "primary",
                TomTomRequestGovernor.FLOW_SEGMENT_PRODUCT
            )
        )));
        return quotaManager;
    }

    private static TrafficPullProps pullProps() {
        return new TrafficPullProps(
            new TrafficPullProps.Flow(true, "tomtom", 125, 10, ""),
            new TrafficPullProps.Incidents(true, "cdot", 900, 9),
            new TrafficPullProps.MonthlyRequestBudget(190_000, 195_000, 200_000)
        );
    }
}
