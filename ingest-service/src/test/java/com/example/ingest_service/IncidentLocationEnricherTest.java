package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;

class IncidentLocationEnricherTest {
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Test
    void resolveDetailsBuildsDirectionAndMileMarkerLabel() {
        TrafficProps.Corridor corridor = new TrafficProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            250.0,
            200.0,
            null,
            "40.0,-105.0,39.0,-104.0",
            null,
            null,
            null
        );

        List<double[]> route = List.of(
            new double[]{40.0, -105.0},
            new double[]{39.0, -104.0}
        );

        ObjectNode incident = OBJECT_MAPPER.createObjectNode();
        ObjectNode props = incident.putObject("properties");
        props.put("iconCategory", 4);
        ObjectNode geometry = incident.putObject("geometry");
        geometry.put("type", "LineString");
        geometry.putArray("coordinates").addArray().add(-104.60).add(39.60);
        geometry.withArray("coordinates").addArray().add(-104.40).add(39.40);

        IncidentLocationDetails details = IncidentLocationEnricher.resolveDetails(incident, corridor, route);

        assertThat(details.travelDirection()).isEqualTo("S");
        assertThat(details.closestMileMarker()).isNotNull();
        assertThat(details.closestMileMarker()).isBetween(220.0, 230.0);
        assertThat(details.mileMarkerMethod()).isEqualTo("range_interpolated");
        assertThat(details.mileMarkerConfidence()).isGreaterThan(0.5);
        assertThat(details.distanceToCorridorMeters()).isLessThan(1.0);
        assertThat(details.locationLabel()).startsWith("I-25 southbound near MM ");
        assertThat(details.centroidLat()).isEqualTo(39.5);
        assertThat(details.centroidLon()).isEqualTo(-104.5);
    }

    @Test
    void enrichIncidentAddsLocationFieldsToProperties() {
        TrafficProps.Corridor corridor = new TrafficProps.Corridor(
            "I70",
            "Interstate 70",
            "I-70",
            "E",
            "W",
            null,
            null,
            null,
            "39.8,-106.4,39.5,-105.0",
            null,
            null,
            null
        );

        ObjectNode incident = OBJECT_MAPPER.createObjectNode();
        incident.putObject("properties");
        ObjectNode geometry = incident.putObject("geometry");
        geometry.put("type", "Point");
        geometry.putArray("coordinates").add(-105.2).add(39.7);

        ObjectNode enriched = IncidentLocationEnricher.enrichIncident(incident, corridor, List.of());

        assertThat(enriched.path("properties").path("travelDirection").asText()).isEqualTo("E");
        assertThat(enriched.path("properties").path("locationLabel").asText()).isEqualTo("I-70 eastbound");
        assertThat(enriched.path("properties").path("mileMarkerMethod").asText()).isEqualTo("direction_only");
        assertThat(enriched.path("properties").path("centroidLat").asDouble()).isEqualTo(39.7);
        assertThat(enriched.path("properties").path("centroidLon").asDouble()).isEqualTo(-105.2);
    }

    @Test
    void resolveDetailsKeepsEastWestCorridorDirectionOnNorthSouthIncidentShape() {
        TrafficProps.Corridor corridor = new TrafficProps.Corridor(
            "I70",
            "Interstate 70",
            "I-70",
            "E",
            "W",
            206.0,
            259.0,
            null,
            "39.8,-106.4,39.5,-105.0",
            null,
            null,
            null
        );

        List<double[]> route = List.of(
            new double[]{39.70, -106.00},
            new double[]{39.70, -105.00}
        );

        ObjectNode incident = OBJECT_MAPPER.createObjectNode();
        incident.putObject("properties");
        ObjectNode geometry = incident.putObject("geometry");
        geometry.put("type", "LineString");
        geometry.putArray("coordinates").addArray().add(-105.60).add(39.64);
        geometry.withArray("coordinates").addArray().add(-105.60).add(39.76);

        IncidentLocationDetails details = IncidentLocationEnricher.resolveDetails(incident, corridor, route);

        assertThat(details.travelDirection()).isEqualTo("E");
        assertThat(details.locationLabel()).startsWith("I-70 eastbound");
    }
}
