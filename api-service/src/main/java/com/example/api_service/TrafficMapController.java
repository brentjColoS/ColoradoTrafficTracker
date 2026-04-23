package com.example.api_service;

import com.example.api_service.dto.GeoJsonFeatureCollectionDto;
import com.example.api_service.dto.GeoJsonFeatureDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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
        Map<String, CorridorRef> corridorsByCode = corridorsByCode(incidents);

        List<GeoJsonFeatureDto> features = incidents.stream()
            .map(incident -> toIncidentFeature(incident, corridorsByCode.get(incident.getCorridor())))
            .toList();
        return ResponseEntity.ok(new GeoJsonFeatureCollectionDto(features));
    }

    private Map<String, CorridorRef> corridorsByCode(List<TrafficHistoryIncident> incidents) {
        Set<String> codes = new HashSet<>();
        for (TrafficHistoryIncident incident : incidents) {
            if (incident.getCorridor() != null && !incident.getCorridor().isBlank()) {
                codes.add(incident.getCorridor());
            }
        }
        if (codes.isEmpty()) return Map.of();

        Iterable<CorridorRef> corridors = corridorRefRepository.findAllById(codes);
        if (corridors == null) return Map.of();

        Map<String, CorridorRef> out = new HashMap<>();
        for (CorridorRef corridor : corridors) {
            if (corridor != null && corridor.getCode() != null) {
                out.put(corridor.getCode(), corridor);
            }
        }
        return out;
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

    private GeoJsonFeatureDto toIncidentFeature(TrafficHistoryIncident incident, CorridorRef corridor) {
        IncidentDisplayGeometry displayGeometry = incidentDisplayGeometry(incident, corridor);
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
        properties.put("isApproximateLocation", incident.getClosestMileMarker() == null);
        properties.put("isOffCorridor", "off_corridor".equalsIgnoreCase(String.valueOf(incident.getMileMarkerMethod())));
        properties.put("hasDelaySignal", incident.getDelaySeconds() != null && incident.getDelaySeconds() > 0);
        properties.put("referenceKey", referenceKey(incident));
        properties.put("referenceLabel", referenceLabel(incident));
        properties.put("iconCategory", incident.getIconCategory());
        properties.put("incidentTypeLabel", incidentTypeLabel(incident.getIconCategory()));
        properties.put("incidentDescription", incidentDescription(incident));
        properties.put("incidentDisplayLabel", incidentDisplayLabel(incident));
        properties.put("delaySeconds", incident.getDelaySeconds());
        properties.put("displayGeometrySource", displayGeometry.source());
        properties.put("displaySnapDistanceMeters", displayGeometry.snapDistanceMeters());
        properties.put("providerGeometryType", incident.getGeometryType());
        properties.put("providerCentroidLat", displayGeometry.providerLat());
        properties.put("providerCentroidLon", displayGeometry.providerLon());
        properties.put("mapSnappedToCorridor", "corridor_snapped".equals(displayGeometry.source()));
        properties.put("polledAt", incident.getPolledAt());
        properties.put("normalizedAt", incident.getNormalizedAt());
        properties.put("archived", incident.getIsArchived());
        properties.put("archivedAt", incident.getArchivedAt());

        return new GeoJsonFeatureDto(
            String.valueOf(incident.getHistoryId()),
            displayGeometry.geometry(),
            properties
        );
    }

    private IncidentDisplayGeometry incidentDisplayGeometry(TrafficHistoryIncident incident, CorridorRef corridor) {
        JsonNode geometry = geometryNode(incident.getGeometryJson());
        double[] providerPoint = incidentSourcePoint(incident, geometry);
        ProjectionMatch snap = providerPoint == null ? null : snapToCorridor(providerPoint[0], providerPoint[1], corridor);
        if (snap != null) {
            return new IncidentDisplayGeometry(
                pointGeometry(snap.lon(), snap.lat()),
                "corridor_snapped",
                roundToSingleDecimal(snap.distanceMeters()),
                providerPoint[0],
                providerPoint[1]
            );
        }
        if (providerPoint != null) {
            return new IncidentDisplayGeometry(
                pointGeometry(providerPoint[1], providerPoint[0]),
                incident.getCentroidLat() != null && incident.getCentroidLon() != null ? "centroid" : "provider_center",
                null,
                providerPoint[0],
                providerPoint[1]
            );
        }
        if (geometry != null) {
            return new IncidentDisplayGeometry(geometry, "provider_geometry", null, null, null);
        }
        return new IncidentDisplayGeometry(null, "unavailable", null, null, null);
    }

    private double[] incidentSourcePoint(TrafficHistoryIncident incident, JsonNode geometry) {
        if (incident.getCentroidLat() != null && incident.getCentroidLon() != null) {
            return new double[]{incident.getCentroidLat(), incident.getCentroidLon()};
        }
        List<double[]> points = geometryPoints(geometry);
        if (points.isEmpty()) return null;

        double latSum = 0.0;
        double lonSum = 0.0;
        for (double[] point : points) {
            latSum += point[0];
            lonSum += point[1];
        }
        return new double[]{latSum / points.size(), lonSum / points.size()};
    }

    private JsonNode pointGeometry(double lon, double lat) {
        ObjectNode point = objectMapper.createObjectNode();
        point.put("type", "Point");
        point.putArray("coordinates")
            .add(lon)
            .add(lat);
        return point;
    }

    private ProjectionMatch snapToCorridor(double lat, double lon, CorridorRef corridor) {
        if (corridor == null) return null;
        List<double[]> polyline = geometryPoints(geometryNode(corridor.getGeometryJson()));
        if (polyline.size() < 2) return null;

        ProjectionMatch best = null;
        for (int i = 0; i < polyline.size() - 1; i++) {
            SegmentProjection projection = projectOntoSegment(lat, lon, polyline.get(i), polyline.get(i + 1));
            if (best == null || projection.distanceMeters() < best.distanceMeters()) {
                best = new ProjectionMatch(projection.lat(), projection.lon(), projection.distanceMeters());
            }
        }
        return best;
    }

    private static SegmentProjection projectOntoSegment(double plat, double plon, double[] start, double[] end) {
        double lat0 = Math.toRadians(plat);
        double mLat = 111320.0;
        double mLon = 111320.0 * Math.cos(lat0);

        double ax = (start[1] - plon) * mLon;
        double ay = (start[0] - plat) * mLat;
        double bx = (end[1] - plon) * mLon;
        double by = (end[0] - plat) * mLat;

        double vectorX = bx - ax;
        double vectorY = by - ay;
        double len2 = (vectorX * vectorX) + (vectorY * vectorY);
        if (len2 == 0.0) return new SegmentProjection(start[0], start[1], Math.hypot(ax, ay));

        double t = -(ax * vectorX + ay * vectorY) / len2;
        t = Math.max(0.0, Math.min(1.0, t));

        double lat = start[0] + ((end[0] - start[0]) * t);
        double lon = start[1] + ((end[1] - start[1]) * t);
        double px = ax + (t * vectorX);
        double py = ay + (t * vectorY);
        return new SegmentProjection(lat, lon, Math.hypot(px, py));
    }

    private JsonNode geometryNode(String rawGeometry) {
        if (rawGeometry == null || rawGeometry.isBlank()) return null;
        try {
            return objectMapper.readTree(rawGeometry);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<double[]> geometryPoints(JsonNode geometry) {
        List<double[]> points = new ArrayList<>();
        if (geometry == null || geometry.isMissingNode()) return points;

        String type = geometry.path("type").asText("");
        JsonNode coordinates = geometry.path("coordinates");

        if ("Point".equals(type)) {
            addPoint(points, coordinates);
            return points;
        }
        if ("LineString".equals(type)) {
            for (JsonNode point : coordinates) addPoint(points, point);
            return points;
        }
        if ("MultiLineString".equals(type)) {
            for (JsonNode line : coordinates) {
                for (JsonNode point : line) addPoint(points, point);
            }
        }
        return points;
    }

    private static void addPoint(List<double[]> points, JsonNode coordinate) {
        if (!coordinate.isArray() || coordinate.size() < 2) return;
        points.add(new double[]{coordinate.get(1).asDouble(), coordinate.get(0).asDouble()});
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

    private static String incidentDisplayLabel(TrafficHistoryIncident incident) {
        String description = incidentDescription(incident);
        String reference = referenceLabel(incident);
        if (description != null && !description.isBlank()) {
            if (reference != null && !reference.isBlank()) {
                return sentenceCase(description) + " at " + reference;
            }
            return sentenceCase(description);
        }

        String type = incidentTypeLabel(incident.getIconCategory());
        if (type != null && !type.isBlank()) {
            if (reference != null && !reference.isBlank()) {
                return type + " at " + reference;
            }
            return type;
        }
        return reference;
    }

    private static String incidentDescription(TrafficHistoryIncident incident) {
        String description = incident.getIncidentDescription();
        if (description != null && !description.isBlank()) {
            return readableIncidentDescription(description);
        }
        return incidentTypeLabel(incident.getIconCategory());
    }

    private static String readableIncidentDescription(String description) {
        if (description == null || description.isBlank()) return null;
        String normalized = description.trim().replace('_', ' ').replace('-', ' ');
        normalized = normalized.replaceAll("\\s+", " ");
        String key = normalized.toLowerCase(Locale.ROOT);
        return switch (key) {
            case "roadworks", "road work", "roadwork" -> "Road works";
            case "cluster" -> "Incident cluster";
            case "heavy traffic" -> "Heavy traffic";
            case "stationary traffic" -> "Stationary traffic";
            case "slow traffic" -> "Slow traffic";
            case "queueing traffic", "queuing traffic" -> "Queueing traffic";
            case "broken down vehicle", "broken vehicle" -> "Broken down vehicle";
            default -> sentenceCase(normalized);
        };
    }

    static String incidentTypeLabel(Integer iconCategory) {
        if (iconCategory == null) return null;
        return switch (iconCategory) {
            case 0 -> "Unknown";
            case 1 -> "Accident";
            case 2 -> "Fog";
            case 3 -> "Dangerous conditions";
            case 4 -> "Rain";
            case 5 -> "Ice";
            case 6 -> "Traffic jam";
            case 7 -> "Lane closed";
            case 8 -> "Road closed";
            case 9 -> "Road works";
            case 10 -> "Wind";
            case 11 -> "Flooding";
            case 13 -> "Incident cluster";
            case 14 -> "Broken down vehicle";
            default -> "Incident type " + iconCategory;
        };
    }

    private static String sentenceCase(String value) {
        if (value == null || value.isBlank()) return value;
        String trimmed = value.trim();
        return trimmed.substring(0, 1).toUpperCase(Locale.ROOT) + trimmed.substring(1);
    }

    private static String formatMileMarkerRange(Double start, Double end) {
        if (start == null || end == null) return null;
        return String.format(Locale.US, "MM %.1f to %.1f", start, end);
    }

    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    private record IncidentDisplayGeometry(
        JsonNode geometry,
        String source,
        Double snapDistanceMeters,
        Double providerLat,
        Double providerLon
    ) {}
    private record SegmentProjection(double lat, double lon, double distanceMeters) {}
    private record ProjectionMatch(double lat, double lon, double distanceMeters) {}
}
