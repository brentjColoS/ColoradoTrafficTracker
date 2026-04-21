package com.example.api_service;

import com.example.api_service.dto.IncidentHotspotDto;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

final class IncidentHotspotSupport {
    private IncidentHotspotSupport() {}

    static List<IncidentHotspotDto> rank(List<TrafficIncidentHotspotProjection> rows, OffsetDateTime now, int limit) {
        if (rows == null || rows.isEmpty() || limit <= 0) {
            return List.of();
        }

        return rows.stream()
            .map(row -> toDto(row, now))
            .sorted(Comparator
                .comparing(IncidentHotspotDto::approximateLocation)
                .thenComparing(IncidentHotspotDto::pressureScore, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(IncidentHotspotDto::lastSeenAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(IncidentHotspotDto::incidentCount, Comparator.nullsLast(Comparator.reverseOrder())))
            .limit(limit)
            .toList();
    }

    static IncidentHotspotDto top(List<TrafficIncidentHotspotProjection> rows, OffsetDateTime now) {
        return rank(rows, now, 1).stream().findFirst().orElse(null);
    }

    private static IncidentHotspotDto toDto(TrafficIncidentHotspotProjection row, OffsetDateTime now) {
        OffsetDateTime firstSeenAt = toUtcOffset(row.getFirstSeenAt());
        OffsetDateTime lastSeenAt = toUtcOffset(row.getLastSeenAt());
        boolean approximateLocation = row.getMileMarkerBand() == null;
        boolean hasDelaySignal = hasDelaySignal(row.getAvgDelaySeconds(), row.getMaxDelaySeconds());
        long activeDurationMinutes = activeDurationMinutes(firstSeenAt, lastSeenAt);

        return new IncidentHotspotDto(
            row.getCorridor(),
            row.getTravelDirection(),
            directionLabel(row.getTravelDirection()),
            row.getMileMarkerBand(),
            referenceLabel(row.getCorridor(), row.getTravelDirection(), row.getMileMarkerBand()),
            row.getObservationCount(),
            row.getIncidentCount(),
            row.getAvgDelaySeconds(),
            row.getMaxDelaySeconds(),
            row.getArchivedObservationCount(),
            row.getArchivedIncidentCount(),
            firstSeenAt,
            lastSeenAt,
            approximateLocation,
            hasDelaySignal,
            activeDurationMinutes,
            pressureScore(row, now, approximateLocation, hasDelaySignal, activeDurationMinutes, lastSeenAt)
        );
    }

    private static Double pressureScore(
        TrafficIncidentHotspotProjection row,
        OffsetDateTime now,
        boolean approximateLocation,
        boolean hasDelaySignal,
        long activeDurationMinutes,
        OffsetDateTime lastSeenAt
    ) {
        double incidentWeight = safeLong(row.getIncidentCount()) * 120.0;
        double observationWeight = Math.min(safeLong(row.getObservationCount()), 2_000L) * 0.08;
        double maxDelayWeight = Math.min(safeInt(row.getMaxDelaySeconds()), 1_800) * 0.25;
        double avgDelayWeight = Math.min(safeDouble(row.getAvgDelaySeconds()), 900.0) * 0.10;
        double durationWeight = Math.min(activeDurationMinutes, 720L) * 0.05;
        double recencyWeight = Math.max(0.0, 180.0 - Math.min(ageMinutes(lastSeenAt, now), 180.0)) * 0.5;
        double approximatePenalty = approximateLocation ? 180.0 : 0.0;
        double noDelayPenalty = hasDelaySignal ? 0.0 : 60.0;
        return roundToSingleDecimal(
            incidentWeight
                + observationWeight
                + maxDelayWeight
                + avgDelayWeight
                + durationWeight
                + recencyWeight
                - approximatePenalty
                - noDelayPenalty
        );
    }

    private static boolean hasDelaySignal(Double avgDelaySeconds, Integer maxDelaySeconds) {
        return (avgDelaySeconds != null && avgDelaySeconds > 0.5)
            || (maxDelaySeconds != null && maxDelaySeconds > 0);
    }

    private static long activeDurationMinutes(OffsetDateTime firstSeenAt, OffsetDateTime lastSeenAt) {
        if (firstSeenAt == null || lastSeenAt == null) {
            return 0L;
        }
        return Math.max(0L, Duration.between(firstSeenAt, lastSeenAt).toMinutes());
    }

    private static double ageMinutes(OffsetDateTime lastSeenAt, OffsetDateTime now) {
        if (lastSeenAt == null || now == null) {
            return 180.0;
        }
        return Math.max(0.0, Duration.between(lastSeenAt, now).toMinutes());
    }

    private static OffsetDateTime toUtcOffset(Instant instant) {
        return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static String referenceLabel(String corridor, String direction, Integer mileMarkerBand) {
        String directionLabel = directionLabel(direction);
        if (mileMarkerBand != null && directionLabel != null) {
            return String.format(Locale.US, "%s %s near MM %d", corridor, directionLabel, mileMarkerBand);
        }
        if (mileMarkerBand != null) {
            return String.format(Locale.US, "%s near MM %d", corridor, mileMarkerBand);
        }
        if (directionLabel != null) {
            return corridor + " " + directionLabel;
        }
        return corridor;
    }

    private static String directionLabel(String direction) {
        String normalized = normalizeDirection(direction);
        if (normalized == null) return null;
        return switch (normalized) {
            case "N" -> "northbound";
            case "S" -> "southbound";
            case "E" -> "eastbound";
            case "W" -> "westbound";
            default -> null;
        };
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return direction.trim().toUpperCase(Locale.ROOT);
    }

    private static long safeLong(Long value) {
        return value == null ? 0L : value;
    }

    private static int safeInt(Integer value) {
        return value == null ? 0 : value;
    }

    private static double safeDouble(Double value) {
        return value == null ? 0.0 : value;
    }

    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
