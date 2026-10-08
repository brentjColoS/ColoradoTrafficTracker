package com.example.api_service;

import com.example.api_service.dto.CorridorTrendPointDto;
import com.example.api_service.dto.TrafficHistoryResponseDto;
import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficSpeedZoneTrendResponseDto;
import com.example.api_service.dto.TrafficTrendResponseDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

@Service
public class DashboardHistoryBlocks {
    private static final class DenseHistory extends RuntimeException {}
    private record Key(String kind, String corridor, int resolution, long start, int seconds) {}
    private record Block(List<?> rows, Instant fetchedAt, int bytes) {}
    private final Cache<Key, Block> cache = Caffeine.newBuilder()
        .maximumWeight(16 * 1024 * 1024).weigher((Key key, Block block) -> block.bytes())
        .expireAfterAccess(Duration.ofHours(12)).build();
    private final ReentrantLock coldRead = new ReentrantLock(true);
    private final TrafficAnalyticsController analytics;
    private final TrafficController traffic;
    private final TrafficSpeedZoneTrendRepository zones;
    private final ObjectMapper mapper;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public DashboardHistoryBlocks(TrafficAnalyticsController analytics, TrafficController traffic,
        TrafficSpeedZoneTrendRepository zones, ObjectMapper mapper) {
        this(analytics, traffic, zones, mapper, Clock.systemUTC());
    }

    DashboardHistoryBlocks(TrafficAnalyticsController analytics, TrafficController traffic,
        TrafficSpeedZoneTrendRepository zones, ObjectMapper mapper, Clock clock) {
        this.analytics = analytics; this.traffic = traffic; this.zones = zones;
        this.mapper = mapper; this.clock = clock;
    }

    public ResponseEntity<TrafficTrendResponseDto> trends(String corridor, int hours, OffsetDateTime end) {
        end = end.withOffsetSameInstant(ZoneOffset.UTC);
        Instant start = end.minusHours(hours).toInstant(), finish = end.toInstant();
        List<CorridorTrendPointDto> rows = rows("trend", corridor, 60, start, finish, 86400).stream()
            .map(CorridorTrendPointDto.class::cast)
            .filter(row -> within(row.bucketStart().toInstant(), start, finish))
            .sorted(Comparator.comparing(CorridorTrendPointDto::bucketStart)).toList();
        return ResponseEntity.ok(new TrafficTrendResponseDto(corridor, end.minusHours(hours), hours, rows.size(), rows));
    }

    public ResponseEntity<TrafficHistoryResponseDto> history(String corridor, int minutes, int limit, OffsetDateTime end) {
        Instant start = end.minusMinutes(minutes).toInstant(), finish = end.toInstant();
        List<?> observations;
        try {
            observations = rows("sample", corridor, 0, start, finish, 7200);
        } catch (DenseHistory dense) {
            // A capped block could hide observations before an exact, interior window end.
            return traffic.history(corridor, minutes, limit, true, false, end);
        }
        List<TrafficSampleDto> rows = observations.stream()
            .map(TrafficSampleDto.class::cast).filter(row -> within(row.polledAt().toInstant(), start, finish))
            .sorted(Comparator.comparing(TrafficSampleDto::polledAt).reversed()).limit(limit).toList();
        return ResponseEntity.ok(new TrafficHistoryResponseDto(corridor, end.minusMinutes(minutes), minutes, limit, rows.size(), rows));
    }

    public ResponseEntity<TrafficSpeedZoneTrendResponseDto> zones(String corridor, int hours, OffsetDateTime end) {
        int minutes = switch (hours) {case 2 -> 1; case 6 -> 5; case 24 -> 15; case 168 -> 60; case 720 -> 180;
            default -> throw new IllegalArgumentException("Unsupported history range");};
        if (!zones.isAvailable()) return ResponseEntity.status(503).build();
        int seconds = switch (minutes) {case 1 -> 7200; case 5 -> 21600; case 180 -> 259200; default -> 86400;};
        Instant start = end.minusHours(hours).toInstant(), finish = end.toInstant();
        long bucket = minutes * 60L;
        Instant firstComplete = Instant.ofEpochSecond(Math.floorDiv(start.getEpochSecond(), bucket) * bucket);
        if (firstComplete.isBefore(start)) firstComplete = firstComplete.plusSeconds(bucket);
        Instant lastComplete = Instant.ofEpochSecond(Math.floorDiv(finish.getEpochSecond(), bucket) * bucket);
        List<TrafficSpeedZoneTrendRepository.TrendPoint> result = new ArrayList<>();
        final Instant left = firstComplete, right = lastComplete;
        if (left.isBefore(right)) rows("zone", corridor, minutes, left, right.minusNanos(1000), seconds).stream()
            .map(TrafficSpeedZoneTrendRepository.TrendPoint.class::cast)
            .filter(row -> !row.bucketStart().isBefore(left) && row.bucketStart().isBefore(right)).forEach(result::add);
        // Full cached buckets cannot represent averages of a partially selected bucket.
        result.addAll(zones.findEdges(corridor, start, left, right, finish, minutes));
        result.sort(Comparator.comparing(TrafficSpeedZoneTrendRepository.TrendPoint::bucketStart)
            .thenComparingInt(TrafficSpeedZoneTrendRepository.TrendPoint::zoneOrder));
        return TrafficSpeedZoneTrendController.trendResponse(corridor, hours, start, finish, minutes, result);
    }

    private static boolean within(Instant time, Instant start, Instant finish) {
        return !time.isBefore(start) && !time.isAfter(finish);
    }

    private List<?> rows(String kind, String corridor, int resolution, Instant start, Instant finish, int seconds) {
        List<Key> keys = new ArrayList<>();
        for (long time = Math.floorDiv(start.getEpochSecond(), seconds) * seconds;
            time <= finish.getEpochSecond(); time += seconds) keys.add(new Key(kind, corridor, resolution, time, seconds));
        List<Block> blocks = keys.stream().map(this::fresh).toList();
        if (blocks.stream().allMatch(java.util.Objects::nonNull)) return flatten(blocks);
        boolean locked = false;
        try {
            locked = coldRead.tryLock(5, TimeUnit.SECONDS);
            if (!locked) throw new IllegalStateException("Historical read capacity is busy; retry this window");
            Map<Key, Block> requested = new HashMap<>();
            for (Key key : keys) {
                Block block = fresh(key);
                if (block != null) requested.put(key, block);
            }
            List<Key> missing = keys.stream().filter(key -> !requested.containsKey(key)).toList();
            for (int first = 0; first < missing.size();) {
                int last = first;
                while (last + 1 < missing.size() && missing.get(last + 1).start() == missing.get(last).start() + seconds) last++;
                List<Key> group = missing.subList(first, last + 1);
                List<Block> loaded = load(group);
                for (int index = 0; index < group.size(); index++) requested.put(group.get(index), loaded.get(index));
                first = last + 1;
            }
            // Keep the requested blocks even if this unusually large window exceeds cache weight.
            return flatten(keys.stream().map(requested::get).toList());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Historical read was interrupted", error);
        } finally {
            if (locked) coldRead.unlock();
        }
    }

    private Block fresh(Key key) {
        Block block = cache.getIfPresent(key);
        int lifetime = key.start() + key.seconds() > clock.instant().minusSeconds(3600).getEpochSecond() ? 60 : 600;
        return block != null && block.fetchedAt().plusSeconds(lifetime).isAfter(clock.instant()) ? block : null;
    }

    private static List<?> flatten(List<Block> blocks) { return blocks.stream().flatMap(block -> block.rows().stream()).toList(); }

    private List<Block> load(List<Key> keys) {
        Key first = keys.get(0), last = keys.get(keys.size() - 1);
        Instant start = Instant.ofEpochSecond(first.start());
        Instant finish = Instant.ofEpochSecond(last.start() + last.seconds()).minusNanos(1000);
        OffsetDateTime end = finish.atOffset(ZoneOffset.UTC);
        int seconds = keys.size() * first.seconds();
        List<?> loaded = switch (first.kind()) {
            case "trend" -> body(analytics.trends(first.corridor(), seconds / 3600, seconds / 3600 + 1, true, end)).buckets();
            case "sample" -> body(traffic.history(first.corridor(), seconds / 60, 2000, true, false, end)).samples();
            case "zone" -> zones.find(first.corridor(), start, finish, first.resolution());
            default -> throw new IllegalArgumentException("Unsupported history dataset");
        };
        if (first.kind().equals("sample") && loaded.size() >= 2000 && keys.size() > 1) {
            return keys.stream().flatMap(key -> load(List.of(key)).stream()).toList();
        }
        if (first.kind().equals("sample") && loaded.size() >= 2000) throw new DenseHistory();
        List<Block> blocks = new ArrayList<>();
        for (Key key : keys) {
            Instant left = Instant.ofEpochSecond(key.start()), right = left.plusSeconds(key.seconds());
            List<?> part = loaded.stream().filter(row -> {
                Instant time = row instanceof CorridorTrendPointDto point ? point.bucketStart().toInstant()
                    : row instanceof TrafficSampleDto sample ? sample.polledAt().toInstant()
                    : ((TrafficSpeedZoneTrendRepository.TrendPoint) row).bucketStart();
                return !time.isBefore(left) && time.isBefore(right);
            }).toList();
            try {
                Block block = new Block(part, clock.instant(), 256 + mapper.writeValueAsBytes(part).length);
                cache.put(key, block); blocks.add(block);
            } catch (java.io.IOException error) { throw new IllegalStateException("Historical data could not be cached", error); }
        }
        return blocks;
    }

    private static <T> T body(ResponseEntity<T> response) {
        if (response == null || !response.getStatusCode().is2xxSuccessful() || response.getBody() == null)
            throw new IllegalStateException("Historical observations are unavailable; retry this window");
        return response.getBody();
    }
}
