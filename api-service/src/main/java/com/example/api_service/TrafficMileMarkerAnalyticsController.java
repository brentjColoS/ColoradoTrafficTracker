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

        return new MileMarkerCorridorAssessmentDto(
            corridor.getCode(),
            corridor.getStartMileMarker(),
            corridor.getEndMileMarker(),
            anchorCount(corridor.getMileMarkerAnchorsJson()),
            recentIncidentCount,
            resolvedIncidentCount,
            unresolvedIncidentCount,
            highConfidenceCount,
            anchorInterpolatedCount,
            rangeInterpolatedCount,
            directionOnlyCount,
            offCorridorCount,
            avgDistanceToCorridorMeters == null ? null : roundToSingleDecimal(avgDistanceToCorridorMeters),
            resolvedRatePercent
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
}
