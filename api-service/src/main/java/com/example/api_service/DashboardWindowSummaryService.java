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
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

@Service
public class DashboardWindowSummaryService {
    public record WorstZone(Double startMileMarker, Double endMileMarker, Double speedMph) {}
    public record WindowSummary(String corridor, Instant start, Instant end, int hours, int bucketMinutes,
        Double averageSpeed, Double averageTravelMinutes, Double fastestTravelMinutes, Double slowestTravelMinutes,
        Long observedIncidents, WorstZone worstZone, boolean speedAvailable, boolean zonesAvailable,
        boolean incidentsAvailable, boolean busy, String travelMethod) {}
    private record Key(String corridor, int hours, Instant end) {}
    private record Cached(WindowSummary value, Instant fetchedAt) {}
    private final Cache<Key, Cached> cache = Caffeine.newBuilder().maximumSize(256)
        .expireAfterAccess(Duration.ofMinutes(15)).build();
    private final ReentrantLock coldRead = new ReentrantLock();
    private final Cache<String, Optional<OffsetDateTime>> extentCache = Caffeine.newBuilder().maximumSize(1)
        .expireAfterWrite(Duration.ofMinutes(10)).build();
    private final TrafficSpeedZoneTrendRepository zones;
    private final TrafficAnalyticsRepository analytics;
    private final CurrentIncidentRepository incidents;
    private final CorridorRefRepository corridors;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public DashboardWindowSummaryService(TrafficSpeedZoneTrendRepository zones, CurrentIncidentRepository incidents,
        CorridorRefRepository corridors, TrafficAnalyticsRepository analytics) { this(zones, incidents, corridors, analytics, Clock.systemUTC()); }

    DashboardWindowSummaryService(TrafficSpeedZoneTrendRepository zones, CurrentIncidentRepository incidents,
        CorridorRefRepository corridors, TrafficAnalyticsRepository analytics, Clock clock) {
        this.zones = zones; this.incidents = incidents; this.corridors = corridors; this.analytics = analytics; this.clock = clock;
    }

    public Map<String, WindowSummary> read(List<String> selected, int hours, OffsetDateTime requestedEnd) {
        Instant end = requestedEnd.toInstant().truncatedTo(ChronoUnit.MINUTES);
        Map<String, WindowSummary> result = new LinkedHashMap<>();
        for (String corridor : selected) {
            Key key = new Key(corridor, hours, end);
            Cached previous = cache.getIfPresent(key);
            int lifetime = previous != null && !(previous.value().speedAvailable() && previous.value().zonesAvailable()
                && previous.value().incidentsAvailable()) ? 5 : end.isAfter(clock.instant().minusSeconds(3600)) ? 60 : 600;
            if (previous != null && previous.fetchedAt().plusSeconds(lifetime).isAfter(clock.instant())) {
                result.put(corridor, previous.value()); continue;
            }
            // A cancelled browser read can still be executing. Never fan out cold summary work.
            if (!coldRead.tryLock()) {
                result.put(corridor, empty(corridor, hours, end)); continue;
            }
            try {
                WindowSummary summary = compute(corridor, hours, end);
                cache.put(key, new Cached(summary, clock.instant()));
                result.put(corridor, summary);
            } finally { coldRead.unlock(); }
        }
        return result;
    }

    private WindowSummary empty(String corridor, int hours, Instant end) {
        return new WindowSummary(corridor, end.minus(hours, ChronoUnit.HOURS), end, hours,
            bucketMinutes(hours), null, null, null, null, null, null, false, false, false, true, "UNAVAILABLE");
    }

    private WindowSummary compute(String corridor, int hours, Instant end) {
        OffsetDateTime until = end.atOffset(ZoneOffset.UTC);
        Double speed = null; boolean speedAvailable = false, zonesAvailable = false, incidentsAvailable = false;
        List<TrafficSpeedZoneTrendPointDto> points = List.of();
        TrafficWindowStatisticsProjection statistics = null;
        Instant distanceChangedAt = null;
        Double distance = corridors.findById(corridor).map(ref ->
            ref.getStartMileMarker() == null || ref.getEndMileMarker() == null ? null
                : Math.abs(ref.getEndMileMarker() - ref.getStartMileMarker())).orElse(null);
        Long count = null;
        try {
            OffsetDateTime extentChange = "I70".equals(corridor) && distance != null && distance > 53
                ? extentCache.get(corridor, ignored -> Optional.ofNullable(analytics.findRecordedI70ExtentChange())).orElse(null) : null;
            distanceChangedAt = extentChange == null ? null : extentChange.toInstant();
            statistics = analytics.findWindowStatistics(corridor, until.minusHours(hours), until, distance, extentChange);
            Double mean = statistics == null ? null : statistics.getAverageSpeed();
            speed = valid(mean) ? mean : null; speedAvailable = true;
        } catch (RuntimeException unavailable) { /* Other fields remain independently useful. */ }
        try {
            if (!zones.isAvailable()) throw new IllegalStateException("Zone observations unavailable");
            // Summary cold work must not acquire the graph history-block lock.
            var response = TrafficSpeedZoneTrendController.trendResponse(corridor, hours, end.minus(hours, ChronoUnit.HOURS), end,
                bucketMinutes(hours), zones.find(corridor, end.minus(hours, ChronoUnit.HOURS), end, bucketMinutes(hours)));
            if (response.getStatusCode().value() == 404) zonesAvailable = true;
            else { points = body(response).points(); zonesAvailable = true; }
        } catch (RuntimeException unavailable) { /* Missing zone data is not a zero-minute journey. */ }
        try {
            if (incidents.hasDurableEventsAtOrBefore(until)) {
                count = incidents.countDurableTimelineByCorridorBetween(corridor, until.minusHours(hours), until);
                incidentsAvailable = true;
            }
        } catch (RuntimeException unavailable) { /* Never substitute capped marker counts. */ }
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
        Instant start = end.minus(hours, ChronoUnit.HOURS);
        for (var entry : buckets.entrySet()) {
            Double bucketDistance = statistics == null ? distance
                : distanceAt(corridor, distance, entry.getKey(), distanceChangedAt);
            Double minutes = travelMinutes(entry.getValue(), bucketDistance);
            if (minutes == null) continue;
            travel.add(minutes);
            Instant left = entry.getKey().isBefore(start) ? start : entry.getKey();
            Instant bucketEnd = entry.getKey().plusSeconds(bucketMinutes(hours) * 60L);
            Instant right = bucketEnd.isAfter(end) ? end : bucketEnd;
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
        // Absence is different from failed, incomplete or stopped zone observations.
        if (points.isEmpty() && zonesAvailable && statistics != null && distance != null && Double.isFinite(distance) && distance > 0) {
            average = positive(statistics.getAverageTravelMinutes());
            fastest = positive(statistics.getFastestTravelMinutes());
            slowest = positive(statistics.getSlowestTravelMinutes());
            if (average != null) method = "CORRIDOR_AVERAGES";
        }
        return new WindowSummary(corridor, end.minus(hours, ChronoUnit.HOURS), end, hours, bucketMinutes(hours), speed,
            average, fastest, slowest, count, worst, speedAvailable, zonesAvailable, incidentsAvailable, false, method);
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

    static int bucketMinutes(int hours) { return switch (hours) {case 2 -> 1; case 6 -> 5; case 24 -> 15; case 168 -> 60; default -> 180;}; }
    private static boolean valid(Double value) { return value != null && Double.isFinite(value) && value >= 0; }
    private static Double positive(Double value) { return valid(value) && value > 0 ? value : null; }
    private static Double finite(double value) { return Double.isFinite(value) ? value : null; }
    private static <T> T body(ResponseEntity<T> response) {
        if (response == null || !response.getStatusCode().is2xxSuccessful() || response.getBody() == null)
            throw new IllegalStateException("Window observations unavailable");
        return response.getBody();
    }
}
