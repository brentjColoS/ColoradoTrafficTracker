package com.example.ingest_service;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class IncidentEventNormalizerTest {
    private final IncidentEventNormalizer normalizer = new IncidentEventNormalizer(new ObjectMapper());

    @Test
    void preservesAliasesCoercionAndUtcTimesWithoutInventingMissingValues() {
        var snapshot = snapshot("""
            {"incidents":[{"properties":{
              "id":42,"status":" report ","category":" Crash ","incidentDescription":" lane blocked ",
              "delay":"invalid","delaySeconds":"87.9","startTime":"2026-11-01T01:00+01:00",
              "clearTime":"invalid","lastUpdated":"2026-11-01T00:30:00Z",
              "route":" I-25 ","direction":" south ","marker":"235.4"
            }}]}
            """);
        var source = IncidentEventNormalizer.source(snapshot);
        assertThat(source.provider()).isEqualTo("cdot");
        assertThat(source.product()).isEqualTo("incidents");
        var events = normalizer.normalize(snapshot, source);
        assertThat(events).hasSize(1);
        var event = events.get(0);
        assertThat(event.providerEventId()).isEqualTo("42");
        assertThat(event.sourceStatus()).isEqualTo("report");
        assertThat(event.normalizedStatus()).isEqualTo("active");
        assertThat(event.sourceCategory()).isEqualTo("Crash");
        assertThat(event.normalizedCategory()).isNull();
        assertThat(event.description()).isEqualTo("lane blocked");
        assertThat(event.delaySeconds()).isEqualTo(87);
        assertThat(event.sourceStartedAt()).isEqualTo(Instant.parse("2026-11-01T00:00:00Z"));
        assertThat(event.sourceEndedAt()).isNull();
        assertThat(event.sourceUpdatedAt()).isEqualTo(Instant.parse("2026-11-01T00:30:00Z"));
        assertThat(event.geometryType()).isNull();
        assertThat(event.geometryJson()).isNull();
        assertThat(event.corridorMatch().roadNumber()).isEqualTo("I-25");
        assertThat(event.corridorMatch().travelDirection()).isEqualTo("south");
        assertThat(event.corridorMatch().closestMileMarker()).isEqualTo(235.4);
        assertThat(event.corridorMatch().mileMarkerConfidence()).isNull();
    }

    @Test
    void canonicalFieldsTakePrecedenceAndKeepAllCorridorEvidence() {
        var event = normalize("""
            {"incidents":[{"properties":{
              "providerEventId":" primary ","id":"fallback","sourceStatus":"canonical","status":"fallback",
              "normalizedStatus":"inactive","sourceCategory":"Work","normalizedCategory":"construction",
              "description":"canonical","incidentDescription":"fallback","delay":12,"delaySeconds":99,
              "sourceStartedAt":"2026-11-01T00:00:00Z","sourceEndedAt":"2026-11-01T00:10:00Z",
              "sourceUpdatedAt":"2026-11-01T00:05:00Z","lastUpdated":"2000-01-01T00:00:00Z",
              "roadNumbers":["I-70","I-25"],"roadNumber":"fallback","travelDirection":"west",
              "closestMileMarker":210,"mileMarkerMethod":"source","mileMarkerConfidence":0.9,
              "distanceToCorridorMeters":12.5,"locationLabel":"Tunnel","centroidLat":39.7,"centroidLon":-105
            },"geometry":{"type":"Point","coordinates":[-105,39.7]}}]}
            """);
        assertThat(event.providerEventId()).isEqualTo("primary");
        assertThat(event.sourceStatus()).isEqualTo("canonical");
        assertThat(event.normalizedStatus()).isEqualTo("inactive");
        assertThat(event.normalizedCategory()).isEqualTo("construction");
        assertThat(event.description()).isEqualTo("canonical");
        assertThat(event.delaySeconds()).isEqualTo(12);
        assertThat(event.sourceUpdatedAt()).isEqualTo(Instant.parse("2026-11-01T00:05:00Z"));
        assertThat(event.geometryType()).isEqualTo("Point");
        assertThat(event.geometryJson()).isEqualTo("{\"type\":\"Point\",\"coordinates\":[-105,39.7]}");
        var match = event.corridorMatch();
        assertThat(match.roadNumber()).isEqualTo("I-70");
        assertThat(match.travelDirection()).isEqualTo("west");
        assertThat(match.closestMileMarker()).isEqualTo(210.0);
        assertThat(match.mileMarkerMethod()).isEqualTo("source");
        assertThat(match.mileMarkerConfidence()).isEqualTo(0.9);
        assertThat(match.distanceToCorridorMeters()).isEqualTo(12.5);
        assertThat(match.locationLabel()).isEqualTo("Tunnel");
        assertThat(match.centroidLat()).isEqualTo(39.7);
        assertThat(match.centroidLon()).isEqualTo(-105.0);
    }

    @Test
    void payloadIdentityExcludesCorridorMatchAndUnmappedFields() {
        String json = "{\"incidents\":[{\"properties\":{\"id\":\"event\",\"description\":\"blocked\",\"marker\":210}}]}";
        var original = normalize(json);
        assertThat(original.payloadHash()).isEqualTo("650c5e6e8f564e2ecf7d99634015acbcd6e029c152180dc340b96b8228526e7c");
        var otherMatch = normalize(json.replace("210", "211"));
        assertThat(otherMatch.payloadHash()).isEqualTo(original.payloadHash());
        assertThat(otherMatch.corridorMatch().matchHash()).isNotEqualTo(original.corridorMatch().matchHash());
        assertThat(normalize(json.replace("blocked", "clear")).payloadHash()).isNotEqualTo(original.payloadHash());
        assertThat(normalize(json.replace("\"event\"", "\"other-id\"")).payloadHash()).isEqualTo(original.payloadHash());
        assertThat(original.rawEventJson()).contains("\"marker\":210");
    }

    @Test
    void rejectsInvalidSnapshotShapesAndSkipsEventsWithoutStableIds() {
        for (String json : new String[]{"{invalid", "{}", "{\"incidents\":{}}"}) {
            var snapshot = snapshot(json);
            assertThatThrownBy(() -> normalizer.normalize(snapshot, IncidentEventNormalizer.source(snapshot)))
                .isInstanceOf(IllegalArgumentException.class);
        }
        var snapshot = snapshot("{\"incidents\":[{}, {\"properties\":{\"id\":\"  \"}}]}");
        assertThat(normalizer.normalize(snapshot, IncidentEventNormalizer.source(snapshot))).isEmpty();
    }

    private IncidentEventNormalizer.Event normalize(String json) {
        var snapshot = snapshot(json);
        return normalizer.normalize(snapshot, IncidentEventNormalizer.source(snapshot)).get(0);
    }

    private static CorridorIncidentSnapshot snapshot(String json) {
        return new CorridorIncidentSnapshot("I25", " CDOT ", " Incidents ",
            Instant.parse("2026-11-01T01:00:00Z"), null, json, 1);
    }
}
