package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class CdotIncidentMapperTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final CdotIncidentMapper mapper = new CdotIncidentMapper(
        Clock.fixed(Instant.parse("2026-07-27T18:00:00Z"), ZoneOffset.UTC)
    );

    @Test
    void mapsCurrentAndPlannedFeedsIntoCompleteCorridorSnapshots() throws Exception {
        Map<String, CorridorIncidentSnapshot> snapshots = mapper.map(
            feeds(),
            List.of(i25(), i70())
        );

        assertThat(snapshots).containsOnlyKeys("I25", "I70");
        assertThat(snapshots.get("I25").provider()).isEqualTo("cdot");
        assertThat(snapshots.get("I25").product())
            .isEqualTo("incidents-and-planned-events");
        assertThat(snapshots.get("I25").fetchedAt())
            .isEqualTo(Instant.parse("2026-07-27T18:00:00Z"));
        assertThat(snapshots.get("I25").sourceUpdatedAt())
            .isEqualTo(Instant.parse("2026-07-27T17:58:00Z"));
        assertThat(snapshots.get("I25").incidentCount()).isEqualTo(3);
        assertThat(snapshots.get("I70").incidentCount()).isEqualTo(2);
    }

    @Test
    void preservesProviderIdentityAndNormalizesPointAndMultipointGeometry() throws Exception {
        Map<String, CorridorIncidentSnapshot> snapshots = mapper.map(
            feeds(),
            List.of(i25(), i70())
        );

        JsonNode i25Crash = incident(snapshots.get("I25"), "fixture-incident-i25-1");
        assertThat(i25Crash.path("geometry").path("type").asText()).isEqualTo("Point");
        assertThat(i25Crash.path("properties").path("normalizedCategory").asText())
            .isEqualTo("crash");
        assertThat(i25Crash.path("properties").path("normalizedStatus").asText())
            .isEqualTo("active");
        assertThat(i25Crash.path("properties").path("travelDirection").asText())
            .isEqualTo("S");
        assertThat(i25Crash.path("properties").path("laneImpacts")).hasSize(1);

        JsonNode i70Maintenance = incident(snapshots.get("I70"), "fixture-incident-i70-1");
        assertThat(i70Maintenance.path("geometry").path("type").asText())
            .isEqualTo("LineString");
        assertThat(i70Maintenance.path("properties").path("travelDirection").asText())
            .isEqualTo("W");
    }

    @Test
    void handlesFutureEventsAndMissingOptionalGeometryWithoutCrossRoadMatches() throws Exception {
        Map<String, CorridorIncidentSnapshot> snapshots = mapper.map(
            feeds(),
            List.of(i25(), i70())
        );

        JsonNode future = incident(snapshots.get("I25"), "fixture-event-i25-1");
        assertThat(future.path("properties").path("normalizedStatus").asText())
            .isEqualTo("planned");
        assertThat(future.path("properties").path("sourceStartMarker").asDouble())
            .isEqualTo(220.0);

        JsonNode missingGeometry = incident(
            snapshots.get("I25"),
            "fixture-event-i25-no-geometry"
        );
        assertThat(missingGeometry.path("geometry").isMissingNode()).isTrue();
        assertThat(missingGeometry.path("properties").path("travelDirection").asText())
            .isEqualTo("N");

        assertThat(allProviderIds(snapshots))
            .doesNotContain("fixture-incident-other-road");
    }

    private CdotIncidentClient.Feeds feeds() throws Exception {
        return new CdotIncidentClient.Feeds(
            fixture("/fixtures/cdot/incidents.json"),
            fixture("/fixtures/cdot/planned-events.json")
        );
    }

    private JsonNode fixture(String path) throws Exception {
        try (InputStream input = getClass().getResourceAsStream(path)) {
            if (input == null) throw new IllegalStateException("Missing fixture " + path);
            return objectMapper.readTree(input);
        }
    }

    private JsonNode incident(CorridorIncidentSnapshot snapshot, String providerId) throws Exception {
        for (JsonNode incident : objectMapper.readTree(snapshot.incidentsJson()).path("incidents")) {
            if (providerId.equals(incident.path("properties").path("providerEventId").asText())) {
                return incident;
            }
        }
        throw new AssertionError("Missing incident " + providerId);
    }

    private List<String> allProviderIds(
        Map<String, CorridorIncidentSnapshot> snapshots
    ) throws Exception {
        java.util.ArrayList<String> ids = new java.util.ArrayList<>();
        for (CorridorIncidentSnapshot snapshot : snapshots.values()) {
            for (JsonNode incident : objectMapper.readTree(snapshot.incidentsJson()).path("incidents")) {
                ids.add(incident.path("properties").path("providerEventId").asText());
            }
        }
        return List.copyOf(ids);
    }

    private static TrafficProps.Corridor i25() {
        return corridor(
            "I25",
            "I-25",
            "S",
            "N",
            271.0,
            208.0,
            "{\"type\":\"LineString\",\"coordinates\":[[-104.99,40.10],[-104.99,39.60]]}"
        );
    }

    private static TrafficProps.Corridor i70() {
        return corridor(
            "I70",
            "I-70",
            "E",
            "W",
            180.0,
            260.0,
            "{\"type\":\"LineString\",\"coordinates\":[[-105.60,39.74],[-104.80,39.74]]}"
        );
    }

    private static TrafficProps.Corridor corridor(
        String name,
        String roadNumber,
        String primaryDirection,
        String secondaryDirection,
        double startMarker,
        double endMarker,
        String geometry
    ) {
        return new TrafficProps.Corridor(
            name,
            roadNumber,
            roadNumber,
            primaryDirection,
            secondaryDirection,
            startMarker,
            endMarker,
            List.of(),
            "39.0,-106.0,41.0,-104.0",
            geometry,
            null,
            600.0
        );
    }
}
