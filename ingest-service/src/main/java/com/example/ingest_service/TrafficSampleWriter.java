package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TrafficSampleWriter {
    private static final Logger log = LoggerFactory.getLogger(TrafficSampleWriter.class);

    private final TrafficSampleRepository sampleRepo;
    private final TrafficIncidentRepository incidentRepo;
    private final ObjectMapper objectMapper;
    private final Counter samplesPersistedCounter;
    private final Counter incidentsNormalizedCounter;

    public TrafficSampleWriter(
        TrafficSampleRepository sampleRepo,
        TrafficIncidentRepository incidentRepo,
        ObjectMapper objectMapper,
        MeterRegistry meterRegistry
    ) {
        this.sampleRepo = sampleRepo;
        this.incidentRepo = incidentRepo;
        this.objectMapper = objectMapper;
        this.samplesPersistedCounter = Counter.builder("traffic.ingest.samples.persisted.total")
            .description("Total persisted traffic samples")
            .register(meterRegistry);
        this.incidentsNormalizedCounter = Counter.builder("traffic.ingest.incidents.normalized.total")
            .description("Total normalized incident rows persisted")
            .register(meterRegistry);
    }

    @Transactional
    public TrafficSample saveSampleWithIncidents(TrafficSample sample) {
        TrafficSample saved = sampleRepo.save(sample);
        samplesPersistedCounter.increment();
        persistNormalizedIncidents(saved);
        return saved;
    }

    private void persistNormalizedIncidents(TrafficSample sample) {
        if (sample.getIncidentsJson() == null || sample.getIncidentsJson().isBlank()) return;

        JsonNode root;
        try {
            root = objectMapper.readTree(sample.getIncidentsJson());
        } catch (Exception e) {
            log.warn("Unable to parse incidents_json for sample {}: {}", sample.getId(), e.toString());
            return;
        }

        JsonNode incidents = root.path("incidents");
        if (!incidents.isArray() || incidents.isEmpty()) return;

        List<TrafficIncident> out = new ArrayList<>();

        for (JsonNode incident : incidents) {
            JsonNode props = incident.path("properties");
            JsonNode geometry = incident.path("geometry");

            Integer iconCategory = props.path("iconCategory").isNumber() ? props.get("iconCategory").asInt() : null;
            Integer delaySeconds = props.path("delay").isNumber() ? props.get("delay").asInt() : null;
            String geometryType = geometry.path("type").asText(null);
            String geometryJson = geometry.isMissingNode() ? null : geometry.toString();
            String travelDirection = textOrNull(props, "travelDirection");
            Double closestMileMarker = doubleOrNull(props, "closestMileMarker");
            String mileMarkerMethod = textOrNull(props, "mileMarkerMethod");
            Double mileMarkerConfidence = doubleOrNull(props, "mileMarkerConfidence");
            Double distanceToCorridorMeters = doubleOrNull(props, "distanceToCorridorMeters");
            String locationLabel = textOrNull(props, "locationLabel");
            Double centroidLat = doubleOrNull(props, "centroidLat");
            Double centroidLon = doubleOrNull(props, "centroidLon");

            JsonNode roadNumbers = props.path("roadNumbers");
            if (roadNumbers.isArray() && !roadNumbers.isEmpty()) {
                for (JsonNode road : roadNumbers) {
                    out.add(newIncident(
                        sample,
                        road.asText(null),
                        iconCategory,
                        delaySeconds,
                        geometryType,
                        geometryJson,
                        travelDirection,
                        closestMileMarker,
                        mileMarkerMethod,
                        mileMarkerConfidence,
                        distanceToCorridorMeters,
                        locationLabel,
                        centroidLat,
                        centroidLon
                    ));
                }
            } else {
                out.add(newIncident(
                    sample,
                    null,
                    iconCategory,
                    delaySeconds,
                    geometryType,
                    geometryJson,
                    travelDirection,
                    closestMileMarker,
                    mileMarkerMethod,
                    mileMarkerConfidence,
                    distanceToCorridorMeters,
                    locationLabel,
                    centroidLat,
                    centroidLon
                ));
            }
        }

        if (!out.isEmpty()) {
            incidentRepo.saveAll(out);
            incidentsNormalizedCounter.increment(out.size());
        }
    }

    private static TrafficIncident newIncident(
        TrafficSample sample,
        String roadNumber,
        Integer iconCategory,
        Integer delaySeconds,
        String geometryType,
        String geometryJson,
        String travelDirection,
        Double closestMileMarker,
        String mileMarkerMethod,
        Double mileMarkerConfidence,
        Double distanceToCorridorMeters,
        String locationLabel,
        Double centroidLat,
        Double centroidLon
    ) {
        TrafficIncident incident = new TrafficIncident();
        incident.setSample(sample);
        incident.setCorridor(sample.getCorridor());
        incident.setRoadNumber(roadNumber);
        incident.setIconCategory(iconCategory);
        incident.setDelaySeconds(delaySeconds);
        incident.setGeometryType(geometryType);
        incident.setGeometryJson(geometryJson);
        incident.setTravelDirection(travelDirection);
        incident.setClosestMileMarker(closestMileMarker);
        incident.setMileMarkerMethod(mileMarkerMethod);
        incident.setMileMarkerConfidence(mileMarkerConfidence);
        incident.setDistanceToCorridorMeters(distanceToCorridorMeters);
        incident.setLocationLabel(locationLabel);
        incident.setCentroidLat(centroidLat);
        incident.setCentroidLon(centroidLon);
        incident.setPolledAt(sample.getPolledAt());
        return incident;
    }

    private static String textOrNull(JsonNode node, String fieldName) {
        JsonNode field = node.path(fieldName);
        return field.isMissingNode() || field.isNull() ? null : field.asText(null);
    }

    private static Double doubleOrNull(JsonNode node, String fieldName) {
        JsonNode field = node.path(fieldName);
        return field.isNumber() ? field.asDouble() : null;
    }
}
