package com.example.api_service;

import com.example.api_service.dto.MileMarkerAssessmentResponseDto;
import com.example.api_service.dto.MileMarkerCorridorAssessmentDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/analytics", "/dashboard-api/traffic/analytics"})
public class TrafficMileMarkerAnalyticsController {
    private static final int MAX_WINDOW_HOURS = 8_760;
    private static final double HIGH_CONFIDENCE_THRESHOLD = 0.75;

    private final CorridorRefRepository corridorRefRepository;
    private final TrafficHistoryIncidentRepository incidentRepository;
    private final ObjectMapper objectMapper;

    public TrafficMileMarkerAnalyticsController(
        CorridorRefRepository corridorRefRepository,
        TrafficHistoryIncidentRepository incidentRepository,
        ObjectMapper objectMapper
    ) {
        this.corridorRefRepository = corridorRefRepository;
        this.incidentRepository = incidentRepository;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/mile-marker-coverage")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'analytics-mile-marker-coverage|' + #p0",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<MileMarkerAssessmentResponseDto> coverage(
        @RequestParam(name = "windowHours", defaultValue = "168") int windowHours
    ) {
        if (windowHours < 1 || windowHours > MAX_WINDOW_HOURS) {
            return ResponseEntity.badRequest().build();
        }

        OffsetDateTime since = OffsetDateTime.now().minusHours(windowHours);
        List<MileMarkerCorridorAssessmentDto> corridors = corridorRefRepository.findAllByOrderByCodeAsc().stream()
            .map(corridor -> toAssessment(corridor, since))
            .toList();

        return ResponseEntity.ok(new MileMarkerAssessmentResponseDto(
            since,
            windowHours,
            corridors.size(),
            corridors
        ));
    }

    private MileMarkerCorridorAssessmentDto toAssessment(CorridorRef corridor, OffsetDateTime since) {
        long recentIncidentCount = incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(corridor.getCode(), since);
        long resolvedIncidentCount = incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNull(corridor.getCode(), since);
        long unresolvedIncidentCount = incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(corridor.getCode(), since);
        long highConfidenceCount = incidentRepository
            .countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNullAndMileMarkerConfidenceGreaterThanEqual(
                corridor.getCode(),
                since,
                HIGH_CONFIDENCE_THRESHOLD
            );
        long anchorInterpolatedCount = incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(
            corridor.getCode(),
            since,
            "anchor_interpolated"
        );
        long rangeInterpolatedCount = incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(
            corridor.getCode(),
            since,
            "range_interpolated"
        );
        long directionOnlyCount = incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(
            corridor.getCode(),
            since,
            "direction_only"
        );
        long offCorridorCount = incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(
            corridor.getCode(),
            since,
            "off_corridor"
        );
        Double avgDistanceToCorridorMeters = incidentRepository.averageDistanceToCorridorMeters(corridor.getCode(), since);
        Double resolvedRatePercent = recentIncidentCount == 0
            ? null
            : roundToSingleDecimal((resolvedIncidentCount * 100.0) / recentIncidentCount);
        Double highConfidenceRatePercent = resolvedIncidentCount == 0
            ? null
            : roundToSingleDecimal((highConfidenceCount * 100.0) / resolvedIncidentCount);
        Double anchorCoveragePercent = resolvedIncidentCount == 0
            ? null
            : roundToSingleDecimal((anchorInterpolatedCount * 100.0) / resolvedIncidentCount);
        Double offCorridorRatePercent = recentIncidentCount == 0
            ? null
            : roundToSingleDecimal((offCorridorCount * 100.0) / recentIncidentCount);
        int configuredAnchorCount = anchorCount(corridor.getMileMarkerAnchorsJson());
        String dominantMethod = dominantMethod(
            anchorInterpolatedCount,
            rangeInterpolatedCount,
            directionOnlyCount,
            offCorridorCount,
            unresolvedIncidentCount
        );
        String qualityState = qualityState(
            configuredAnchorCount,
            recentIncidentCount,
            resolvedRatePercent,
            highConfidenceRatePercent,
            anchorCoveragePercent,
            offCorridorRatePercent,
            avgDistanceToCorridorMeters,
            resolvedIncidentCount,
            anchorInterpolatedCount
        );
        String qualitySummary = qualitySummary(
            qualityState,
            resolvedRatePercent,
            anchorCoveragePercent,
            offCorridorRatePercent,
            configuredAnchorCount,
            resolvedIncidentCount,
            anchorInterpolatedCount
        );

        return new MileMarkerCorridorAssessmentDto(
            corridor.getCode(),
            corridor.getStartMileMarker(),
            corridor.getEndMileMarker(),
            configuredAnchorCount,
            recentIncidentCount,
            resolvedIncidentCount,
            unresolvedIncidentCount,
            highConfidenceCount,
            anchorInterpolatedCount,
            rangeInterpolatedCount,
            directionOnlyCount,
            offCorridorCount,
            avgDistanceToCorridorMeters == null ? null : roundToSingleDecimal(avgDistanceToCorridorMeters),
            resolvedRatePercent,
            highConfidenceRatePercent,
            anchorCoveragePercent,
            offCorridorRatePercent,
            dominantMethod,
            qualityState,
            qualitySummary
        );
    }

    private Integer anchorCount(String anchorsJson) {
        if (anchorsJson == null || anchorsJson.isBlank()) {
            return 0;
        }
        try {
            JsonNode node = objectMapper.readTree(anchorsJson);
            return node.isArray() ? node.size() : 0;
        } catch (Exception error) {
            return 0;
        }
    }

    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private static String dominantMethod(
        long anchorInterpolatedCount,
        long rangeInterpolatedCount,
        long directionOnlyCount,
        long offCorridorCount,
        long unresolvedIncidentCount
    ) {
        long max = Math.max(
            Math.max(anchorInterpolatedCount, rangeInterpolatedCount),
            Math.max(directionOnlyCount, offCorridorCount)
        );
        if (max <= 0) {
            return unresolvedIncidentCount > 0 ? "unresolved" : "none";
        }
        if (max == anchorInterpolatedCount) {
            return "anchor_interpolated";
        }
        if (max == rangeInterpolatedCount) {
            return "range_interpolated";
        }
        if (max == directionOnlyCount) {
            return "direction_only";
        }
        return "off_corridor";
    }

    private static String qualityState(
        int configuredAnchorCount,
        long recentIncidentCount,
        Double resolvedRatePercent,
        Double highConfidenceRatePercent,
        Double anchorCoveragePercent,
        Double offCorridorRatePercent,
        Double avgDistanceToCorridorMeters,
        long resolvedIncidentCount,
        long anchorInterpolatedCount
    ) {
        if (recentIncidentCount <= 0) {
            return "idle";
        }
        if (percentageBelow(resolvedRatePercent, 60.0) || percentageAtLeast(offCorridorRatePercent, 20.0)) {
            return "critical";
        }
        if (configuredAnchorCount <= 0) {
            return "range_only";
        }
        if (resolvedIncidentCount > 0 && anchorInterpolatedCount <= 0) {
            return "attention";
        }
        if (
            percentageAtLeast(resolvedRatePercent, 95.0)
                && percentageAtLeast(highConfidenceRatePercent, 85.0)
                && percentageAtLeast(anchorCoveragePercent, 85.0)
                && !percentageAtLeast(offCorridorRatePercent, 5.0)
                && (avgDistanceToCorridorMeters == null || avgDistanceToCorridorMeters <= 120.0)
        ) {
            return "anchored";
        }
        if (
            percentageAtLeast(resolvedRatePercent, 85.0)
                && percentageAtLeast(anchorCoveragePercent, 50.0)
                && !percentageAtLeast(offCorridorRatePercent, 10.0)
        ) {
            return "monitor";
        }
        return "attention";
    }

    private static String qualitySummary(
        String qualityState,
        Double resolvedRatePercent,
        Double anchorCoveragePercent,
        Double offCorridorRatePercent,
        int configuredAnchorCount,
        long resolvedIncidentCount,
        long anchorInterpolatedCount
    ) {
        return switch (qualityState) {
            case "idle" -> "No recent incidents landed in the calibration window.";
            case "anchored" -> "Anchor calibration is carrying most recent incident placements cleanly.";
            case "monitor" -> "Anchor calibration is active, with a manageable fallback share still in play.";
            case "range_only" -> "Range-based calibration is active because no corridor anchors are configured.";
            case "critical" -> percentageAtLeast(offCorridorRatePercent, 20.0)
                ? "Too many incidents are landing off corridor; review corridor geometry and snapping."
                : "A large share of recent incidents still lack resolved mile markers.";
            default -> configuredAnchorCount > 0 && resolvedIncidentCount > 0 && anchorInterpolatedCount <= 0
                ? "Anchors are configured, but recent incidents are not resolving through them yet."
                : percentageBelow(resolvedRatePercent, 80.0)
                    ? "Calibration coverage is usable, but too many recent incidents remain unresolved."
                    : percentageAtLeast(offCorridorRatePercent, 10.0)
                        ? "Placements are resolving, but off-corridor share remains elevated."
                        : percentageBelow(anchorCoveragePercent, 50.0)
                            ? "Anchor calibration is active, but many incidents are still falling back to range estimates."
                            : "Calibration quality is usable, but still uneven across recent incidents.";
        };
    }

    private static boolean percentageAtLeast(Double value, double threshold) {
        return value != null && value >= threshold;
    }

    private static boolean percentageBelow(Double value, double threshold) {
        return value != null && value < threshold;
    }
}
