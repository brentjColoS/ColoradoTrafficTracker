package com.example.api_service;

import com.example.api_service.dto.TrafficSpeedZoneTrendPointDto;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

@Service
public class DashboardWindowSummaryService {
    public record WorstZone(Double startMileMarker, Double endMileMarker, Double speedMph) {}
    public record WindowSummary(String corridor, Instant start, Instant end, int hours, int bucketMinutes,
        Double averageSpeed, Double averageTravelMinutes, Double fastestTravelMinutes, Double slowestTravelMinutes,
        Long observedIncidents, WorstZone worstZone, boolean speedAvailable, boolean zonesAvailable,
        boolean incidentsAvailable, boolean busy, String travelMethod, Double lowestObservedSpeed, String incidentMethod) {}
    public record Frame(Map<String, WindowSummary> summaries, boolean complete) {}
    private record Key(String corridor, int hours, Instant end) {}
    private record Cached(WindowSummary value, Instant fetchedAt) {}
    private record Base(Key key, Double distance, Instant distanceChangedAt, TrafficWindowStatisticsProjection statistics, boolean available) {}
    private final Cache<Key, Cached> cache = Caffeine.newBuilder().maximumSize(256)
        .expireAfterAccess(Duration.ofMinutes(15)).build();
    private final ReentrantLock coldRead = new ReentrantLock();
    private final Cache<String, Optional<Instant>> extentCache = Caffeine.newBuilder().maximumSize(1)
        .expireAfterWrite(Duration.ofMinutes(10)).build();
    private final Cache<String, Optional<Double>> distanceCache = Caffeine.newBuilder().maximumSize(2)
        .expireAfterWrite(Duration.ofMinutes(10)).build();
    private final TrafficSpeedZoneTrendRepository zones;
    private final TrafficAnalyticsRepository analytics;
    private final CurrentIncidentRepository incidents;
    private final CorridorRefRepository corridors;
    private final HistoricalIncidentEpisodes legacy;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public DashboardWindowSummaryService(TrafficSpeedZoneTrendRepository zones, CurrentIncidentRepository incidents,
        CorridorRefRepository corridors, TrafficAnalyticsRepository analytics, HistoricalIncidentEpisodes legacy) {
        this(zones, incidents, corridors, analytics, legacy, Clock.systemUTC());
    }

    DashboardWindowSummaryService(TrafficSpeedZoneTrendRepository zones, CurrentIncidentRepository incidents,
        CorridorRefRepository corridors, TrafficAnalyticsRepository analytics, HistoricalIncidentEpisodes legacy, Clock clock) {
        this.zones = zones; this.incidents = incidents; this.corridors = corridors; this.analytics = analytics;
        this.legacy = legacy; this.clock = clock;
    }

    public Map<String, WindowSummary> read(List<String> selected, int hours, OffsetDateTime end) {
        return read(selected, hours, end, ignored -> {}, false);
    }

    public Map<String, WindowSummary> read(List<String> selected, int hours, OffsetDateTime requestedEnd, Consumer<Frame> update) {
        return read(selected, hours, requestedEnd, update, true);
    }

    private Map<String, WindowSummary> read(List<String> selected, int hours, OffsetDateTime requestedEnd, Consumer<Frame> update, boolean progressive) {
        Instant end = requestedEnd.toInstant().truncatedTo(ChronoUnit.MINUTES);
        Map<String, WindowSummary> result = new LinkedHashMap<>();
        List<Key> missing = new ArrayList<>();
        for (String corridor : selected) {
            Key key = new Key(corridor, hours, end);
            Cached previous = cache.getIfPresent(key);
            int lifetime = previous != null && !(previous.value().speedAvailable() && previous.value().zonesAvailable()
                && previous.value().incidentsAvailable()) ? 5 : end.isAfter(clock.instant().minusSeconds(3600)) ? 60 : 600;
            if (previous != null && previous.fetchedAt().plusSeconds(lifetime).isAfter(clock.instant())) result.put(corridor, previous.value());
            else { result.put(corridor, empty(key, false)); missing.add(key); }
        }
        if (missing.isEmpty()) { emit(update, result, true); return result; }
        // Disconnected reads may still be calculating. Never fan out cold work.
        if (!coldRead.tryLock()) {
            missing.forEach(key -> result.put(key.corridor(), empty(key, true)));
            emit(update, result, true); return result;
        }
        boolean locked = true;
        try {
            if (missing.size() < selected.size()) emit(update, result, false);
            Map<String, Base> bases = new LinkedHashMap<>();
            for (Key key : missing) {
                Base base = base(key); bases.put(key.corridor(), base);
                result.put(key.corridor(), speed(base)); emit(update, result, false);
            }
            for (Base base : bases.values()) {
                result.put(base.key().corridor(), travel(base)); emit(update, result, false);
            }
            // A previous archive lookup must not hold the next window's ready speed/travel fields.
            if (progressive) { coldRead.unlock(); locked = false; }
            long incidentDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
            for (Key key : missing) {
                WindowSummary value = incidents(result.get(key.corridor()), incidentDeadline);
                result.put(key.corridor(), value);
                cache.put(key, new Cached(value, clock.instant())); emit(update, result, false);
            }
            emit(update, result, true); return result;
        } finally { if (locked) coldRead.unlock(); }
    }

    private static void emit(Consumer<Frame> update, Map<String, WindowSummary> values, boolean complete) {
        update.accept(new Frame(Map.copyOf(values), complete));
    }

    private WindowSummary empty(Key key, boolean busy) {
        return new WindowSummary(key.corridor(), key.end().minus(key.hours(), ChronoUnit.HOURS), key.end(), key.hours(),
            bucketMinutes(key.hours()), null, null, null, null, null, null, false, false, false, busy, "UNAVAILABLE", null, "UNAVAILABLE");
    }

    private Base base(Key key) {
        Double distance = null; Instant changedAt = null; TrafficWindowStatisticsProjection statistics = null;
        boolean available = false;
        try {
            distance = distanceCache.get(key.corridor(), code -> corridors.findById(code).map(ref ->
                ref.getStartMileMarker() == null || ref.getEndMileMarker() == null ? null
                    : Math.abs(ref.getEndMileMarker() - ref.getStartMileMarker()))).orElse(null);
            changedAt = "I70".equals(key.corridor()) && distance != null && distance > 53
                ? extentCache.get(key.corridor(), ignored -> Optional.ofNullable(analytics.findRecordedI70ExtentChange())
                    .map(TrafficAnalyticsRepository.RecordedExtentChange::getChangedAt)).orElse(null) : null;
            OffsetDateTime until = key.end().atOffset(ZoneOffset.UTC);
            statistics = analytics.findWindowStatistics(key.corridor(), until.minusHours(key.hours()), until, distance,
                changedAt == null ? null : changedAt.atOffset(ZoneOffset.UTC));
            available = true;
        } catch (RuntimeException unavailable) { /* Zone and incident fields remain independently useful. */ }
        return new Base(key, distance, changedAt, statistics, available);
    }

    private WindowSummary speed(Base base) {
        var empty = empty(base.key(), false);
        return new WindowSummary(empty.corridor(), empty.start(), empty.end(), empty.hours(), empty.bucketMinutes(),
            base.statistics() == null ? null : valid(base.statistics().getAverageSpeed()) ? base.statistics().getAverageSpeed() : null,
            null, null, null, null, null, base.available(), false, false, false, "UNAVAILABLE",
            base.statistics() != null && valid(base.statistics().getLowestObservedSpeed()) ? base.statistics().getLowestObservedSpeed() : null,
            "UNAVAILABLE");
    }

    private WindowSummary travel(Base base) {
        var value = speed(base);
        List<TrafficSpeedZoneTrendPointDto> points = List.of();
        boolean available = false;
        try {
            if (!zones.isAvailable()) throw new IllegalStateException("Zone observations unavailable");
            var response = TrafficSpeedZoneTrendController.trendResponse(value.corridor(), value.hours(), value.start(), value.end(),
                value.bucketMinutes(), zones.find(value.corridor(), value.start(), value.end(), value.bucketMinutes()));
            if (response.getStatusCode().value() != 404) points = body(response).points();
            available = true;
        } catch (RuntimeException unavailable) { /* A failed source is not absence or a zero-minute journey. */ }
        Map<Instant, List<TrafficSpeedZoneTrendPointDto>> buckets = new LinkedHashMap<>();
        Map<String, double[]> weighted = new LinkedHashMap<>();
        Map<String, TrafficSpeedZoneTrendPointDto> definitions = new LinkedHashMap<>();
        for (var point : points) {
            buckets.computeIfAbsent(point.bucketStart(), ignored -> new ArrayList<>()).add(point);
            if (!valid(point.avgCurrentSpeed()) || point.observationCount() == null || point.observationCount() <= 0) continue;
            String identity = point.zoneKey() + "|" + point.startMileMarker() + "|" + point.endMileMarker();
            var totals = weighted.computeIfAbsent(identity, ignored -> new double[2]);
            totals[0] += point.avgCurrentSpeed() * point.observationCount(); totals[1] += point.observationCount();
            definitions.put(identity, point);
        }
        List<Double> travel = new ArrayList<>();
        double weightedTravel = 0, duration = 0;
        for (var entry : buckets.entrySet()) {
            Double minutes = travelMinutes(entry.getValue(), distanceAt(value.corridor(), base.distance(), entry.getKey(), base.distanceChangedAt()));
            if (minutes == null) continue;
            travel.add(minutes);
            Instant left = entry.getKey().isBefore(value.start()) ? value.start() : entry.getKey();
            Instant right = entry.getKey().plusSeconds(value.bucketMinutes() * 60L);
            if (right.isAfter(value.end())) right = value.end();
            long seconds = Math.max(0, Duration.between(left, right).getSeconds());
            weightedTravel += minutes * seconds; duration += seconds;
        }
        WorstZone worst = weighted.entrySet().stream().min(Comparator.comparingDouble(entry -> entry.getValue()[0] / entry.getValue()[1]))
            .map(entry -> { var zone = definitions.get(entry.getKey()); return new WorstZone(zone.startMileMarker(), zone.endMileMarker(),
                finite(entry.getValue()[0] / entry.getValue()[1])); }).orElse(null);
        Double average = finite(weightedTravel / duration);
        Double fastest = finite(travel.stream().mapToDouble(Double::doubleValue).min().orElse(Double.NaN));
        Double slowest = finite(travel.stream().mapToDouble(Double::doubleValue).max().orElse(Double.NaN));
        String method = average == null ? "UNAVAILABLE" : "ZONE_BUCKETS";
        if (points.isEmpty() && available && base.statistics() != null && base.distance() != null
            && Double.isFinite(base.distance()) && base.distance() > 0) {
            average = positive(base.statistics().getAverageTravelMinutes()); fastest = positive(base.statistics().getFastestTravelMinutes());
            slowest = positive(base.statistics().getSlowestTravelMinutes());
            if (average != null) method = "CORRIDOR_AVERAGES";
        }
        return new WindowSummary(value.corridor(), value.start(), value.end(), value.hours(), value.bucketMinutes(), value.averageSpeed(),
            average, fastest, slowest, null, worst, value.speedAvailable(), available, false, false, method,
            value.lowestObservedSpeed(), "UNAVAILABLE");
    }

    private WindowSummary incidents(WindowSummary value, long deadline) {
        Long count = null; String method = "UNAVAILABLE"; boolean available = false;
        try {
            OffsetDateTime until = value.end().atOffset(ZoneOffset.UTC);
            Instant firstDurable = incidents.firstDurableObservation(value.corridor());
            if (firstDurable != null && !value.start().isBefore(firstDurable)) {
                count = incidents.countDurableTimelineByCorridorBetween(value.corridor(), value.start().atOffset(ZoneOffset.UTC), until);
                method = "DURABLE_EVENTS"; available = true;
            } else if (incidents.hasHistoricalObservationsAtOrBefore(value.corridor(), until)) {
                if (firstDurable != null && !value.end().isBefore(firstDurable)) {
                    // Legacy writes stopped after cutover. Count both eras, but not a continuous provider identity twice.
                    var boundary = firstDurable.atOffset(ZoneOffset.UTC);
                    var bridges = incidents.durableIdentitiesAtBoundary(value.corridor(), boundary);
                    count = legacy.countBefore(value.corridor(), value.start(), firstDurable, bridges, deadline)
                        + incidents.countDurableTimelineByCorridorBetween(value.corridor(), boundary, until);
                } else count = legacy.count(value.corridor(), value.start(), value.end(), deadline);
                method = "RECONSTRUCTED_EPISODES"; available = true;
            }
        } catch (RuntimeException unavailable) { /* Never borrow live or capped marker counts. */ }
        return new WindowSummary(value.corridor(), value.start(), value.end(), value.hours(), value.bucketMinutes(), value.averageSpeed(),
            value.averageTravelMinutes(), value.fastestTravelMinutes(), value.slowestTravelMinutes(), count, value.worstZone(),
            value.speedAvailable(), value.zonesAvailable(), available, false, value.travelMethod(), value.lowestObservedSpeed(), method);
    }

    static Double distanceAt(String corridor, Double distance, Instant time, Instant changedAt) {
        // The durable added-zone observation anchors the recorded corridor extent.
        if ("I70".equals(corridor) && distance != null && distance > 53
            && (changedAt == null || time.isBefore(changedAt))) return 53.0;
        return distance;
    }

    static Double travelMinutes(List<TrafficSpeedZoneTrendPointDto> points, Double distance) {
        if (distance == null || !Double.isFinite(distance) || distance <= 0) return null;
        if (points.stream().anyMatch(row -> row.startMileMarker() == null || row.endMileMarker() == null
            || !valid(row.avgCurrentSpeed()) || row.avgCurrentSpeed() <= 0)) return null;
        var sorted = points.stream().sorted(Comparator.comparingDouble(row -> Math.min(row.startMileMarker(), row.endMileMarker()))).toList();
        double covered = 0, minutes = 0, previous = Double.NaN;
        for (var row : sorted) {
            double lower = Math.min(row.startMileMarker(), row.endMileMarker()), upper = Math.max(row.startMileMarker(), row.endMileMarker());
            if (!Double.isFinite(lower) || !Double.isFinite(upper) || upper <= lower || (Double.isFinite(previous) && Math.abs(lower - previous) > 0.02)) return null;
            covered += upper - lower; minutes += (upper - lower) / row.avgCurrentSpeed() * 60; previous = upper;
        }
        return Math.abs(covered - distance) <= 0.02 ? finite(minutes) : null;
    }

    static int bucketMinutes(int hours) { return DashboardRanges.BUCKET_MINUTES.getOrDefault(hours, 180); }
    private static boolean valid(Double value) { return value != null && Double.isFinite(value) && value >= 0; }
    private static Double positive(Double value) { return valid(value) && value > 0 ? value : null; }
    private static Double finite(double value) { return Double.isFinite(value) ? value : null; }
    private static <T> T body(ResponseEntity<T> response) {
        if (response == null || !response.getStatusCode().is2xxSuccessful() || response.getBody() == null)
            throw new IllegalStateException("Window observations unavailable");
        return response.getBody();
    }
}
