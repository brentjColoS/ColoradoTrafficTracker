package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.example.api_service.dto.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

class DashboardHistoryBlocksTest {
    final TrafficAnalyticsController analytics = mock(TrafficAnalyticsController.class);
    final TrafficController traffic = mock(TrafficController.class);
    final TrafficSpeedZoneTrendRepository zones = mock(TrafficSpeedZoneTrendRepository.class);
    final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-10-08T02:00:00Z"));
    final Clock clock = new Clock() {
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now.get(); }
    };
    final DashboardHistoryBlocks service = new DashboardHistoryBlocks(analytics, traffic, zones, mapper, clock);
    final OffsetDateTime end = OffsetDateTime.parse("2026-06-19T02:51:46.160498Z");

    DashboardHistoryBlocksTest() {
        when(zones.isAvailable()).thenReturn(true);
        when(zones.find(anyString(), any(), any(), anyInt())).thenReturn(List.of());
        when(zones.findEdges(anyString(), any(), any(), any(), any(), anyInt())).thenReturn(List.of());
        when(analytics.trends(anyString(), anyInt(), anyInt(), eq(true), any())).thenAnswer(call -> {
            OffsetDateTime until = call.getArgument(4);
            int hours = call.getArgument(1);
            return ResponseEntity.ok(new TrafficTrendResponseDto(call.getArgument(0), until.minusHours(hours), hours, 0, List.of()));
        });
        when(traffic.history(anyString(), anyInt(), anyInt(), eq(true), eq(false), any())).thenAnswer(call -> {
            OffsetDateTime until = call.getArgument(5);
            int minutes = call.getArgument(1), limit = call.getArgument(2);
            return ResponseEntity.ok(new TrafficHistoryResponseDto(call.getArgument(0), until.minusMinutes(minutes), minutes, limit, 0, List.of()));
        });
    }

    static CorridorTrendPointDto trend(OffsetDateTime at) {
        return new CorridorTrendPointDto(at, 60L, 51.2, 65.0, 23.0, 0.9, 2.0, 51.0, 60.0, 4L, 60L);
    }

    static TrafficSampleDto sample(OffsetDateTime at, long id) {
        return new TrafficSampleDto(id, id, "I25", "LIVE", 51.2, 65.0, 23.0, 0.9, 14, 2.0,
            40.0, 51.0, 60.0, "state", "flow", false, null, "TomTom", "flow", 10, 60,
            "CDOT", "events", at, at, 300, 0, null, at, true, at.plusDays(7));
    }

    static TrafficSpeedZoneTrendRepository.TrendPoint zone(Instant at, int posted, double endMile, double speed, long count) {
        return new TrafficSpeedZoneTrendRepository.TrendPoint("zone", 0, "Mountain", "Historical definition",
            206, endMile, posted, at, speed, speed - 2, count);
    }

    @Test void overlappingHourlyWindowsOnlyLoadMissingDaysAndKeepExactBounds() {
        var first = service.trends("I25", 193, end).getBody();
        service.trends("I25", 171, end.minusHours(1));
        verify(analytics, times(1)).trends(eq("I25"), anyInt(), anyInt(), eq(true), any());
        service.trends("I25", 193, end.minusDays(1));
        verify(analytics, times(2)).trends(eq("I25"), anyInt(), anyInt(), eq(true), any());
        assertEquals(end.minusHours(193), first.since());
        assertEquals(193, first.windowHours());
        service.trends("I70", 193, end);
        verify(analytics, times(1)).trends(eq("I70"), anyInt(), anyInt(), eq(true), any());
    }

    @Test void hourlyRowsKeepArchiveStatisticsAndExcludeBucketsOutsideExactWindow() {
        var start = end.minusHours(2);
        var inside = trend(end.withMinute(0).withSecond(0).withNano(0));
        var outside = trend(start.minusHours(1).withMinute(0).withSecond(0).withNano(0));
        when(analytics.trends(anyString(), anyInt(), anyInt(), eq(true), any())).thenReturn(
            ResponseEntity.ok(new TrafficTrendResponseDto("I25", start, 24, 2, List.of(inside, outside))));
        assertEquals(List.of(inside), service.trends("I25", 2, end).getBody().buckets());
    }

    @Test void rawSamplesRemainPreciseInclusiveOrderedCappedAndArchiveInclusive() {
        var left = sample(end.minusMinutes(120), 1);
        var right = sample(end, 2);
        var outside = sample(end.plusNanos(1000), 3);
        when(traffic.history(anyString(), anyInt(), anyInt(), eq(true), eq(false), any())).thenReturn(
            ResponseEntity.ok(new TrafficHistoryResponseDto("I25", end.minusHours(4), 240, 2000, 3, List.of(left, outside, right))));
        var result = service.history("I25", 120, 2, end).getBody();
        assertEquals(List.of(right, left), result.samples());
        assertEquals(2, result.returned());
        assertEquals(end.minusMinutes(120), result.since());
        assertEquals(2, result.limit());
        assertEquals(List.of(right), service.history("I25", 120, 1, end).getBody().samples());
        verify(traffic, times(1)).history(eq("I25"), anyInt(), eq(2000), eq(true), eq(false), any());
    }

    @Test void cappedRawBlocksFallBackToExactWindowInsteadOfHidingInteriorSamples() {
        var cap = IntStream.range(0, 2000).mapToObj(i -> sample(end.plusMinutes(20).minusSeconds(i), i)).toList();
        var expected = new TrafficHistoryResponseDto("I25", end.minusHours(2), 120, 180, 1, List.of(sample(end, 5000)));
        when(traffic.history(anyString(), anyInt(), eq(2000), eq(true), eq(false), any())).thenReturn(
            ResponseEntity.ok(new TrafficHistoryResponseDto("I25", end.minusHours(4), 240, 2000, 2000, cap)));
        when(traffic.history("I25", 120, 180, true, false, end)).thenReturn(ResponseEntity.ok(expected));
        assertEquals(expected, service.history("I25", 120, 180, end).getBody());
        verify(traffic).history("I25", 120, 180, true, false, end);
    }

    @Test void aCappedGroupSplitsIntoCompleteBlocksBeforeAssembly() {
        when(traffic.history(anyString(), anyInt(), eq(2000), eq(true), eq(false), any())).thenAnswer(call -> {
            int minutes = call.getArgument(1);
            OffsetDateTime until = call.getArgument(5);
            var rows = minutes > 120 ? IntStream.range(0, 2000).mapToObj(i -> sample(until.minusSeconds(i), i)).toList()
                : List.of(sample(until.minusMinutes(1), until.toEpochSecond()));
            return ResponseEntity.ok(new TrafficHistoryResponseDto("I25", until.minusMinutes(minutes), minutes, 2000, rows.size(), rows));
        });
        assertFalse(service.history("I25", 360, 420, end).getBody().samples().isEmpty());
        verify(traffic, times(4)).history(eq("I25"), eq(120), eq(2000), eq(true), eq(false), any());
        service.history("I25", 120, 180, end);
        verify(traffic, times(5)).history(eq("I25"), anyInt(), eq(2000), eq(true), eq(false), any());
    }

    @Test void zoneEdgesReplaceFullBucketsAndRetainChangedDefinitions() {
        Instant first = Instant.parse("2026-06-18T03:00:00Z"), last = Instant.parse("2026-06-19T02:45:00Z");
        var oldDefinition = zone(first, 60, 213.1, 52, 14);
        var newDefinition = zone(first, 65, 215, 54, 6);
        when(zones.find(anyString(), any(), any(), eq(15))).thenReturn(List.of(
            zone(first.minusSeconds(900), 60, 213.1, 80, 100), oldDefinition, newDefinition,
            zone(last, 60, 213.1, 80, 100)));
        var partial = zone(last, 60, 213.1, 31, 2);
        when(zones.findEdges("I70", end.minusHours(24).toInstant(), first, last, end.toInstant(), 15))
            .thenReturn(List.of(partial));
        var response = service.zones("I70", 24, end).getBody();
        assertEquals(3, response.returned());
        assertEquals(2, response.availableBucketCount());
        assertEquals(List.of(60, 65, 60), response.points().stream().map(TrafficSpeedZoneTrendPointDto::postedSpeedMph).toList());
        assertEquals(List.of(52.0, 54.0, 31.0), response.points().stream().map(TrafficSpeedZoneTrendPointDto::avgCurrentSpeed).toList());
        assertEquals(List.of(14L, 6L, 2L), response.points().stream().map(TrafficSpeedZoneTrendPointDto::observationCount).toList());
        assertEquals(first, response.firstObservedAt());
        assertEquals(last, response.lastObservedAt());
        assertEquals(end.minusHours(24).toInstant(), response.windowStart());
        assertEquals(end.toInstant(), response.windowEnd());
    }

    @Test void overlappingZoneWindowsReuseFullBlocksButAlwaysReadExactEdges() {
        service.zones("I70", 720, end);
        service.zones("I70", 720, end.minusHours(1));
        verify(zones, times(1)).find(eq("I70"), any(), any(), eq(180));
        verify(zones, times(2)).findEdges(eq("I70"), any(), any(), any(), any(), eq(180));
        service.zones("I70", 168, end);
        verify(zones).find(eq("I70"), any(), any(), eq(60));
    }

    @Test void everyResolutionKeepsSupportedRangeAndEmptyOrUnavailableStatus() {
        for (int hours : List.of(2, 6, 24, 168, 720)) {
            assertEquals(404, service.zones("I25", hours, end).getStatusCode().value());
        }
        when(zones.isAvailable()).thenReturn(false);
        assertEquals(503, service.zones("I25", 24, end).getStatusCode().value());
        assertThrows(IllegalArgumentException.class, () -> service.zones("I25", 3, end));
    }

    @Test void alignedInclusiveEndIsStillQueriedWithoutDuplicatingCompleteBucket() {
        var aligned = end.withMinute(0).withSecond(0).withNano(0);
        service.zones("I25", 2, aligned);
        verify(zones).findEdges("I25", aligned.minusHours(2).toInstant(), aligned.minusHours(2).toInstant(),
            aligned.toInstant(), aligned.toInstant(), 1);
    }

    @Test void utcKeysReuseSameInstantsAcrossOffsetsAndDaylightSaving() {
        var transition = OffsetDateTime.parse("2026-11-01T01:30:00-06:00");
        service.trends("I25", 193, transition);
        service.trends("I25", 193, transition.withOffsetSameInstant(ZoneOffset.ofHours(-7)));
        verify(analytics, times(1)).trends(eq("I25"), anyInt(), anyInt(), eq(true), any());
        assertEquals(ZoneOffset.UTC, service.trends("I25", 193, transition).getBody().since().getOffset());
    }

    @Test void historicalBlocksRefreshAtTenMinutesAndRecentBlocksAtOneMinute() {
        service.trends("I25", 2, end);
        now.set(now.get().plusSeconds(599));
        service.trends("I25", 2, end);
        verify(analytics, times(1)).trends(eq("I25"), anyInt(), anyInt(), eq(true), any());
        now.set(now.get().plusSeconds(1));
        service.trends("I25", 2, end);
        verify(analytics, times(2)).trends(eq("I25"), anyInt(), anyInt(), eq(true), any());
        var recent = OffsetDateTime.now(clock);
        service.history("I70", 120, 180, recent);
        now.set(now.get().plusSeconds(59));
        service.history("I70", 120, 180, recent);
        verify(traffic, times(1)).history(eq("I70"), anyInt(), anyInt(), eq(true), eq(false), any());
        now.set(now.get().plusSeconds(1));
        service.history("I70", 120, 180, recent);
        verify(traffic, times(2)).history(eq("I70"), anyInt(), anyInt(), eq(true), eq(false), any());
    }

    @Test void failedReadsDoNotPoisonCacheOrKeepTheColdReadLock() {
        when(analytics.trends(anyString(), anyInt(), anyInt(), eq(true), any()))
            .thenReturn(ResponseEntity.status(503).build())
            .thenReturn(ResponseEntity.ok(new TrafficTrendResponseDto("I25", end.minusHours(2), 2, 0, List.of())));
        assertThrows(IllegalStateException.class, () -> service.trends("I25", 2, end));
        assertNotNull(service.trends("I25", 2, end).getBody());
    }

    @Test void simultaneousOverlappingColdReadsCoalesceAndWarmReadsBypassLoader() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(analytics.trends(anyString(), anyInt(), anyInt(), eq(true), any())).thenAnswer(call -> {
            entered.countDown();
            assertTrue(release.await(2, TimeUnit.SECONDS));
            return ResponseEntity.ok(new TrafficTrendResponseDto("I25", end.minusHours(2), 2, 0, List.of()));
        });
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<?> first = pool.submit(() -> service.trends("I25", 2, end));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            Future<?> second = pool.submit(() -> service.trends("I25", 2, end.minusMinutes(1)));
            release.countDown();
            first.get(3, TimeUnit.SECONDS); second.get(3, TimeUnit.SECONDS);
            service.trends("I25", 2, end);
            verify(analytics, times(1)).trends(eq("I25"), anyInt(), anyInt(), eq(true), any());
        } finally { release.countDown(); }
    }

    @Test void interruptedWaitPreservesInterruptAndLeavesSubsequentReadsUsable() {
        Thread.currentThread().interrupt();
        try {
            var failure = assertThrows(IllegalStateException.class, () -> service.trends("I25", 2, end));
            assertTrue(failure.getCause() instanceof InterruptedException);
            assertTrue(Thread.currentThread().isInterrupted());
        } finally { Thread.interrupted(); }
        assertNotNull(service.trends("I25", 2, end).getBody());
    }

    @Test void responseLargerThanCacheStillFinishesWithoutReloadLoop() throws Exception {
        ObjectMapper large = mock(ObjectMapper.class);
        when(large.writeValueAsBytes(any())).thenReturn(new byte[17 * 1024 * 1024]);
        var smallCache = new DashboardHistoryBlocks(analytics, traffic, zones, large, clock);
        assertNotNull(smallCache.trends("I25", 193, end).getBody());
        verify(analytics, times(1)).trends(eq("I25"), anyInt(), anyInt(), eq(true), any());
    }

    @Test void serializationFailureReleasesLockAndDoesNotCacheInvalidData() throws Exception {
        ObjectMapper broken = mock(ObjectMapper.class);
        when(broken.writeValueAsBytes(any())).thenThrow(new com.fasterxml.jackson.core.JsonProcessingException("bad payload") {});
        var service = new DashboardHistoryBlocks(analytics, traffic, zones, broken, clock);
        assertThrows(IllegalStateException.class, () -> service.trends("I25", 2, end));
        doReturn(new byte[0]).when(broken).writeValueAsBytes(any());
        assertNotNull(service.trends("I25", 2, end).getBody());
        verify(analytics, times(2)).trends(eq("I25"), anyInt(), anyInt(), eq(true), any());
    }
}
