package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.List;
import java.util.ArrayList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class IncidentEventNormalizer {
    private static final Logger log = LoggerFactory.getLogger(IncidentEventNormalizer.class);
    private final ObjectMapper objectMapper;

    IncidentEventNormalizer(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    static SourceKey source(CorridorIncidentSnapshot snapshot) {
        return new SourceKey(normalize(snapshot.provider()), normalize(snapshot.product()));
    }

    List<Event> normalize(CorridorIncidentSnapshot snapshot, SourceKey source) {
        JsonNode root;
        try {
            root = objectMapper.readTree(snapshot.incidentsJson());
        } catch (Exception e) {
            throw new IllegalArgumentException(
                "Unable to parse incident snapshot for " + snapshot.corridor(),
                e
            );
        }

        JsonNode incidents = root.path("incidents");
        if (!incidents.isArray()) {
            throw new IllegalArgumentException(
                "Incident snapshot for " + snapshot.corridor() + " does not contain an incidents array"
            );
        }

        List<Event> events = new ArrayList<>();
        for (JsonNode incident : incidents) {
            JsonNode properties = incident.path("properties");
            String providerEventId = text(properties, "providerEventId", "id");
            if (providerEventId == null) {
                log.warn(
                    "Skipping {} incident without a stable provider event id in corridor {}",
                    source.provider(),
                    snapshot.corridor()
                );
                continue;
            }

            String rawEventJson = incident.toString();
            Instant sourceUpdatedAt = instant(properties, "sourceUpdatedAt", "lastUpdated");
            String sourceStatus = text(properties, "sourceStatus", "status");
            String normalizedStatus = text(properties, "normalizedStatus");
            if (normalizedStatus == null) normalizedStatus = "active";
            String sourceCategory = text(properties, "sourceCategory", "category");
            String normalizedCategory = text(properties, "normalizedCategory");
            String description = text(properties, "description", "incidentDescription");
            Integer delaySeconds = integer(properties, "delay", "delaySeconds");
            JsonNode geometry = incident.path("geometry");
            String geometryType = text(geometry, "type");
            String geometryJson = geometry.isObject() ? geometry.toString() : null;
            Instant sourceStartedAt = instant(properties, "sourceStartedAt", "startTime");
            Instant sourceEndedAt = instant(properties, "sourceEndedAt", "clearTime");
            String payloadHash = eventPayloadHash(
                sourceStatus,
                normalizedStatus,
                sourceCategory,
                normalizedCategory,
                description,
                delaySeconds,
                geometryJson,
                sourceStartedAt,
                sourceEndedAt,
                sourceUpdatedAt
            );
            events.add(new Event(providerEventId, sourceStatus, normalizedStatus, sourceCategory,
                normalizedCategory, description, delaySeconds, geometryType, geometryJson,
                sourceStartedAt, sourceEndedAt, sourceUpdatedAt, payloadHash, rawEventJson,
                corridorMatch(properties)));
        }
        return List.copyOf(events);
    }

    private static String firstRoadNumber(JsonNode properties) {
        JsonNode roadNumbers = properties.path("roadNumbers");
        if (roadNumbers.isArray() && !roadNumbers.isEmpty()) {
            return roadNumbers.get(0).asText(null);
        }
        return text(properties, "roadNumber", "route");
    }

    private static String text(JsonNode node, String... fieldNames) {
        for (String fieldName : fieldNames) {
            JsonNode value = node.path(fieldName);
            if (value.isTextual() && !value.asText().isBlank()) {
                return value.asText().trim();
            }
            if (value.isNumber()) return value.asText();
        }
        return null;
    }

    private static Double number(JsonNode node, String... fieldNames) {
        for (String fieldName : fieldNames) {
            JsonNode value = node.path(fieldName);
            if (value.isNumber()) return value.asDouble();
            if (value.isTextual()) {
                try {
                    return Double.parseDouble(value.asText().trim());
                } catch (NumberFormatException ignored) {
                    // Try the next source field.
                }
            }
        }
        return null;
    }

    private static Integer integer(JsonNode node, String... fieldNames) {
        Double value = number(node, fieldNames);
        return value == null ? null : value.intValue();
    }

    private static Instant instant(JsonNode node, String... fieldNames) {
        String value = text(node, fieldNames);
        if (value == null) return null;
        try {
            return Instant.parse(value);
        } catch (Exception ignored) {
            try {
                return OffsetDateTime.parse(value).toInstant();
            } catch (Exception ignoredAgain) {
                return null;
            }
        }
    }

    private static String normalize(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private static String eventPayloadHash(Object... values) {
        StringBuilder canonical = new StringBuilder();
        for (Object value : values) {
            if (!canonical.isEmpty()) canonical.append('\u001f');
            canonical.append(value == null ? "" : value);
        }
        return TrafficSampleSignature.sha256(canonical.toString());
    }

    private static CorridorMatch corridorMatch(JsonNode properties) {
        String roadNumber = firstRoadNumber(properties);
        String travelDirection = text(properties, "travelDirection", "direction");
        Double closestMileMarker = number(properties, "closestMileMarker", "marker");
        String mileMarkerMethod = text(properties, "mileMarkerMethod");
        Double mileMarkerConfidence = number(properties, "mileMarkerConfidence");
        Double distanceToCorridorMeters = number(properties, "distanceToCorridorMeters");
        String locationLabel = text(properties, "locationLabel");
        Double centroidLat = number(properties, "centroidLat");
        Double centroidLon = number(properties, "centroidLon");
        return new CorridorMatch(
            roadNumber,
            travelDirection,
            closestMileMarker,
            mileMarkerMethod,
            mileMarkerConfidence,
            distanceToCorridorMeters,
            locationLabel,
            centroidLat,
            centroidLon,
            eventPayloadHash(
                roadNumber,
                travelDirection,
                closestMileMarker,
                mileMarkerMethod,
                mileMarkerConfidence,
                distanceToCorridorMeters,
                locationLabel,
                centroidLat,
                centroidLon
            )
        );
    }

    record SourceKey(String provider, String product) {}

    record Event(
        String providerEventId, String sourceStatus, String normalizedStatus,
        String sourceCategory, String normalizedCategory, String description,
        Integer delaySeconds, String geometryType, String geometryJson,
        Instant sourceStartedAt, Instant sourceEndedAt, Instant sourceUpdatedAt,
        String payloadHash, String rawEventJson, CorridorMatch corridorMatch
    ) {}

    record CorridorMatch(
        String roadNumber,
        String travelDirection,
        Double closestMileMarker,
        String mileMarkerMethod,
        Double mileMarkerConfidence,
        Double distanceToCorridorMeters,
        String locationLabel,
        Double centroidLat,
        Double centroidLon,
        String matchHash
    ) {}
}
