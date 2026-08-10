package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;

class TileTrafficPollerAccountSelectionTest {

    private static final String PRODUCT = "traffic-flow-incidents-vector-tiles";

    @Test
    void keepsEachTileBatchOnOneAccountDuringRollover() {
        List<String> keysSeen = Collections.synchronizedList(new ArrayList<>());
        WebClient client = WebClient.builder()
            .exchangeFunction(request -> {
                String query = request.url().getRawQuery();
                keysSeen.add(query != null && query.contains("key=secondary-key")
                    ? "secondary"
                    : "primary");
                return reactor.core.publisher.Mono.just(
                    ClientResponse.create(HttpStatus.OK)
                        .header("Content-Type", "application/x-protobuf")
                        .body("")
                        .build()
                );
            })
            .build();

        TrafficRequestBudget budget = accountBudget();
        TrafficProps trafficProps = new TrafficProps(
            "primary-key",
            125,
            "tile",
            10,
            "",
            1,
            500,
            0,
            0,
            0,
            false
        );
        TomTomAccountQuotaManager quotaManager = new TomTomAccountQuotaManager(
            new TomTomAccountPool(
                trafficProps,
                new TomTomAccountsProps("secondary-key", true, true)
            ),
            budget
        );
        TileTrafficPoller poller = new TileTrafficPoller(
            client,
            trafficProps,
            new TrafficPullProps(
                new TrafficPullProps.Flow(true, "tomtom", 125, 10, ""),
                new TrafficPullProps.Incidents(true, "cdot", 900, 9),
                new TrafficPullProps.MonthlyRequestBudget(190_000, 195_000, 200_000)
            ),
            mock(TrafficSampleWriter.class),
            mock(CorridorGeometryStore.class),
            mock(TrafficProviderGuardService.class),
            quotaManager,
            mock(TomTomRequestGovernor.class),
            new IncidentSnapshotStore(),
            new SimpleMeterRegistry()
        );

        poller.pollFlowAndPersist(List.of(corridor()));
        int firstBatchSize = keysSeen.size();
        poller.pollFlowAndPersist(List.of(corridor()));

        assertThat(firstBatchSize).isPositive();
        assertThat(keysSeen.subList(0, firstBatchSize)).containsOnly("primary");
        assertThat(keysSeen.subList(firstBatchSize, keysSeen.size())).containsOnly("secondary");
    }

    private static TrafficRequestBudget accountBudget() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        Map<String, AtomicLong> usedByAccount = new ConcurrentHashMap<>();
        usedByAccount.put("primary", new AtomicLong(194_996));
        LocalDate start = LocalDate.of(2026, 7, 1);
        LocalDate end = LocalDate.of(2026, 8, 1);

        when(budget.monthlyUsageForAccount(anyString(), anyString(), anyString()))
            .thenAnswer(invocation -> {
                String accountId = invocation.getArgument(1);
                long used = usedByAccount
                    .computeIfAbsent(accountId, ignored -> new AtomicLong())
                    .get();
                return new TrafficRequestBudget.MonthlyUsage(
                    used,
                    start,
                    end,
                    invocation.getArgument(0),
                    accountId,
                    invocation.getArgument(2)
                );
            });
        when(budget.reserveMonthlyForAccount(
            anyString(),
            anyString(),
            anyString(),
            anyInt(),
            anyInt()
        )).thenAnswer(invocation -> {
            String accountId = invocation.getArgument(1);
            int calls = invocation.getArgument(3);
            int limit = invocation.getArgument(4);
            AtomicLong used = usedByAccount.computeIfAbsent(accountId, ignored -> new AtomicLong());
            long next = used.addAndGet(calls);
            return new TrafficRequestBudget.MonthlyReservation(
                next <= limit,
                next <= limit ? calls : 0,
                next,
                limit,
                start,
                end,
                invocation.getArgument(0),
                accountId,
                invocation.getArgument(2)
            );
        });
        return budget;
    }

    private static TrafficProps.Corridor corridor() {
        return new TrafficProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            271.0,
            208.0,
            List.of(),
            "40.61,-105.01,39.69,-104.99",
            "{\"type\":\"LineString\",\"coordinates\":[[-105.0,40.6],[-105.0,39.7]]}",
            null,
            550.0
        );
    }
}
