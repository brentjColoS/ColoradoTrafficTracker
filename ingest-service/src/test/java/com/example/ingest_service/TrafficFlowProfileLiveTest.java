package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import reactor.core.publisher.Mono;

@EnabledIfEnvironmentVariable(named = "TOMTOM_LIVE_PROFILE_TEST", matches = "true")
class TrafficFlowProfileLiveTest {

    private static final int DEFAULT_MAX_REQUESTS = 20;

    @Test
    void comparesOneBoundedCycleForEachCandidateProfile() throws Exception {
        String apiKey = requiredEnvironment("TOMTOM_API_KEY");
        int maxRequests = integerEnvironment("TOMTOM_LIVE_PROFILE_MAX_REQUESTS", DEFAULT_MAX_REQUESTS);
        AtomicInteger issuedRequests = new AtomicInteger();
        TrafficRequestBudget budget = boundedBudget(maxRequests);
        List<TrafficProps.Corridor> corridors = corridors();

        ProfileResult z10 = runProfile(
            new Profile("z10-125s", 10, 125),
            corridors,
            apiKey,
            maxRequests,
            issuedRequests,
            budget
        );
        ProfileResult z9 = runProfile(
            new Profile("z9-60s", 9, 60),
            corridors,
            apiKey,
            maxRequests,
            issuedRequests,
            budget
        );

        assertThat(issuedRequests.get()).isLessThanOrEqualTo(maxRequests);
        assertUseful(z10, corridors.size());
        assertUseful(z9, corridors.size());
        printResult(z10);
        printResult(z9);
        System.out.printf(
            "LIVE_PROFILE_TOTAL requests=%d ceiling=%d%n",
            issuedRequests.get(),
            maxRequests
        );
    }

    private static ProfileResult runProfile(
        Profile profile,
        List<TrafficProps.Corridor> corridors,
        String apiKey,
        int maxRequests,
        AtomicInteger issuedRequests,
        TrafficRequestBudget budget
    ) {
        int requestsBefore = issuedRequests.get();
        Map<String, TrafficSample> samples = new LinkedHashMap<>();
        Map<String, List<TrafficSpeedZoneSample>> zones = new LinkedHashMap<>();
        TrafficSampleWriter writer = mock(TrafficSampleWriter.class);
        when(writer.saveSampleWithIncidentsAndZones(any(TrafficSample.class), any()))
            .thenAnswer(invocation -> {
                TrafficSample sample = invocation.getArgument(0);
                List<TrafficSpeedZoneSample> zoneSamples = invocation.getArgument(1);
                samples.put(sample.getCorridor(), sample);
                zones.put(sample.getCorridor(), List.copyOf(zoneSamples));
                return sample;
            });

        TrafficPullProps pullProps = new TrafficPullProps(
            new TrafficPullProps.Flow(true, "tomtom", profile.pollSeconds(), profile.zoom(), ""),
            new TrafficPullProps.Incidents(true, "cdot", 900, 9),
            new TrafficPullProps.MonthlyRequestBudget(190_000, 195_000, 200_000)
        );
        TrafficProps trafficProps = new TrafficProps(
            apiKey,
            profile.pollSeconds(),
            "tile",
            profile.zoom(),
            "",
            2,
            500,
            0,
            0,
            0,
            false
        );
        TomTomAccountQuotaManager quotaManager = new TomTomAccountQuotaManager(
            new TomTomAccountPool(trafficProps, new TomTomAccountsProps("", false, true)),
            budget
        );
        TileTrafficPoller poller = new TileTrafficPoller(
            liveWebClient(issuedRequests, maxRequests),
            trafficProps,
            pullProps,
            writer,
            mock(CorridorGeometryStore.class),
            mock(TrafficProviderGuardService.class),
            quotaManager,
            mock(TomTomRequestGovernor.class),
            new IncidentSnapshotStore(),
            new SimpleMeterRegistry()
        );

        Map<String, ProviderCycleSnapshot> snapshots = poller.pollFlowAndPersist(corridors);
        return new ProfileResult(
            profile,
            issuedRequests.get() - requestsBefore,
            snapshots,
            Map.copyOf(samples),
            Map.copyOf(zones)
        );
    }

    private static WebClient liveWebClient(AtomicInteger issuedRequests, int maxRequests) {
        DefaultUriBuilderFactory factory = new DefaultUriBuilderFactory("https://api.tomtom.com");
        factory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.VALUES_ONLY);
        return WebClient.builder()
            .uriBuilderFactory(factory)
            .filter((request, next) -> {
                int requestNumber = issuedRequests.incrementAndGet();
                if (requestNumber > maxRequests) {
                    return Mono.error(new IllegalStateException(
                        "Live profile request ceiling reached before issuing request " + requestNumber
                    ));
                }
                return next.exchange(ClientRequest.from(request).build());
            })
            .build();
    }

    private static TrafficRequestBudget boundedBudget(int maxRequests) {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        AtomicLong used = new AtomicLong();
        YearMonth month = YearMonth.now(ZoneOffset.UTC);
        LocalDate start = month.atDay(1);
        LocalDate end = month.plusMonths(1).atDay(1);

        when(budget.monthlyUsageForAccount(anyString(), anyString(), anyString())).thenAnswer(invocation ->
            new TrafficRequestBudget.MonthlyUsage(
                used.get(),
                start,
                end,
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            )
        );
        when(budget.reserveMonthlyForAccount(
            anyString(),
            anyString(),
            anyString(),
            anyInt(),
            anyInt()
        )).thenAnswer(invocation -> {
            int requested = invocation.getArgument(3);
            long current = used.get();
            boolean allowed = current + requested <= maxRequests;
            if (allowed) used.addAndGet(requested);
            return new TrafficRequestBudget.MonthlyReservation(
                allowed,
                allowed ? requested : 0,
                used.get(),
                invocation.getArgument(4),
                start,
                end,
                invocation.getArgument(0),
                invocation.getArgument(1),
                invocation.getArgument(2)
            );
        });
        doAnswer(invocation -> {
            TrafficRequestBudget.MonthlyReservation reservation = invocation.getArgument(0);
            int requestedRelease = invocation.getArgument(1);
            used.addAndGet(-Math.min(requestedRelease, reservation.callsReserved()));
            return null;
        }).when(budget).releaseMonthly(any(TrafficRequestBudget.MonthlyReservation.class), anyInt());
        return budget;
    }

    private static List<TrafficProps.Corridor> corridors() throws Exception {
        Path routeDirectory = locateRouteDirectory();
        return List.of(
            new TrafficProps.Corridor(
                "I25",
                "Interstate 25",
                "I-25",
                "S",
                "N",
                271.0,
                208.0,
                List.of(),
                "40.627367,-105.031128,39.700390,-104.970703",
                Files.readString(routeDirectory.resolve("i25.geojson")),
                null,
                550.0
            ),
            new TrafficProps.Corridor(
                "I70",
                "Interstate 70",
                "I-70",
                "E",
                "W",
                206.0,
                259.0,
                List.of(),
                "39.797997,-106.437378,39.492291,-104.963837",
                Files.readString(routeDirectory.resolve("i70.geojson")),
                null,
                550.0
            )
        );
    }

    private static Path locateRouteDirectory() {
        List<Path> candidates = List.of(
            Path.of("routes-service", "src", "main", "resources", "routes"),
            Path.of("..", "routes-service", "src", "main", "resources", "routes")
        );
        return candidates.stream()
            .filter(Files::isDirectory)
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("Unable to locate route geometry resources"));
    }

    private static void assertUseful(ProfileResult result, int expectedCorridors) {
        assertThat(result.snapshots()).hasSize(expectedCorridors);
        assertThat(result.samples()).hasSize(expectedCorridors);
        assertThat(result.samples().values())
            .allSatisfy(sample -> {
                assertThat(sample.getFlowSourceZoom()).isEqualTo(result.profile().zoom());
                assertThat(sample.getSpeedSampleCount()).isPositive();
                assertThat(sample.getP10Speed()).isNotNull();
                assertThat(sample.getP50Speed()).isNotNull();
                assertThat(sample.getP90Speed()).isNotNull();
            });
    }

    private static void printResult(ProfileResult result) {
        System.out.printf(
            "LIVE_PROFILE_RESULT profile=%s requests=%d corridors=%d%n",
            result.profile().name(),
            result.requests(),
            result.samples().size()
        );
        result.samples().forEach((corridor, sample) -> System.out.printf(
            "LIVE_PROFILE_CORRIDOR profile=%s corridor=%s samples=%d zones=%d p10=%.2f p50=%.2f p90=%.2f%n",
            result.profile().name(),
            corridor,
            sample.getSpeedSampleCount(),
            result.zones().getOrDefault(corridor, List.of()).size(),
            sample.getP10Speed(),
            sample.getP50Speed(),
            sample.getP90Speed()
        ));
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " must be set for the live profile test");
        }
        return value.trim();
    }

    private static int integerEnvironment(String name, int defaultValue) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) return defaultValue;
        int parsed = Integer.parseInt(value.trim());
        if (parsed < 1) throw new IllegalArgumentException(name + " must be positive");
        return parsed;
    }

    private record Profile(String name, int zoom, int pollSeconds) {}

    private record ProfileResult(
        Profile profile,
        int requests,
        Map<String, ProviderCycleSnapshot> snapshots,
        Map<String, TrafficSample> samples,
        Map<String, List<TrafficSpeedZoneSample>> zones
    ) {}
}
