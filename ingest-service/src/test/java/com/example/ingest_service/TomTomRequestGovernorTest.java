package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.time.LocalDate;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;

class TomTomRequestGovernorTest {

    @Test
    void everyRetryReservesAnotherProductRequest() {
        TrafficRequestBudget budget = allowingBudget();
        TomTomRequestGovernor governor = new TomTomRequestGovernor(budget, pullProps());
        AtomicInteger attempts = new AtomicInteger();

        String result = governor.flowSegment(() -> Mono.defer(() -> {
            if (attempts.incrementAndGet() < 3) {
                return Mono.error(new IOException("temporary failure"));
            }
            return Mono.just("ok");
        })).retry(2).block();

        assertThat(result).isEqualTo("ok");
        assertThat(attempts).hasValue(3);
        verify(budget, times(3)).reserveMonthly(
            TomTomRequestGovernor.PROVIDER,
            TomTomRequestGovernor.FLOW_SEGMENT_PRODUCT,
            1,
            19_500
        );
    }

    @Test
    void aBlockedReservationDoesNotCreateTheProviderRequest() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        when(budget.reserveMonthly(anyString(), anyString(), anyInt(), anyInt()))
            .thenReturn(new TrafficRequestBudget.MonthlyReservation(
                false,
                0,
                2_450,
                2_450,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 8, 1),
                TomTomRequestGovernor.PROVIDER,
                TomTomRequestGovernor.INCIDENT_DETAILS_PRODUCT
            ));
        TomTomRequestGovernor governor = new TomTomRequestGovernor(budget, pullProps());
        AtomicInteger requests = new AtomicInteger();

        assertThatThrownBy(() -> governor.incidentDetails(() -> {
            requests.incrementAndGet();
            return Mono.just("not called");
        }).block())
            .isInstanceOf(TomTomRequestQuotaExceededException.class)
            .hasMessageContaining(TomTomRequestGovernor.INCIDENT_DETAILS_PRODUCT);
        assertThat(requests).hasValue(0);
    }

    private static TrafficRequestBudget allowingBudget() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        when(budget.reserveMonthly(anyString(), anyString(), anyInt(), anyInt()))
            .thenAnswer(invocation -> new TrafficRequestBudget.MonthlyReservation(
                true,
                1,
                1,
                invocation.getArgument(3),
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 8, 1),
                invocation.getArgument(0),
                invocation.getArgument(1)
            ));
        return budget;
    }

    private static TrafficPullProps pullProps() {
        return new TrafficPullProps(
            new TrafficPullProps.Flow(true, "tomtom", 125, 10, ""),
            new TrafficPullProps.Incidents(true, "cdot", 900, 9),
            new TrafficPullProps.MonthlyRequestBudget(190_000, 195_000, 200_000)
        );
    }
}
