package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class CdotIncidentMapper {

    static final String PRODUCT = "incidents-and-planned-events";

    private final Clock clock;

    public CdotIncidentMapper() {
        this(Clock.systemUTC());
    }

    CdotIncidentMapper(Clock clock) {
        this.clock = clock;
    }

    public Map<String, CorridorIncidentSnapshot> map(
        CdotIncidentClient.Feeds feeds,
        List<TrafficProps.Corridor> corridors
    ) {
        if (feeds == null) throw new IllegalArgumentException("CDOT feeds must not be null");
        if (corridors == null || corridors.isEmpty()) return Map.of();

        Instant fetchedAt = Instant.now(clock);
        Instant sourceUpdatedAt = latestSourceUpdate(feeds);
        Map<String, CorridorIncidentSnapshot> snapshots = new LinkedHashMap<>();

        for (TrafficProps.Corridor corridor : corridors) {
            Map<String, ObjectNode> incidentsById = new LinkedHashMap<>();
            mapFeed(feeds.incidents(), false, corridor, incidentsById);
            mapFeed(feeds.plannedEvents(), true, corridor, incidentsById);

            ArrayNode incidents = JsonNodeFactory.instance.arrayNode();
            incidentsById.values().forEach(incidents::add);
            ObjectNode wrapped = JsonNodeFactory.instance.objectNode();
            wrapped.set("incidents", incidents);

            snapshots.put(
                corridor.name(),
                new CorridorIncidentSnapshot(
                    corridor.name(),
                    "cdot",
                    PRODUCT,
                    fetchedAt,
                    sourceUpdatedAt,
                    wrapped.toString(),
                    incidents.size()
                )
            );
        }
        return Map.copyOf(snapshots);
    }

    private void mapFeed(
        JsonNode feed,
        boolean planned,
        TrafficProps.Corridor corridor,
        Map<String, ObjectNode> incidentsById
    ) {
        validateFeatureCollection(feed, planned ? "plannedEvents" : "incidents");
        for (JsonNode feature : feed.path("features")) {
            JsonNode properties = feature.path("properties");
            String providerEventId = text(properties, "id");
            if (providerEventId == null) continue;

            String routeName = text(properties, "routeName");
            boolean routeMatch = matchesRoute(routeName, corridor);
            if (routeName != null && !routeMatch) continue;

            ObjectNode mapped = mapFeature(feature, planned, corridor);
            if (mapped == null) continue;
            List<double[]> corridorPolyline = CorridorGeometrySupport.pointsFromGeoJson(corridor.geometryJson());
            ObjectNode enriched = IncidentLocationEnricher.enrichIncident(
                mapped,
                corridor,
                corridorPolyline
            );

            String direction = sourceDirection(properties);
            if (direction != null) {
                enriched.withObject("/properties").put("travelDirection", direction);
            }
            if (!routeMatch && !isNearCorridor(enriched, corridor)) continue;

            incidentsById.put(providerEventId, enriched);
        }
    }

    private ObjectNode mapFeature(
        JsonNode feature,
        boolean planned,
        TrafficProps.Corridor corridor
    ) {
        JsonNode sourceProperties = feature.path("properties");
        ObjectNode geometry = normalizeGeometry(feature.path("geometry"));
        if (geometry == null && text(sourceProperties, "routeName") == null) return null;

        ObjectNode mapped = JsonNodeFactory.instance.objectNode();
        ObjectNode properties = JsonNodeFactory.instance.objectNode();

        String providerEventId = text(sourceProperties, "id");
        String sourceStatus = firstNonBlank(
            text(sourceProperties, "status"),
            planned ? "planned" : "active"
        );
        String category = text(sourceProperties, "category");

        properties.put("providerEventId", providerEventId);
        properties.put("sourceStatus", sourceStatus);
        properties.put("normalizedStatus", normalizeStatus(sourceStatus, sourceProperties, planned));
        putIfPresent(properties, "sourceCategory", category);
        putIfPresent(properties, "normalizedCategory", normalizeCategory(category, text(sourceProperties, "type")));
        putIfPresent(
            properties,
            "description",
            firstNonBlank(
                text(sourceProperties, "travelerInformationMessage"),
                text(sourceProperties, "name"),
                text(sourceProperties, "type")
            )
        );
        putIfPresent(properties, "sourceUpdatedAt", text(sourceProperties, "lastUpdated"));
        putIfPresent(properties, "sourceStartedAt", text(sourceProperties, "startTime"));
        putIfPresent(properties, "sourceEndedAt", text(sourceProperties, "clearTime"));
        putIfPresent(properties, "sourceType", text(sourceProperties, "type"));
        putIfPresent(properties, "sourceSeverity", text(sourceProperties, "severity"));
        putNumberIfPresent(properties, "sourceStartMarker", number(sourceProperties, "startMarker", "marker"));
        putNumberIfPresent(properties, "sourceEndMarker", number(sourceProperties, "endMarker", "marker"));

        ArrayNode roadNumbers = JsonNodeFactory.instance.arrayNode();
        roadNumbers.add(firstNonBlank(text(sourceProperties, "routeName"), corridor.roadNumber(), corridor.name()));
        properties.set("roadNumbers", roadNumbers);

        String direction = sourceDirection(sourceProperties);
        putIfPresent(properties, "travelDirection", direction);
        if (sourceProperties.path("laneImpacts").isArray()) {
            properties.set("laneImpacts", sourceProperties.path("laneImpacts").deepCopy());
        }
        if (sourceProperties.path("additionalImpacts").isArray()) {
            properties.set("additionalImpacts", sourceProperties.path("additionalImpacts").deepCopy());
        }

        mapped.put("type", "Feature");
        mapped.set("properties", properties);
        if (geometry != null) mapped.set("geometry", geometry);
        return mapped;
    }

    private static ObjectNode normalizeGeometry(JsonNode source) {
        if (source == null || !source.isObject()) return null;
        String type = text(source, "type");
        JsonNode coordinates = source.path("coordinates");
        if (type == null || !coordinates.isArray() || coordinates.isEmpty()) return null;

        ObjectNode geometry = JsonNodeFactory.instance.objectNode();
        switch (type) {
            case "Point" -> {
                if (!isCoordinate(coordinates)) return null;
                geometry.put("type", "Point");
                geometry.set("coordinates", coordinates.deepCopy());
            }
            case "MultiPoint" -> {
                if (coordinates.size() == 1 && isCoordinate(coordinates.get(0))) {
                    geometry.put("type", "Point");
                    geometry.set("coordinates", coordinates.get(0).deepCopy());
                } else {
                    geometry.put("type", "LineString");
                    geometry.set("coordinates", coordinates.deepCopy());
                }
            }
            case "LineString", "MultiLineString" -> {
                geometry.put("type", type);
                geometry.set("coordinates", coordinates.deepCopy());
            }
            default -> {
                return null;
            }
        }
        return geometry;
    }

    private static boolean isCoordinate(JsonNode value) {
        return value != null
            && value.isArray()
            && value.size() >= 2
            && value.get(0).isNumber()
            && value.get(1).isNumber();
    }

    private static boolean isNearCorridor(ObjectNode incident, TrafficProps.Corridor corridor) {
        JsonNode distance = incident.path("properties").path("distanceToCorridorMeters");
        if (!distance.isNumber()) return false;
        double maxDistance = corridor.maxSnapDistanceMeters() == null || corridor.maxSnapDistanceMeters() <= 0
            ? 400.0
            : corridor.maxSnapDistanceMeters();
        return distance.asDouble() <= maxDistance;
    }

    private static boolean matchesRoute(String routeName, TrafficProps.Corridor corridor) {
        if (routeName == null || routeName.isBlank()) return false;
        String source = alphaNumeric(routeName);
        for (String candidate : List.of(
            firstNonBlank(corridor.roadNumber(), ""),
            firstNonBlank(corridor.name(), "")
        )) {
            String normalizedCandidate = alphaNumeric(candidate);
            if (normalizedCandidate.isBlank()) continue;
            if (source.equals(normalizedCandidate)) return true;
            if (source.length() == normalizedCandidate.length() + 1
                && source.startsWith(normalizedCandidate)
                && "NSEW".indexOf(source.charAt(source.length() - 1)) >= 0) {
                return true;
            }
        }
        return false;
    }

    private static String alphaNumeric(String value) {
        return value == null
            ? ""
            : value.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    }

    private String normalizeStatus(String sourceStatus, JsonNode properties, boolean planned) {
        String normalized = sourceStatus == null ? "" : sourceStatus.toLowerCase(Locale.ROOT);
        if (normalized.contains("clear") || normalized.contains("cancel")) return "cleared";

        Instant clearTime = instant(properties, "clearTime");
        if (clearTime != null && clearTime.isBefore(Instant.now(clock))) return "cleared";

        Instant startTime = instant(properties, "startTime");
        if (planned && startTime != null && startTime.isAfter(Instant.now(clock))) return "planned";
        return "active";
    }

    private static String normalizeCategory(String category, String type) {
        String value = firstNonBlank(category, type, "other").toLowerCase(Locale.ROOT);
        if (value.contains("crash")) return "crash";
        if (value.contains("construct") || value.contains("maintenance")) return "construction";
        if (value.contains("weather")) return "weather";
        if (value.contains("closure")) return "closure";
        if (value.contains("traffic")) return "traffic";
        return value.replaceAll("[^a-z0-9]+", "_").replaceAll("^_|_$", "");
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return switch (direction.trim().toLowerCase(Locale.ROOT)) {
            case "north", "northbound", "n" -> "N";
            case "south", "southbound", "s" -> "S";
            case "east", "eastbound", "e" -> "E";
            case "west", "westbound", "w" -> "W";
            default -> direction.trim().toUpperCase(Locale.ROOT);
        };
    }

    private static String sourceDirection(JsonNode properties) {
        String explicit = normalizeDirection(text(properties, "direction"));
        if (explicit != null) return explicit;

        String routeName = alphaNumeric(text(properties, "routeName"));
        if (!routeName.isBlank()) {
            char suffix = routeName.charAt(routeName.length() - 1);
            if ("NSEW".indexOf(suffix) >= 0) return String.valueOf(suffix);
        }
        return null;
    }

    private static void validateFeatureCollection(JsonNode feed, String name) {
        if (feed == null || !"FeatureCollection".equals(feed.path("type").asText())) {
            throw new IllegalArgumentException("CDOT " + name + " response is not a GeoJSON FeatureCollection");
        }
        if (!feed.path("features").isArray()) {
            throw new IllegalArgumentException("CDOT " + name + " response does not contain a features array");
        }
    }

    private static Instant latestSourceUpdate(CdotIncidentClient.Feeds feeds) {
        Instant latest = null;
        for (JsonNode feed : new JsonNode[]{feeds.incidents(), feeds.plannedEvents()}) {
            validateFeatureCollection(feed, "feed");
            for (JsonNode feature : feed.path("features")) {
                Instant candidate = instant(feature.path("properties"), "lastUpdated");
                if (candidate != null && (latest == null || candidate.isAfter(latest))) {
                    latest = candidate;
                }
            }
        }
        return latest;
    }

    private static Instant instant(JsonNode node, String fieldName) {
        String value = text(node, fieldName);
        if (value == null) return null;
        try {
            return Instant.parse(value);
        } catch (Exception ignored) {
            try {
                return OffsetDateTime.parse(value).withOffsetSameInstant(ZoneOffset.UTC).toInstant();
            } catch (Exception ignoredAgain) {
                return null;
            }
        }
    }

    private static String text(JsonNode node, String fieldName) {
        JsonNode value = node.path(fieldName);
        return value.isTextual() && !value.asText().isBlank() ? value.asText().trim() : null;
    }

    private static Double number(JsonNode node, String... fieldNames) {
        for (String fieldName : fieldNames) {
            JsonNode value = node.path(fieldName);
            if (value.isNumber()) return value.asDouble();
        }
        return null;
    }

    private static void putIfPresent(ObjectNode target, String fieldName, String value) {
        if (value != null && !value.isBlank()) target.put(fieldName, value);
    }

    private static void putNumberIfPresent(ObjectNode target, String fieldName, Double value) {
        if (value != null) target.put(fieldName, value);
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) return value.trim();
        }
        return null;
    }
}
