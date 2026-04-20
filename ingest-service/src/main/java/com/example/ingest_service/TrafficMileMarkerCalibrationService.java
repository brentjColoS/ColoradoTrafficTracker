package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TrafficMileMarkerCalibrationService {
    private static final Logger log = LoggerFactory.getLogger(TrafficMileMarkerCalibrationService.class);

    private final RoutesClient routesClient;
    private final CorridorMetadataSyncService corridorMetadataSyncService;
    private final CorridorRefRepository corridorRefRepository;
    private final TrafficIncidentRepository trafficIncidentRepository;
    private final TrafficMileMarkerCalibrationProps props;
    private final ObjectMapper objectMapper;
    private final AtomicBoolean calibrationRunning = new AtomicBoolean(false);

    public TrafficMileMarkerCalibrationService(
        RoutesClient routesClient,
        CorridorMetadataSyncService corridorMetadataSyncService,
        CorridorRefRepository corridorRefRepository,
        TrafficIncidentRepository trafficIncidentRepository,
        TrafficMileMarkerCalibrationProps props,
        ObjectMapper objectMapper
    ) {
        this.routesClient = routesClient;
        this.corridorMetadataSyncService = corridorMetadataSyncService;
        this.corridorRefRepository = corridorRefRepository;
        this.trafficIncidentRepository = trafficIncidentRepository;
        this.props = props;
        this.objectMapper = objectMapper;
    }

    public CalibrationReport recalibrateRecentIncidents() {
        return recalibrateRecentIncidents(null, null);
    }

    public CalibrationReport recalibrateRecentIncidents(Integer lookbackHoursOverride, String corridorOverride) {
        if (!props.enabled()) {
            return new CalibrationReport(false, normalizeLookbackHours(lookbackHoursOverride), normalizeCorridor(corridorOverride), 0, 0, 0, 0);
        }
        if (!calibrationRunning.compareAndSet(false, true)) {
            throw new CalibrationInProgressException();
        }

        try {
            List<TrafficProps.Corridor> corridors = routesClient.fetchCorridors().block();
            if (corridors == null || corridors.isEmpty()) {
                log.warn("Skipping mile-marker calibration because routes-service returned no corridors");
                return new CalibrationReport(true, normalizeLookbackHours(lookbackHoursOverride), normalizeCorridor(corridorOverride), 0, 0, 0, 0);
            }

            String normalizedCorridor = normalizeCorridor(corridorOverride);
            List<TrafficProps.Corridor> scopedCorridors = normalizedCorridor == null
                ? corridors
                : corridors.stream()
                    .filter(corridor -> normalizedCorridor.equalsIgnoreCase(corridor.name()))
                    .toList();
            if (scopedCorridors.isEmpty()) {
                log.warn("Skipping mile-marker calibration because corridor {} is not configured by routes-service", normalizedCorridor);
                return new CalibrationReport(true, normalizeLookbackHours(lookbackHoursOverride), normalizedCorridor, 0, 0, 0, 0);
            }

            corridorMetadataSyncService.sync(scopedCorridors);
            Map<String, TrafficProps.Corridor> corridorsByCode = new LinkedHashMap<>();
            for (TrafficProps.Corridor corridor : scopedCorridors) {
                corridorsByCode.put(corridor.name(), corridor);
            }

            Map<String, List<double[]>> polylinesByCorridor = corridorPolylines(scopedCorridors);
            int lookbackHours = normalizeLookbackHours(lookbackHoursOverride);
            OffsetDateTime since = OffsetDateTime.now(ZoneOffset.UTC).minusHours(lookbackHours);
            int batchSize = Math.max(25, props.batchSize());
            int scanned = 0;
            int updated = 0;
            int resolved = 0;
            int unresolved = 0;
            int pageNumber = 0;

            while (true) {
                Page<TrafficIncident> page = fetchCalibrationPage(normalizedCorridor, since, pageNumber, batchSize);
                if (page.isEmpty()) {
                    break;
                }

                BatchResult batch = recalibrateBatch(page.getContent(), corridorsByCode, polylinesByCorridor);
                scanned += batch.scanned();
                updated += batch.updated();
                resolved += batch.resolved();
                unresolved += batch.unresolved();

                if (!page.hasNext()) {
                    break;
                }
                pageNumber += 1;
            }

            log.info(
                "Mile-marker calibration complete (corridor={}, lookbackHours={}, scanned={}, updated={}, resolved={}, unresolved={})",
                normalizedCorridor == null ? "all" : normalizedCorridor,
                lookbackHours,
                scanned,
                updated,
                resolved,
                unresolved
            );
            return new CalibrationReport(true, lookbackHours, normalizedCorridor, scanned, updated, resolved, unresolved);
        } finally {
            calibrationRunning.set(false);
        }
    }

    @Transactional
    protected BatchResult recalibrateBatch(
        List<TrafficIncident> incidents,
        Map<String, TrafficProps.Corridor> corridorsByCode,
        Map<String, List<double[]>> polylinesByCorridor
    ) {
        List<TrafficIncident> dirty = new ArrayList<>();
        int scanned = 0;
        int resolved = 0;
        int unresolved = 0;

        for (TrafficIncident incident : incidents) {
            scanned += 1;
            TrafficProps.Corridor corridor = corridorsByCode.get(incident.getCorridor());
            List<double[]> polyline = polylinesByCorridor.get(incident.getCorridor());
            if (corridor == null || polyline == null || polyline.size() < 2) {
                continue;
            }

            JsonNode incidentNode = incidentNode(incident);
            if (incidentNode == null) {
                continue;
            }

            IncidentLocationDetails details = IncidentLocationEnricher.resolveDetails(incidentNode, corridor, polyline);
            if (details.closestMileMarker() != null) {
                resolved += 1;
            } else {
                unresolved += 1;
            }

            if (!applyDetailsIfChanged(incident, details)) {
                continue;
            }
            dirty.add(incident);
        }

        if (!dirty.isEmpty()) {
            trafficIncidentRepository.saveAll(dirty);
        }

        return new BatchResult(scanned, dirty.size(), resolved, unresolved);
    }

    private Map<String, List<double[]>> corridorPolylines(List<TrafficProps.Corridor> corridors) {
        Map<String, String> storedGeometry = new LinkedHashMap<>();
        corridorRefRepository.findAllById(corridors.stream().map(TrafficProps.Corridor::name).toList())
            .forEach(ref -> storedGeometry.put(ref.getCode(), ref.getGeometryJson()));

        Map<String, List<double[]>> out = new LinkedHashMap<>();
        for (TrafficProps.Corridor corridor : corridors) {
            String geometryJson = storedGeometry.get(corridor.name());
            if (geometryJson == null || geometryJson.isBlank()) {
                geometryJson = corridor.geometryJson();
            }
            if ((geometryJson == null || geometryJson.isBlank()) && corridor.bbox() != null) {
                geometryJson = CorridorGeometrySupport.fallbackGeoJsonFromBbox(
                    corridor.bbox(),
                    corridor.primaryDirection(),
                    corridor.secondaryDirection()
                );
            }
            out.put(corridor.name(), geometryPoints(geometryJson));
        }
        return out;
    }

    private Page<TrafficIncident> fetchCalibrationPage(
        String corridor,
        OffsetDateTime since,
        int pageNumber,
        int batchSize
    ) {
        PageRequest pageRequest = PageRequest.of(pageNumber, batchSize);
        if (corridor == null) {
            return trafficIncidentRepository.findByPolledAtGreaterThanEqualOrderByPolledAtAsc(since, pageRequest);
        }
        return trafficIncidentRepository.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtAsc(corridor, since, pageRequest);
    }

    private int normalizeLookbackHours(Integer lookbackHoursOverride) {
        return Math.max(1, lookbackHoursOverride == null ? props.lookbackHours() : lookbackHoursOverride);
    }

    private static String normalizeCorridor(String corridorOverride) {
        if (corridorOverride == null || corridorOverride.isBlank()) {
            return null;
        }
        return corridorOverride.trim().toUpperCase(Locale.ROOT);
    }

    private JsonNode incidentNode(TrafficIncident incident) {
        try {
            ObjectNode root = objectMapper.createObjectNode();
            if (incident.getGeometryJson() != null && !incident.getGeometryJson().isBlank()) {
                root.set("geometry", objectMapper.readTree(incident.getGeometryJson()));
                return root;
            }
            if (incident.getCentroidLat() == null || incident.getCentroidLon() == null) {
                return null;
            }

            ObjectNode point = objectMapper.createObjectNode();
            point.put("type", "Point");
            point.putArray("coordinates")
                .add(incident.getCentroidLon())
                .add(incident.getCentroidLat());
            root.set("geometry", point);
            return root;
        } catch (Exception e) {
            log.debug("Skipping incident {} during mile-marker calibration due to geometry parse failure: {}", incident.getId(), e.toString());
            return null;
        }
    }

    private List<double[]> geometryPoints(String geometryJson) {
        if (geometryJson == null || geometryJson.isBlank()) {
            return List.of();
        }

        try {
            JsonNode geometry = objectMapper.readTree(geometryJson);
            List<double[]> points = new ArrayList<>();
            String type = geometry.path("type").asText("");
            JsonNode coordinates = geometry.path("coordinates");
            if ("LineString".equals(type)) {
                for (JsonNode point : coordinates) {
                    addPoint(points, point);
                }
            } else if ("MultiLineString".equals(type)) {
                for (JsonNode line : coordinates) {
                    for (JsonNode point : line) {
                        addPoint(points, point);
                    }
                }
            }
            return points;
        } catch (Exception e) {
            log.debug("Skipping corridor geometry during mile-marker calibration due to parse failure: {}", e.toString());
            return List.of();
        }
    }

    private static void addPoint(List<double[]> points, JsonNode coordinate) {
        if (!coordinate.isArray() || coordinate.size() < 2) {
            return;
        }
        points.add(new double[]{coordinate.get(1).asDouble(), coordinate.get(0).asDouble()});
    }

    private static boolean applyDetailsIfChanged(TrafficIncident incident, IncidentLocationDetails details) {
        boolean changed = false;
        changed |= updateString(incident.getTravelDirection(), details.travelDirection(), incident::setTravelDirection);
        changed |= updateDouble(incident.getClosestMileMarker(), details.closestMileMarker(), incident::setClosestMileMarker);
        changed |= updateString(incident.getMileMarkerMethod(), details.mileMarkerMethod(), incident::setMileMarkerMethod);
        changed |= updateDouble(incident.getMileMarkerConfidence(), details.mileMarkerConfidence(), incident::setMileMarkerConfidence);
        changed |= updateDouble(incident.getDistanceToCorridorMeters(), details.distanceToCorridorMeters(), incident::setDistanceToCorridorMeters);
        changed |= updateString(incident.getLocationLabel(), details.locationLabel(), incident::setLocationLabel);
        changed |= updateDouble(incident.getCentroidLat(), details.centroidLat(), incident::setCentroidLat);
        changed |= updateDouble(incident.getCentroidLon(), details.centroidLon(), incident::setCentroidLon);
        return changed;
    }

    private static boolean updateString(String current, String next, java.util.function.Consumer<String> setter) {
        if (java.util.Objects.equals(current, next)) {
            return false;
        }
        setter.accept(next);
        return true;
    }

    private static boolean updateDouble(Double current, Double next, java.util.function.Consumer<Double> setter) {
        if (java.util.Objects.equals(current, next)) {
            return false;
        }
        setter.accept(next);
        return true;
    }

    public record CalibrationReport(
        boolean calibrationEnabled,
        int lookbackHours,
        String corridor,
        int scannedIncidentCount,
        int updatedIncidentCount,
        int resolvedIncidentCount,
        int unresolvedIncidentCount
    ) {}

    public static final class CalibrationInProgressException extends IllegalStateException {
        public CalibrationInProgressException() {
            super("A mile-marker calibration run is already in progress.");
        }
    }

    protected record BatchResult(
        int scanned,
        int updated,
        int resolved,
        int unresolved
    ) {}
}
