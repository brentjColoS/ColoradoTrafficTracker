package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IncidentEventWriter {

    private static final Logger log = LoggerFactory.getLogger(IncidentEventWriter.class);

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public IncidentEventWriter(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public void publish(Map<String, CorridorIncidentSnapshot> snapshots) {
        if (snapshots == null || snapshots.isEmpty()) return;

        Map<SourceKey, Instant> refreshes = new LinkedHashMap<>();
        for (CorridorIncidentSnapshot snapshot : snapshots.values()) {
            SourceKey source = new SourceKey(
                normalize(snapshot.provider()),
                normalize(snapshot.product())
            );
            refreshes.merge(source, snapshot.fetchedAt(), IncidentEventWriter::later);
            publishCorridorSnapshot(snapshot, source);
        }

        for (Map.Entry<SourceKey, Instant> refresh : refreshes.entrySet()) {
            markMissingEventsInactive(refresh.getKey(), refresh.getValue());
        }
    }

    private void publishCorridorSnapshot(
        CorridorIncidentSnapshot snapshot,
        SourceKey source
    ) {
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
            Instant observedAt = snapshot.fetchedAt();
            Instant sourceUpdatedAt = instant(properties, "sourceUpdatedAt", "lastUpdated");
            String sourceStatus = text(properties, "sourceStatus", "status");
            String normalizedStatus = firstNonBlank(
                text(properties, "normalizedStatus"),
                "active"
            );
            String sourceCategory = text(properties, "sourceCategory", "category");
            String normalizedCategory = text(properties, "normalizedCategory");
            String description = text(properties, "description", "incidentDescription");
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
                geometryJson,
                sourceStartedAt,
                sourceEndedAt,
                sourceUpdatedAt
            );
            EventState previousEvent = findEventState(source, providerEventId);

            Long eventId = upsertEvent(
                source,
                providerEventId,
                sourceStatus,
                normalizedStatus,
                sourceCategory,
                normalizedCategory,
                description,
                geometryType,
                geometryJson,
                sourceStartedAt,
                sourceEndedAt,
                sourceUpdatedAt,
                observedAt,
                payloadHash,
                rawEventJson
            );
            if (eventId == null) {
                throw new IllegalStateException(
                    "Incident event upsert did not return an id for " + providerEventId
                );
            }

            insertEventTransition(
                eventId,
                eventTransition(previousEvent, payloadHash),
                previousEvent == null ? null : previousEvent.payloadHash(),
                observedAt,
                sourceUpdatedAt,
                payloadHash,
                sourceStatus,
                normalizedStatus,
                rawEventJson
            );

            CorridorMatch corridorMatch = corridorMatch(properties);
            CorridorState previousCorridor = findCorridorState(eventId, snapshot.corridor());
            upsertCorridorMatch(
                eventId,
                snapshot.corridor(),
                corridorMatch,
                observedAt
            );
            insertCorridorTransition(
                eventId,
                snapshot.corridor(),
                corridorTransition(previousCorridor, corridorMatch.matchHash()),
                observedAt,
                corridorMatch
            );
            insertObservation(
                eventId,
                observedAt,
                sourceUpdatedAt,
                payloadHash,
                sourceStatus,
                normalizedStatus,
                rawEventJson
            );
        }
    }

    private EventState findEventState(SourceKey source, String providerEventId) {
        java.util.List<Map<String, Object>> rows = jdbcTemplate.queryForList(
            """
                select active, latest_payload_hash
                from traffic_incident_event
                where provider = ?
                  and provider_event_id = ?
                for update
                """,
            source.provider(),
            providerEventId
        );
        if (rows == null || rows.isEmpty()) return null;
        Map<String, Object> row = rows.get(0);
        return new EventState(
            Boolean.TRUE.equals(row.get("active")),
            (String) row.get("latest_payload_hash")
        );
    }

    private CorridorState findCorridorState(long eventId, String corridor) {
        java.util.List<Map<String, Object>> rows = jdbcTemplate.queryForList(
            """
                select active, latest_match_hash
                from traffic_incident_event_corridor
                where event_id = ?
                  and corridor = ?
                for update
                """,
            eventId,
            corridor
        );
        if (rows == null || rows.isEmpty()) return null;
        Map<String, Object> row = rows.get(0);
        return new CorridorState(
            Boolean.TRUE.equals(row.get("active")),
            (String) row.get("latest_match_hash")
        );
    }

    private Long upsertEvent(
        SourceKey source,
        String providerEventId,
        String sourceStatus,
        String normalizedStatus,
        String sourceCategory,
        String normalizedCategory,
        String description,
        String geometryType,
        String geometryJson,
        Instant sourceStartedAt,
        Instant sourceEndedAt,
        Instant sourceUpdatedAt,
        Instant observedAt,
        String payloadHash,
        String rawEventJson
    ) {
        return jdbcTemplate.queryForObject(
            """
                insert into traffic_incident_event (
                    provider,
                    product,
                    provider_event_id,
                    source_status,
                    normalized_status,
                    source_category,
                    normalized_category,
                    incident_description,
                    geometry_type,
                    geometry_json,
                    source_started_at,
                    source_ended_at,
                    source_updated_at,
                    first_seen_at,
                    last_seen_at,
                    active,
                    latest_payload_hash,
                    raw_event_json,
                    updated_at
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, now())
                on conflict (provider, provider_event_id) do update
                set product = excluded.product,
                    source_status = excluded.source_status,
                    normalized_status = excluded.normalized_status,
                    source_category = excluded.source_category,
                    normalized_category = excluded.normalized_category,
                    incident_description = excluded.incident_description,
                    geometry_type = excluded.geometry_type,
                    geometry_json = excluded.geometry_json,
                    source_started_at = excluded.source_started_at,
                    source_ended_at = excluded.source_ended_at,
                    source_updated_at = excluded.source_updated_at,
                    last_seen_at = excluded.last_seen_at,
                    active = true,
                    latest_payload_hash = excluded.latest_payload_hash,
                    raw_event_json = excluded.raw_event_json,
                    updated_at = now()
                returning id
                """,
            Long.class,
            source.provider(),
            source.product(),
            providerEventId,
            sourceStatus,
            normalizedStatus,
            sourceCategory,
            normalizedCategory,
            description,
            geometryType,
            geometryJson,
            sqlTimestamp(sourceStartedAt),
            sqlTimestamp(sourceEndedAt),
            sqlTimestamp(sourceUpdatedAt),
            sqlTimestamp(observedAt),
            sqlTimestamp(observedAt),
            payloadHash,
            rawEventJson
        );
    }

    private void upsertCorridorMatch(
        long eventId,
        String corridor,
        CorridorMatch match,
        Instant observedAt
    ) {
        jdbcTemplate.update(
            """
                insert into traffic_incident_event_corridor (
                    event_id,
                    corridor,
                    road_number,
                    travel_direction,
                    closest_mile_marker,
                    mile_marker_method,
                    mile_marker_confidence,
                    distance_to_corridor_meters,
                    location_label,
                    centroid_lat,
                    centroid_lon,
                    latest_match_hash,
                    first_matched_at,
                    last_matched_at,
                    active
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)
                on conflict (event_id, corridor) do update
                set road_number = excluded.road_number,
                    travel_direction = excluded.travel_direction,
                    closest_mile_marker = excluded.closest_mile_marker,
                    mile_marker_method = excluded.mile_marker_method,
                    mile_marker_confidence = excluded.mile_marker_confidence,
                    distance_to_corridor_meters = excluded.distance_to_corridor_meters,
                    location_label = excluded.location_label,
                    centroid_lat = excluded.centroid_lat,
                    centroid_lon = excluded.centroid_lon,
                    latest_match_hash = excluded.latest_match_hash,
                    last_matched_at = excluded.last_matched_at,
                    active = true
                """,
            eventId,
            corridor,
            match.roadNumber(),
            match.travelDirection(),
            match.closestMileMarker(),
            match.mileMarkerMethod(),
            match.mileMarkerConfidence(),
            match.distanceToCorridorMeters(),
            match.locationLabel(),
            match.centroidLat(),
            match.centroidLon(),
            match.matchHash(),
            sqlTimestamp(observedAt),
            sqlTimestamp(observedAt)
        );
    }

    private void insertEventTransition(
        long eventId,
        String transitionType,
        String previousPayloadHash,
        Instant occurredAt,
        Instant sourceUpdatedAt,
        String payloadHash,
        String sourceStatus,
        String normalizedStatus,
        String rawEventJson
    ) {
        if (transitionType == null) return;
        jdbcTemplate.update(
            """
                insert into traffic_incident_event_transition (
                    event_id,
                    occurred_at,
                    transition_type,
                    active,
                    previous_payload_hash,
                    payload_hash,
                    source_updated_at,
                    source_status,
                    normalized_status,
                    raw_event_json
                )
                values (?, ?, ?, true, ?, ?, ?, ?, ?, ?)
                on conflict (event_id, occurred_at, transition_type) do nothing
                """,
            eventId,
            sqlTimestamp(occurredAt),
            transitionType,
            previousPayloadHash,
            payloadHash,
            sqlTimestamp(sourceUpdatedAt),
            sourceStatus,
            normalizedStatus,
            rawEventJson
        );
    }

    private void insertCorridorTransition(
        long eventId,
        String corridor,
        String transitionType,
        Instant occurredAt,
        CorridorMatch match
    ) {
        if (transitionType == null) return;
        jdbcTemplate.update(
            """
                insert into traffic_incident_event_corridor_transition (
                    event_id,
                    corridor,
                    occurred_at,
                    transition_type,
                    active,
                    match_hash,
                    road_number,
                    travel_direction,
                    closest_mile_marker,
                    mile_marker_method,
                    mile_marker_confidence,
                    distance_to_corridor_meters,
                    location_label,
                    centroid_lat,
                    centroid_lon
                )
                values (?, ?, ?, ?, true, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (event_id, corridor, occurred_at, transition_type) do nothing
                """,
            eventId,
            corridor,
            sqlTimestamp(occurredAt),
            transitionType,
            match.matchHash(),
            match.roadNumber(),
            match.travelDirection(),
            match.closestMileMarker(),
            match.mileMarkerMethod(),
            match.mileMarkerConfidence(),
            match.distanceToCorridorMeters(),
            match.locationLabel(),
            match.centroidLat(),
            match.centroidLon()
        );
    }

    private void insertObservation(
        long eventId,
        Instant observedAt,
        Instant sourceUpdatedAt,
        String payloadHash,
        String sourceStatus,
        String normalizedStatus,
        String rawEventJson
    ) {
        jdbcTemplate.update(
            """
                insert into traffic_incident_event_observation (
                    event_id,
                    observed_at,
                    source_updated_at,
                    payload_hash,
                    source_status,
                    normalized_status,
                    raw_event_json
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict (event_id, payload_hash) do nothing
                """,
            eventId,
            sqlTimestamp(observedAt),
            sqlTimestamp(sourceUpdatedAt),
            payloadHash,
            sourceStatus,
            normalizedStatus,
            rawEventJson
        );
    }

    private void markMissingEventsInactive(SourceKey source, Instant refreshedAt) {
        jdbcTemplate.update(
            """
                with unmatched as (
                    update traffic_incident_event_corridor c
                    set active = false
                    from traffic_incident_event e
                    where c.event_id = e.id
                      and e.provider = ?
                      and e.product = ?
                      and c.active = true
                      and c.last_matched_at < ?
                    returning
                        c.event_id,
                        c.corridor,
                        c.latest_match_hash,
                        c.road_number,
                        c.travel_direction,
                        c.closest_mile_marker,
                        c.mile_marker_method,
                        c.mile_marker_confidence,
                        c.distance_to_corridor_meters,
                        c.location_label,
                        c.centroid_lat,
                        c.centroid_lon
                )
                insert into traffic_incident_event_corridor_transition (
                    event_id,
                    corridor,
                    occurred_at,
                    transition_type,
                    active,
                    match_hash,
                    road_number,
                    travel_direction,
                    closest_mile_marker,
                    mile_marker_method,
                    mile_marker_confidence,
                    distance_to_corridor_meters,
                    location_label,
                    centroid_lat,
                    centroid_lon
                )
                select
                    event_id,
                    corridor,
                    ?,
                    'UNMATCHED',
                    false,
                    latest_match_hash,
                    road_number,
                    travel_direction,
                    closest_mile_marker,
                    mile_marker_method,
                    mile_marker_confidence,
                    distance_to_corridor_meters,
                    location_label,
                    centroid_lat,
                    centroid_lon
                from unmatched
                on conflict (event_id, corridor, occurred_at, transition_type) do nothing
                """,
            source.provider(),
            source.product(),
            sqlTimestamp(refreshedAt),
            sqlTimestamp(refreshedAt)
        );
        jdbcTemplate.update(
            """
                with inactive as (
                    update traffic_incident_event
                    set active = false,
                        updated_at = now()
                    where provider = ?
                      and product = ?
                      and active = true
                      and last_seen_at < ?
                    returning
                        id,
                        latest_payload_hash,
                        source_updated_at,
                        source_status,
                        normalized_status,
                        raw_event_json
                )
                insert into traffic_incident_event_transition (
                    event_id,
                    occurred_at,
                    transition_type,
                    active,
                    previous_payload_hash,
                    payload_hash,
                    source_updated_at,
                    source_status,
                    normalized_status,
                    raw_event_json
                )
                select
                    id,
                    ?,
                    'INACTIVE',
                    false,
                    latest_payload_hash,
                    latest_payload_hash,
                    source_updated_at,
                    source_status,
                    normalized_status,
                    raw_event_json
                from inactive
                on conflict (event_id, occurred_at, transition_type) do nothing
                """,
            source.provider(),
            source.product(),
            sqlTimestamp(refreshedAt),
            sqlTimestamp(refreshedAt)
        );
    }

    private static OffsetDateTime sqlTimestamp(Instant value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
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

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) return value.trim();
        }
        return null;
    }

    private static String normalize(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private static Instant later(Instant left, Instant right) {
        return left.isAfter(right) ? left : right;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static String eventPayloadHash(Object... values) {
        StringBuilder canonical = new StringBuilder();
        for (Object value : values) {
            if (!canonical.isEmpty()) canonical.append('\u001f');
            canonical.append(value == null ? "" : value);
        }
        return sha256(canonical.toString());
    }

    private static String eventTransition(EventState previous, String payloadHash) {
        if (previous == null) return "FIRST_SEEN";
        if (!previous.active()) return "REACTIVATED";
        if (!payloadHash.equals(previous.payloadHash())) return "PAYLOAD_CHANGED";
        return null;
    }

    private static String corridorTransition(CorridorState previous, String matchHash) {
        if (previous == null) return "FIRST_MATCHED";
        if (!previous.active()) return "REMATCHED";
        if (
            previous.matchHash() != null
                && !matchHash.equals(previous.matchHash())
        ) {
            return "MATCH_CHANGED";
        }
        return null;
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

    private record SourceKey(String provider, String product) {}
    private record EventState(boolean active, String payloadHash) {}
    private record CorridorState(boolean active, String matchHash) {}
    private record CorridorMatch(
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
