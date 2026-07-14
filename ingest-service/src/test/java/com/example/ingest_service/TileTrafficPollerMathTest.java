package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.springframework.web.reactive.function.client.WebClient;

class TileTrafficPollerMathTest {

    @Test
    void normalizeBboxAndTileCoverageHelpersWorkForRouteBounds() throws Exception {
        double[] normalized = (double[]) invokeStatic(
            "normalizeBbox",
            new Class<?>[]{String.class},
            "40.627367,-105.031128,39.700390,-104.970703"
        );
        @SuppressWarnings("unchecked")
        Set<?> tiles = (Set<?>) invokeStatic(
            "tileKeysForBbox",
            new Class<?>[]{String.class, int.class},
            "40.627367,-105.031128,39.700390,-104.970703",
            10
        );

        assertThat(normalized[0]).isLessThan(normalized[2]);
        assertThat(normalized[1]).isLessThan(normalized[3]);
        assertThat(tiles).isNotEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void samplePerMileReturnsInteriorSamplesForLongPolyline() throws Exception {
        List<double[]> polyline = List.of(
            new double[]{39.7000, -105.0300},
            new double[]{39.7400, -105.0000},
            new double[]{39.7800, -104.9700}
        );

        List<double[]> samples = (List<double[]>) invokeStatic(
            "samplePerMile",
            new Class<?>[]{List.class, double.class},
            polyline,
            1609.344
        );

        assertThat(samples).isNotEmpty();
        assertThat(samples.get(0)).hasSize(2);
    }

    @Test
    void roadTypeClassifierAndTagReaderHandleCommonCases() throws Exception {
        boolean motorway = (boolean) invokeStatic("isCorridorRoadType", new Class<?>[]{String.class}, "motorway");
        boolean numericRoadType = (boolean) invokeStatic("isCorridorRoadType", new Class<?>[]{String.class}, "1");
        boolean residential = (boolean) invokeStatic("isCorridorRoadType", new Class<?>[]{String.class}, "residential");

        Double fromNumber = (Double) invokeStatic(
            "getDoubleTag",
            new Class<?>[]{Map.class, String[].class},
            Map.of("traffic_level", 62),
            new String[]{"traffic_level"}
        );
        Double fromText = (Double) invokeStatic(
            "getDoubleTag",
            new Class<?>[]{Map.class, String[].class},
            Map.of("traffic_level", "45.5"),
            new String[]{"traffic_level"}
        );

        assertThat(motorway).isTrue();
        assertThat(numericRoadType).isTrue();
        assertThat(residential).isFalse();
        assertThat(fromNumber).isEqualTo(62.0);
        assertThat(fromText).isEqualTo(45.5);
    }

    @Test
    void quotaReservationAndRollbackAreConsistent() throws Exception {
        TrafficRequestBudget budget = statefulBudget();
        TileTrafficPoller poller = new TileTrafficPoller(
            WebClient.builder().build(),
            new TrafficProps("key", 60, "tile", 10, "", 2, 500.0, 35_000, 38_000, 40_000, true),
            mock(TrafficSampleWriter.class),
            mock(CorridorGeometryStore.class),
            mock(TrafficProviderGuardService.class),
            budget,
            new SimpleMeterRegistry()
        );

        Object decision = invokeInstance(
            poller,
            "reserveQuota",
            new Class<?>[]{long.class, int.class},
            30L,
            100
        );
        boolean allowed = (boolean) invokeRecordAccessor(decision, "allowed");
        long reserved = (long) invokeRecordAccessor(decision, "callsReserved");

        long usedAfterReserve = (long) invokeInstance(poller, "requestsUsedToday", new Class<?>[]{});
        invokeInstance(poller, "rollbackReservedQuota", new Class<?>[]{long.class}, 10L);
        long usedAfterRollback = (long) invokeInstance(poller, "requestsUsedToday", new Class<?>[]{});

        assertThat(allowed).isTrue();
        assertThat(reserved).isEqualTo(30L);
        assertThat(usedAfterReserve).isEqualTo(30L);
        assertThat(usedAfterRollback).isEqualTo(20L);
    }

    @Test
    void pollAndPersistNoopsForEmptyInput() {
        TileTrafficPoller poller = new TileTrafficPoller(
            WebClient.builder().build(),
            new TrafficProps("key", 60, "tile", 10, "", 2, 500.0, 35_000, 38_000, 40_000, true),
            mock(TrafficSampleWriter.class),
            mock(CorridorGeometryStore.class),
            mock(TrafficProviderGuardService.class),
            mock(TrafficRequestBudget.class),
            new SimpleMeterRegistry()
        );

        assertThat(poller.pollAndPersist(List.of(), "key")).isEmpty();
        assertThat(poller.pollAndPersist(null, "key")).isEmpty();
    }

    private static TrafficRequestBudget statefulBudget() {
        TrafficRequestBudget budget = mock(TrafficRequestBudget.class);
        AtomicLong used = new AtomicLong();
        when(budget.usedToday(anyString())).thenAnswer(invocation -> used.get());
        when(budget.reserve(anyString(), anyInt(), anyInt())).thenAnswer(invocation -> {
            int count = invocation.getArgument(1);
            int limit = invocation.getArgument(2);
            long next = used.get() + count;
            if (next > limit) return new TrafficRequestBudget.Reservation(false, used.get(), limit);
            used.set(next);
            return new TrafficRequestBudget.Reservation(true, next, limit);
        });
        doAnswer(invocation -> {
            int count = invocation.getArgument(1);
            used.updateAndGet(value -> Math.max(0, value - count));
            return null;
        }).when(budget).release(anyString(), anyInt());
        return budget;
    }

    private static Object invokeStatic(String name, Class<?>[] argTypes, Object... args) throws Exception {
        Method method = TileTrafficPoller.class.getDeclaredMethod(name, argTypes);
        method.setAccessible(true);
        return method.invoke(null, args);
    }

    private static Object invokeInstance(Object target, String name, Class<?>[] argTypes, Object... args) throws Exception {
        Method method = TileTrafficPoller.class.getDeclaredMethod(name, argTypes);
        method.setAccessible(true);
        return method.invoke(target, args);
    }

    private static Object invokeRecordAccessor(Object record, String accessorName) throws Exception {
        Method method = record.getClass().getDeclaredMethod(accessorName);
        method.setAccessible(true);
        return method.invoke(record);
    }
}
