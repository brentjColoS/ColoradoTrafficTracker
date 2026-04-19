package com.example.api_service;

import com.example.api_service.dto.GeoJsonFeatureCollectionDto;
import com.example.api_service.dto.GeoJsonFeatureDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/map", "/dashboard-api/traffic/map"})
public class TrafficMapController {
    private static final int MAX_WINDOW_MINUTES = 10_080;
    private static final int MAX_INCIDENT_LIMIT = 1_000;

    private final CorridorRefRepository corridorRefRepository;
    private final TrafficSampleRepository sampleRepository;
    private final TrafficHistoryIncidentRepository incidentRepository;
    private final ObjectMapper objectMapper;

    public TrafficMapController(
        CorridorRefRepository corridorRefRepository,
        TrafficSampleRepository sampleRepository,
        TrafficHistoryIncidentRepository incidentRepository,
        ObjectMapper objectMapper
    ) {
        this.corridorRefRepository = corridorRefRepository;
        this.sampleRepository = sampleRepository;
        this.incidentRepository = incidentRepository;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/corridors")
    @Cacheable(cacheNames = "apiCorridors", key = "'map-corridors'")
    public GeoJsonFeatureCollectionDto corridors() {
        List<GeoJsonFeatureDto> features = corridorRefRepository.findAllByOrderByCodeAsc().stream()
            .map(this::toCorridorFeature)
            .toList();
        return new GeoJsonFeatureCollectionDto(features);
    }

    @GetMapping("/incidents")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'map-incidents|' + (#p0 == null ? 'all' : #p0) + '|' + #p1 + '|' + #p2",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<GeoJsonFeatureCollectionDto> incidents(
        @RequestParam(name = "corridor", required = false) String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "180") int windowMinutes,
        @RequestParam(name = "limit", defaultValue = "250") int limit
    ) {
        String normalized = corridor == null || corridor.isBlank() ? null : normalizeCorridor(corridor);
        if (corridor != null && normalized == null) return ResponseEntity.badRequest().build();
        if (windowMinutes < 1 || windowMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (limit < 1 || limit > MAX_INCIDENT_LIMIT) return ResponseEntity.badRequest().build();

        OffsetDateTime since = OffsetDateTime.now().minusMinutes(windowMinutes);
        PageRequest page = PageRequest.of(0, limit);
        List<TrafficHistoryIncident> incidents = normalized == null
            ? incidentRepository.findByPolledAtGreaterThanEqualOrderByPolledAtDesc(since, page).getContent()
            : incidentRepository.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(normalized, since, page).getContent();

        List<GeoJsonFeatureDto> features = incidents.stream()
            .map(this::toIncidentFeature)
            .toList();
        return ResponseEntity.ok(new GeoJsonFeatureCollectionDto(features));
    }

    private GeoJsonFeatureDto toCorridorFeature(CorridorRef corridor) {
        List<TrafficSample> usableSamples = sampleRepository.findLatestUsableByCorridor(corridor.getCode(), PageRequest.of(0, 1));
        TrafficSample latest = usableSamples == null
            ? sampleRepository.findFirstByCorridorOrderByPolledAtDesc(corridor.getCode()).orElse(null)
            : usableSamples.stream()
                .findFirst()
                .orElseGet(() -> sampleRepository.findFirstByCorridorOrderByPolledAtDesc(corridor.getCode()).orElse(null));
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("corridor", corridor.getCode());
        properties.put("displayName", corridor.getDisplayName());
        properties.put("roadNumber", corridor.getRoadNumber());
        properties.put("primaryDirection", corridor.getPrimaryDirection());
        properties.put("secondaryDirection", corridor.getSecondaryDirection());
        properties.put("startMileMarker", corridor.getStartMileMarker());
        properties.put("endMileMarker", corridor.getEndMileMarker());
        properties.put("mileMarkerAnchorsJson", corridor.getMileMarkerAnchorsJson());
        properties.put("mileMarkerRange", formatMileMarkerRange(corridor.getStartMileMarker(), corridor.getEndMileMarker()));
        properties.put("bbox", corridor.getBbox());
        properties.put("centerLat", corridor.getCenterLat());
        properties.put("centerLon", corridor.getCenterLon());
        properties.put("geometrySource", corridor.getGeometrySource());
        properties.put("geometryUpdatedAt", corridor.getGeometryUpdatedAt());

        if (latest != null) {
            properties.put("latestAvgCurrentSpeed", latest.getAvgCurrentSpeed());
            properties.put("latestAvgFreeflowSpeed", latest.getAvgFreeflowSpeed());
            properties.put("latestMinCurrentSpeed", latest.getMinCurrentSpeed());
            properties.put("latestConfidence", latest.getConfidence());
            properties.put("latestIncidentCount", latest.getIncidentCount());
            properties.put("latestPolledAt", latest.getPolledAt());
        }

        return new GeoJsonFeatureDto(corridor.getCode(), geometryNode(corridor.getGeometryJson()), properties);
    }

    private GeoJsonFeatureDto toIncidentFeature(TrafficHistoryIncident incident) {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("incidentRefId", incident.getIncidentRefId());
        properties.put("sampleRefId", incident.getSampleRefId());
        properties.put("corridor", incident.getCorridor());
        properties.put("roadNumber", incident.getRoadNumber());
        properties.put("travelDirection", incident.getTravelDirection());
        properties.put("travelDirectionLabel", directionLabel(incident.getTravelDirection()));
        properties.put("closestMileMarker", incident.getClosestMileMarker());
        properties.put("mileMarkerMethod", incident.getMileMarkerMethod());
        properties.put("mileMarkerConfidence", incident.getMileMarkerConfidence());
        properties.put("distanceToCorridorMeters", incident.getDistanceToCorridorMeters());
        properties.put("locationLabel", incident.getLocationLabel());
        properties.put("referenceKey", referenceKey(incident));
        properties.put("referenceLabel", referenceLabel(incident));
        properties.put("iconCategory", incident.getIconCategory());
        properties.put("delaySeconds", incident.getDelaySeconds());
        properties.put("polledAt", incident.getPolledAt());
        properties.put("normalizedAt", incident.getNormalizedAt());
        properties.put("archived", incident.getIsArchived());
        properties.put("archivedAt", incident.getArchivedAt());

        return new GeoJsonFeatureDto(
            String.valueOf(incident.getHistoryId()),
            incidentGeometry(incident),
            properties
        );
    }

    private JsonNode incidentGeometry(TrafficHistoryIncident incident) {
        JsonNode geometry = geometryNode(incident.getGeometryJson());
        if (geometry != null) return geometry;
        if (incident.getCentroidLat() == null || incident.getCentroidLon() == null) return null;

        ObjectNode point = objectMapper.createObjectNode();
        point.put("type", "Point");
        point.putArray("coordinates")
            .add(incident.getCentroidLon())
            .add(incident.getCentroidLat());
        return point;
    }

    private JsonNode geometryNode(String rawGeometry) {
        if (rawGeometry == null || rawGeometry.isBlank()) return null;
        try {
            return objectMapper.readTree(rawGeometry);
        } catch (Exception e) {
            return null;
        }
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null) return null;
        String value = corridor.trim().toUpperCase(Locale.ROOT);
        return value.isBlank() ? null : value;
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

    private static String referenceKey(TrafficHistoryIncident incident) {
        String corridor = incident.getCorridor() == null ? "UNKNOWN" : incident.getCorridor();
        String mileMarker = incident.getClosestMileMarker() == null
            ? "MM?"
            : String.format(Locale.US, "MM%.1f", incident.getClosestMileMarker());
        String direction = normalizeDirection(incident.getTravelDirection());
        return corridor + "|" + mileMarker + "|" + (direction == null ? "?" : direction);
    }

    private static String referenceLabel(TrafficHistoryIncident incident) {
        if (incident.getLocationLabel() != null && !incident.getLocationLabel().isBlank()) {
            return incident.getLocationLabel();
        }
        String corridor = incident.getRoadNumber() != null && !incident.getRoadNumber().isBlank()
            ? incident.getRoadNumber()
            : incident.getCorridor();
        String direction = directionLabel(incident.getTravelDirection());
        if (incident.getClosestMileMarker() != null && direction != null) {
            return String.format(Locale.US, "%s %s near MM %.1f", corridor, direction, incident.getClosestMileMarker());
        }
        if (incident.getClosestMileMarker() != null) {
            return String.format(Locale.US, "%s near MM %.1f", corridor, incident.getClosestMileMarker());
        }
        return corridor;
    }

    private static String formatMileMarkerRange(Double start, Double end) {
        if (start == null || end == null) return null;
        return String.format(Locale.US, "MM %.1f to %.1f", start, end);
    }
}
