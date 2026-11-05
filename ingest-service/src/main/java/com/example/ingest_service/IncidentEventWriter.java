package com.example.ingest_service;

import static com.example.ingest_service.IncidentEventNormalizer.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IncidentEventWriter {

    private final JdbcTemplate jdbcTemplate;
    private final IncidentEventNormalizer normalizer;

    public IncidentEventWriter(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.normalizer = new IncidentEventNormalizer(objectMapper);
    }

    @Transactional
    public void publish(Map<String, CorridorIncidentSnapshot> snapshots) {
        if (snapshots == null || snapshots.isEmpty()) return;

        Map<SourceKey, Instant> refreshes = new LinkedHashMap<>();
        for (CorridorIncidentSnapshot snapshot : snapshots.values()) {
            SourceKey source = IncidentEventNormalizer.source(snapshot);
            refreshes.merge(source, snapshot.fetchedAt(), IncidentEventWriter::later);
            publishCorridorSnapshot(snapshot, source);
        }

        for (Map.Entry<SourceKey, Instant> refresh : refreshes.entrySet()) {
            markMissingEventsInactive(refresh.getKey(), refresh.getValue());
        }
    }

    private void publishCorridorSnapshot(CorridorIncidentSnapshot snapshot, SourceKey source) {
        for (Event event : normalizer.normalize(snapshot, source)) {
            Instant observedAt = snapshot.fetchedAt();
            EventState previousEvent = findEventState(source, event.providerEventId());
            Long eventId = upsertEvent(source, event, observedAt);
            if (eventId == null) {
                throw new IllegalStateException("Incident event upsert did not return an id for " + event.providerEventId());
            }
            insertEventTransition(eventId, eventTransition(previousEvent, event.payloadHash()),
                previousEvent == null ? null : previousEvent.payloadHash(), observedAt,
                event.sourceUpdatedAt(), event.payloadHash(), event.sourceStatus(), event.normalizedStatus(), event.rawEventJson());
            CorridorMatch match = event.corridorMatch();
            CorridorState previousCorridor = findCorridorState(eventId, snapshot.corridor());
            upsertCorridorMatch(eventId, snapshot.corridor(), match, observedAt);
            insertCorridorTransition(eventId, snapshot.corridor(),
                corridorTransition(previousCorridor, match.matchHash()), observedAt, match);
            insertObservation(eventId, observedAt, event.sourceUpdatedAt(), event.payloadHash(),
                event.sourceStatus(), event.normalizedStatus(), event.rawEventJson());
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

    private Long upsertEvent(SourceKey source, Event event, Instant observedAt) {
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
                    delay_seconds,
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
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, ?, ?, now())
                on conflict (provider, provider_event_id) do update
                set product = excluded.product,
                    source_status = excluded.source_status,
                    normalized_status = excluded.normalized_status,
                    source_category = excluded.source_category,
                    normalized_category = excluded.normalized_category,
                    incident_description = excluded.incident_description,
                    delay_seconds = excluded.delay_seconds,
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
            event.providerEventId(),
            event.sourceStatus(),
            event.normalizedStatus(),
            event.sourceCategory(),
            event.normalizedCategory(),
            event.description(),
            event.delaySeconds(),
            event.geometryType(),
            event.geometryJson(),
            sqlTimestamp(event.sourceStartedAt()),
            sqlTimestamp(event.sourceEndedAt()),
            sqlTimestamp(event.sourceUpdatedAt()),
            sqlTimestamp(observedAt),
            sqlTimestamp(observedAt),
            event.payloadHash(),
            event.rawEventJson()
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

    private static Instant later(Instant left, Instant right) {
        return left.isAfter(right) ? left : right;
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

    private record EventState(boolean active, String payloadHash) {}
    private record CorridorState(boolean active, String matchHash) {}

}
