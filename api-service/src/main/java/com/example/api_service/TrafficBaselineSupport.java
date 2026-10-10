package com.example.api_service;

import com.example.api_service.dto.TrafficBaselineProfileDto;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class TrafficBaselineSupport {
    public static final int LOOKBACK_WEEKS = 13;
    public static final int RECENCY_HALF_LIFE_WEEKS = 8;
    private static final int MINIMUM_EXACT_DAY_SAMPLES = 8;
    private static final int MINIMUM_PROFILE_SAMPLES = 8;
    private static final ZoneId DENVER = ZoneId.of("America/Denver");

    private TrafficBaselineSupport() {}

    public static OffsetDateTime denverWeekStart(OffsetDateTime asOf) {
        ZonedDateTime local = (asOf == null ? ZonedDateTime.now(DENVER) : asOf.toInstant().atZone(DENVER));
        return local.toLocalDate()
            .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            .atStartOfDay(DENVER)
            .withZoneSameInstant(ZoneOffset.UTC)
            .toOffsetDateTime();
    }

    public static List<TrafficBaselineProfileDto> buildProfiles(
        List<Observation> observations,
        OffsetDateTime weekStart
    ) {
        Map<ProfileKey, List<Observation>> exact = new HashMap<>();
        Map<DayTypeKey, List<Observation>> dayTypes = new HashMap<>();
        for (Observation observation : observations) {
            if (observation == null || observation.timestamp() == null || !Double.isFinite(observation.speed())) continue;
            ZonedDateTime local = observation.timestamp().atZone(DENVER);
            int day = local.getDayOfWeek().getValue();
            int hour = local.getHour();
            exact.computeIfAbsent(new ProfileKey(day, hour), ignored -> new ArrayList<>()).add(observation);
            dayTypes.computeIfAbsent(new DayTypeKey(dayType(day), hour), ignored -> new ArrayList<>()).add(observation);
        }

        List<TrafficBaselineProfileDto> profiles = new ArrayList<>();
        for (int day = 1; day <= 7; day += 1) {
            for (int hour = 0; hour < 24; hour += 1) {
                List<Observation> exactRows = exact.getOrDefault(new ProfileKey(day, hour), List.of());
                boolean useExact = exactRows.size() >= MINIMUM_EXACT_DAY_SAMPLES;
                List<Observation> cohort = useExact
                    ? exactRows
                    : dayTypes.getOrDefault(new DayTypeKey(dayType(day), hour), List.of());
                if (cohort.size() < MINIMUM_PROFILE_SAMPLES) continue;
                WeightedStats stats = weightedStats(cohort, weekStart.toInstant());
                profiles.add(new TrafficBaselineProfileDto(
                    day,
                    hour,
                    useExact ? "EXACT_DAY" : "DAY_TYPE_FALLBACK",
                    cohort.size(),
                    round(stats.effectiveSampleSize(), 1),
                    roundNullable(stats.mean(), 2),
                    roundNullable(stats.standardDeviation(), 2),
                    roundNullable(stats.coverageOneSigma(), 1),
                    roundNullable(stats.coverageTwoSigma(), 1),
                    roundNullable(stats.coverageThreeSigma(), 1)
                ));
            }
        }
        return List.copyOf(profiles);
    }

    private static WeightedStats weightedStats(List<Observation> rows, Instant weekStart) {
        List<WeightedObservation> weighted = rows.stream()
            .map(row -> new WeightedObservation(row.speed(), recencyWeight(row.timestamp(), weekStart)))
            .sorted(Comparator.comparingDouble(WeightedObservation::speed))
            .toList();
        double median = weightedMedian(weighted);
        List<WeightedObservation> deviations = weighted.stream()
            .map(row -> new WeightedObservation(Math.abs(row.speed() - median), row.recencyWeight()))
            .sorted(Comparator.comparingDouble(WeightedObservation::speed))
            .toList();
        double robustScale = 1.4826 * weightedMedian(deviations);
        double cutoff = Math.max(1.0, 2.5 * robustScale);
        List<WeightedObservation> robust = weighted.stream()
            .map(row -> {
                double residual = Math.abs(row.speed() - median);
                double robustWeight = residual <= cutoff ? 1.0 : cutoff / residual;
                return new WeightedObservation(row.speed(), row.recencyWeight() * robustWeight);
            })
            .toList();
        double weightSum = robust.stream().mapToDouble(WeightedObservation::recencyWeight).sum();
        double mean = robust.stream().mapToDouble(row -> row.speed() * row.recencyWeight()).sum() / weightSum;
        double variance = robust.stream()
            .mapToDouble(row -> row.recencyWeight() * Math.pow(row.speed() - mean, 2))
            .sum() / weightSum;
        double standardDeviation = Math.sqrt(Math.max(0, variance));
        double rawWeightSum = weighted.stream().mapToDouble(WeightedObservation::recencyWeight).sum();
        double squaredWeightSum = robust.stream()
            .mapToDouble(row -> row.recencyWeight() * row.recencyWeight())
            .sum();
        return new WeightedStats(
            mean,
            standardDeviation,
            weightSum * weightSum / Math.max(Double.MIN_NORMAL, squaredWeightSum),
            coverage(weighted, rawWeightSum, mean, standardDeviation),
            coverage(weighted, rawWeightSum, mean, standardDeviation * 2),
            coverage(weighted, rawWeightSum, mean, standardDeviation * 3)
        );
    }

    private static double recencyWeight(Instant timestamp, Instant weekStart) {
        double ageWeeks = Math.max(0, Duration.between(timestamp, weekStart).toSeconds() / 604_800.0);
        return Math.pow(0.5, ageWeeks / RECENCY_HALF_LIFE_WEEKS);
    }

    private static double weightedMedian(List<WeightedObservation> rows) {
        double total = rows.stream().mapToDouble(WeightedObservation::recencyWeight).sum();
        double running = 0;
        for (WeightedObservation row : rows) {
            running += row.recencyWeight();
            if (running >= total / 2) return row.speed();
        }
        return rows.get(rows.size() - 1).speed();
    }

    private static double coverage(
        List<WeightedObservation> rows,
        double weightSum,
        double mean,
        double radius
    ) {
        if (radius <= 0 || weightSum <= 0) return 100.0;
        double covered = rows.stream()
            .filter(row -> Math.abs(row.speed() - mean) <= radius)
            .mapToDouble(WeightedObservation::recencyWeight)
            .sum();
        return covered * 100 / weightSum;
    }

    private static DayType dayType(int dayOfWeek) {
        return dayOfWeek <= 5 ? DayType.WEEKDAY : DayType.WEEKEND;
    }

    private static double round(double value, int precision) {
        double factor = Math.pow(10, precision);
        return Math.round(value * factor) / factor;
    }

    private static Double roundNullable(double value, int precision) {
        return Double.isFinite(value) ? round(value, precision) : null;
    }

    public record Observation(Instant timestamp, double speed) {}

    private record ProfileKey(int dayOfWeek, int hourOfDay) {}
    private record DayTypeKey(DayType dayType, int hourOfDay) {}
    private record WeightedObservation(double speed, double recencyWeight) {}
    private record WeightedStats(
        double mean,
        double standardDeviation,
        double effectiveSampleSize,
        double coverageOneSigma,
        double coverageTwoSigma,
        double coverageThreeSigma
    ) {}
    private enum DayType { WEEKDAY, WEEKEND }
}
