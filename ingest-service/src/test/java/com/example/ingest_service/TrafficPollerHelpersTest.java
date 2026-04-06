package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TrafficPollerHelpersTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Test
    void normalizeBboxAcceptsLonLatInputOrdering() throws Exception {
        double[] normalized = (double[]) invokeStatic(
            "normalizeBbox",
            new Class<?>[]{String.class},
            "-105.03,40.62,-104.97,39.70"
        );

        assertThat(normalized[0]).isLessThan(normalized[2]);
        assertThat(normalized[1]).isLessThan(normalized[3]);
        assertThat(normalized[0]).isCloseTo(39.70, org.assertj.core.data.Offset.offset(0.001));
        assertThat(normalized[3]).isCloseTo(-104.97, org.assertj.core.data.Offset.offset(0.001));
    }

    @Test
    @SuppressWarnings("unchecked")
    void sampleAlongPolylineInteriorExcludesEndpoints() throws Exception {
        List<double[]> polyline = List.of(
            new double[]{39.70, -105.00},
            new double[]{39.80, -104.90}
        );

        List<double[]> sampled = (List<double[]>) invokeStatic(
            "sampleAlongPolylineInterior",
            new Class<?>[]{List.class, int.class},
            polyline,
            3
        );

        assertThat(sampled).hasSize(3);
        assertThat(sampled.get(0)[0]).isGreaterThan(39.70);
        assertThat(sampled.get(2)[0]).isLessThan(39.80);
    }

    @Test
    void toIncidentsBboxUsesLonLatOrder() throws Exception {
        String bbox = (String) invokeStatic(
            "toIncidentsBbox",
            new Class<?>[]{String.class},
            "40.627367,-105.031128,39.700390,-104.970703"
        );

        assertThat(bbox).isEqualTo("-105.031128,39.70039,-104.970703,40.627367");
    }

    @Test
    @SuppressWarnings("unchecked")
    void incidentMatchesCorridorUsesNormalizedRoadNumbers() throws Exception {
        JsonNode incident = OBJECT_MAPPER.readTree(
            """
            {
              "properties": {
                "roadNumbers": ["I-25", "US-36"]
              }
            }
            """
        );
        Set<String> corridor = (Set<String>) invokeStatic(
            "corridorFilter",
            new Class<?>[]{String.class},
            "i25"
        );

        boolean matched = (boolean) invokeStatic(
            "incidentMatchesCorridor",
            new Class<?>[]{JsonNode.class, Set.class},
            incident,
            corridor
        );

        assertThat(corridor).containsExactly("I25");
        assertThat(matched).isTrue();
    }

    @Test
    void avgAndMinHandleEmptyAndPopulatedLists() throws Exception {
        Double avgEmpty = (Double) invokeStatic("avg", new Class<?>[]{List.class}, List.of());
        Double minEmpty = (Double) invokeStatic("min", new Class<?>[]{List.class}, List.of());
        Double avg = (Double) invokeStatic("avg", new Class<?>[]{List.class}, List.of(30.0, 40.0, 50.0));
        Double min = (Double) invokeStatic("min", new Class<?>[]{List.class}, List.of(30.0, 40.0, 50.0));

        assertThat(avgEmpty).isNull();
        assertThat(minEmpty).isNull();
        assertThat(avg).isEqualTo(40.0);
        assertThat(min).isEqualTo(30.0);
    }

    private static Object invokeStatic(String name, Class<?>[] argTypes, Object... args) throws Exception {
        Method method = TrafficPoller.class.getDeclaredMethod(name, argTypes);
        method.setAccessible(true);
        return method.invoke(null, args);
    }
}
