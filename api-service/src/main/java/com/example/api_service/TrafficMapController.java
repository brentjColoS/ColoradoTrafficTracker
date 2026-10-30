package com.example.api_service;

import static com.example.api_service.CorridorCodes.normalizeCorridor;

import com.example.api_service.dto.GeoJsonFeatureCollectionDto;
import com.example.api_service.dto.GeoJsonFeatureDto;
import com.example.common.CorridorSpeedZones;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
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
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/map", "/dashboard-api/traffic/map"})
public class TrafficMapController {
    private static final int MAX_WINDOW_MINUTES = 10_080;
    private static final int MAX_INCIDENT_LIMIT = 1_000;

    private final CorridorRefRepository corridorRefRepository;
    private final TrafficSampleRepository sampleRepository;
    private final CurrentIncidentRepository incidentRepository;
    private final ObjectMapper objectMapper;
    private final MapIncidentGeometry geometrySupport;

    public TrafficMapController(
        CorridorRefRepository corridorRefRepository,
        TrafficSampleRepository sampleRepository,
        CurrentIncidentRepository incidentRepository,
        ObjectMapper objectMapper
    ) {
        this.corridorRefRepository = corridorRefRepository;
        this.sampleRepository = sampleRepository;
        this.incidentRepository = incidentRepository;
        this.objectMapper = objectMapper;
        this.geometrySupport = new MapIncidentGeometry(objectMapper);
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
        List<CurrentMapIncident> incidents = (normalized == null
            ? incidentRepository.findCurrentSince(since, limit)
            : incidentRepository.findCurrentByCorridorSince(normalized, since, limit)).stream()
            .map(incident -> new CurrentMapIncident(incident, objectMapper))
            .toList();
        Map<String, CorridorRef> corridorsByCode = corridorsByCode(incidents);

        List<GeoJsonFeatureDto> features = incidents.stream()
            .map(incident -> toIncidentFeature(incident, corridorsByCode.get(incident.getCorridor())))
            .toList();
        return ResponseEntity.ok(new GeoJsonFeatureCollectionDto(features));
    }

    @GetMapping("/incidents/recent")
    @Cacheable(cacheNames = "apiHistory", key = "'recent-events|' + #p0 + '|' + #p1 + '|' + #p2",
        unless = "#result == null || #result.statusCodeValue != 200")
    public ResponseEntity<GeoJsonFeatureCollectionDto> recentIncidents(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "1440") int windowMinutes,
        @RequestParam(name = "limit", defaultValue = "1000") int limit
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null || windowMinutes < 1 || windowMinutes > 43_200
            || limit < 1 || limit > MAX_INCIDENT_LIMIT) {
            return ResponseEntity.badRequest().build();
        }
        List<CurrentMapIncident> incidents = incidentRepository.findRecentByCorridorSince(
            normalized, OffsetDateTime.now().minusMinutes(windowMinutes), limit
        ).stream().map(row -> new CurrentMapIncident(row, objectMapper)).toList();
        Map<String, CorridorRef> corridors = corridorsByCode(incidents);
        return ResponseEntity.ok(new GeoJsonFeatureCollectionDto(incidents.stream()
            .map(row -> toIncidentFeature(row, corridors.get(row.getCorridor()))).toList()));
    }

    public record SharedIncidents(List<GeoJsonFeatureDto> features, OffsetDateTime since, boolean truncated) {}

    public ResponseEntity<SharedIncidents> sharedIncidents(String corridor) {
        OffsetDateTime since = OffsetDateTime.now().minusDays(30);
        List<CurrentMapIncident> rows = incidentRepository.findRecentByCorridorSince(corridor, since, 1001)
            .stream().map(row -> new CurrentMapIncident(row, objectMapper)).toList();
        Map<String, CorridorRef> corridors = corridorsByCode(rows);
        return ResponseEntity.ok(new SharedIncidents(rows.stream().limit(1000)
            .map(row -> toIncidentFeature(row, corridors.get(row.getCorridor()))).toList(), since, rows.size() > 1000));
    }

    @GetMapping("/incidents/timeline")
    @Cacheable(
        cacheNames = "apiHistory",
        key = "'incident-timeline|' + #p0 + '|' + #p1 + '|' + #p2 + '|' + (#p3 == null ? 'now' : #p3)",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    public ResponseEntity<GeoJsonFeatureCollectionDto> incidentTimeline(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "1440") int windowMinutes,
        @RequestParam(name = "limit", defaultValue = "1000") int limit,
        @RequestParam(name = "asOf", required = false)
        @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null || windowMinutes < 1 || windowMinutes > 43_200
            || limit < 1 || limit > MAX_INCIDENT_LIMIT) {
            return ResponseEntity.badRequest().build();
        }
        OffsetDateTime until = asOf == null ? OffsetDateTime.now() : asOf;
        OffsetDateTime since = until.minusMinutes(windowMinutes);
        List<CurrentIncidentProjection> rows = incidentRepository.findDurableTimelineByCorridorBetween(
            normalized, since, until, until.minusMinutes(20), limit
        );
        // Pre-CDOT archives have no durable event rows. Keep the sample-array
        // reconstruction solely as an honest compatibility path for those dumps.
        if (rows.isEmpty() && !incidentRepository.hasDurableEventsAtOrBefore(until)) {
            rows = incidentRepository.findHistoricalTimelineByCorridorBetween(
                normalized, since, until, until.minusMinutes(3), limit
            );
        }
        List<CurrentMapIncident> incidents = rows.stream()
            .map(row -> new CurrentMapIncident(row, objectMapper))
            .toList();
        Map<String, CorridorRef> corridors = corridorsByCode(incidents);
        return ResponseEntity.ok(new GeoJsonFeatureCollectionDto(incidents.stream()
            .map(row -> toIncidentFeature(row, corridors.get(row.getCorridor()))).toList()));
    }

    private Map<String, CorridorRef> corridorsByCode(List<CurrentMapIncident> incidents) {
        Set<String> codes = new HashSet<>();
        for (CurrentMapIncident incident : incidents) {
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
        List<Map<String, Object>> speedLimitSegments = speedLimitSegments(corridor.getCode());
        properties.put("speedLimitSegments", speedLimitSegments);
        properties.put("speedLimitSource", speedLimitSegments.isEmpty() ? null : "CDOT HighwaySegments SPEEDLIM");
        properties.put("speedLimitNote", speedLimitNote(corridor.getCode(), speedLimitSegments));

        if (latest != null) {
            properties.put("latestAvgCurrentSpeed", latest.getAvgCurrentSpeed());
            properties.put("latestAvgFreeflowSpeed", latest.getAvgFreeflowSpeed());
            properties.put("latestMinCurrentSpeed", latest.getMinCurrentSpeed());
            properties.put("latestConfidence", latest.getConfidence());
            properties.put("latestIncidentCount", latest.getIncidentCount());
            properties.put("latestPolledAt", latest.getPolledAt());
        }

        return new GeoJsonFeatureDto(corridor.getCode(), geometrySupport.geometryNode(corridor.getGeometryJson()), properties);
    }

    private static List<Map<String, Object>> speedLimitSegments(String corridorCode) {
        return CorridorSpeedZones.forCorridor(corridorCode).stream()
            .map(segment -> {
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("startMileMarker", segment.startMileMarker());
                out.put("endMileMarker", segment.endMileMarker());
                out.put("speedLimitMph", segment.postedSpeedMph());
                out.put("description", segment.description());
                out.put("label", segment.label());
                return out;
            })
            .toList();
    }

    private static String speedLimitNote(String corridorCode, List<Map<String, Object>> segments) {
        if (segments.isEmpty()) return null;
        if ("I70".equalsIgnoreCase(corridorCode)) {
            return "Baseline posted limits; eastbound variable speed-limit signs between Georgetown and Idaho Springs may post lower active limits during weather, congestion, or incidents.";
        }
        return "Baseline posted limits from CDOT corridor segment data.";
    }

    private GeoJsonFeatureDto toIncidentFeature(CurrentMapIncident incident, CorridorRef corridor) {
        var displayGeometry = geometrySupport.displayGeometry(incident, corridor);
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("incidentRefId", incident.getIncidentRefId());
        properties.put("sampleRefId", incident.getSampleRefId());
        properties.put("corridor", incident.getCorridor());
        properties.put("roadNumber", incident.getRoadNumber());
        properties.put("travelDirection", incident.getTravelDirection());
        properties.put("travelDirectionLabel", MapIncidentPresentation.directionLabel(incident.getTravelDirection()));
        properties.put("closestMileMarker", incident.getClosestMileMarker());
        properties.put("mileMarkerMethod", incident.getMileMarkerMethod());
        properties.put("mileMarkerConfidence", incident.getMileMarkerConfidence());
        properties.put("distanceToCorridorMeters", incident.getDistanceToCorridorMeters());
        properties.put("locationLabel", incident.getLocationLabel());
        properties.put("incidentProvider", incident.getIncidentProvider());
        properties.put("incidentProduct", incident.getIncidentProduct());
        properties.put("providerEventId", incident.getProviderEventId());
        properties.put("normalizedStatus", incident.getNormalizedStatus());
        properties.put("normalizedCategory", incident.getNormalizedCategory());
        properties.put("sourceType", incident.getSourceType());
        properties.put("sourceSeverity", incident.getSourceSeverity());
        properties.put("sourceStartMarker", incident.getSourceStartMarker());
        properties.put("sourceEndMarker", incident.getSourceEndMarker());
        properties.put("sourceStartedAt", incident.getSourceStartedAt());
        properties.put("sourceEndedAt", incident.getSourceEndedAt());
        properties.put("sourceUpdatedAt", incident.getSourceUpdatedAt());
        properties.put("eventActive", incident.getEventActive());
        properties.put("corridorActive", incident.getCorridorActive());
        properties.put("lastMatchedAt", incident.getLastMatchedAt());
        properties.put("firstSeenAt", incident.getFirstSeenAt());
        properties.put("lastSeenAt", incident.getLastSeenAt());
        properties.put("active", incident.isActive());
        properties.put("isApproximateLocation", incident.getClosestMileMarker() == null);
        properties.put("isOffCorridor", "off_corridor".equalsIgnoreCase(String.valueOf(incident.getMileMarkerMethod())));
        properties.put("hasDelaySignal", incident.getDelaySeconds() != null && incident.getDelaySeconds() > 0);
        properties.put("referenceKey", MapIncidentPresentation.referenceKey(incident));
        properties.put("referenceLabel", MapIncidentPresentation.referenceLabel(incident));
        properties.put("iconCategory", incident.getIconCategory());
        properties.put("incidentTypeLabel", MapIncidentPresentation.incidentTypeLabel(incident));
        properties.put("incidentDescription", MapIncidentPresentation.incidentDescription(incident));
        properties.put("incidentImpactLabel", MapIncidentPresentation.incidentImpactLabel(incident));
        properties.put("incidentNote", MapIncidentPresentation.incidentNote(incident));
        properties.put("incidentDisplayLabel", MapIncidentPresentation.incidentDisplayLabel(incident));
        properties.put("delaySeconds", incident.getDelaySeconds());
        properties.put("displayGeometrySource", displayGeometry.source());
        properties.put("displaySnapDistanceMeters", displayGeometry.snapDistanceMeters());
        properties.put("providerGeometryType", incident.getGeometryType());
        properties.put("providerCentroidLat", displayGeometry.providerLat());
        properties.put("providerCentroidLon", displayGeometry.providerLon());
        properties.put("mapSnappedToCorridor", displayGeometry.source().endsWith("_snapped"));
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


    private static String formatMileMarkerRange(Double start, Double end) {
        if (start == null || end == null) return null;
        return String.format(Locale.US, "MM %.1f to %.1f", start, end);
    }

}
