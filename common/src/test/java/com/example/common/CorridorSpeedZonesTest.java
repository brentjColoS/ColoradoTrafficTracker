package com.example.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class CorridorSpeedZonesTest {

    @Test
    void i70KeepsExistingZoneIdentityAndAddsCoverageThroughI25() {
        assertThat(CorridorSpeedZones.forCorridor("I70"))
            .extracting(SpeedZoneDefinition::zoneKey)
            .containsExactly(
                "I70-206-213_1",
                "I70-213_1-216",
                "I70-216-236_918",
                "I70-236_918-241_907",
                "I70-241_907-244_857",
                "I70-244_857-259",
                "I70-259-270_274",
                "I70-270_274-274"
            );

        assertThat(CorridorSpeedZones.locate("I70", 258.9).zoneKey()).isEqualTo("I70-244_857-259");
        assertThat(CorridorSpeedZones.locate("I70", 265.0).zoneKey()).isEqualTo("I70-259-270_274");
        assertThat(CorridorSpeedZones.locate("I70", 273.5).zoneKey()).isEqualTo("I70-270_274-274");
        assertThat(CorridorSpeedZones.locate("I70", 274.1)).isNull();
    }

    @Test
    void normalizesCorridorsAndHandlesUnknownLocations() {
        assertThat(CorridorSpeedZones.forCorridor(" i25 ")).hasSize(3);
        assertThat(CorridorSpeedZones.forCorridor(null)).isEmpty();
        assertThat(CorridorSpeedZones.forCorridor(" ")).isEmpty();
        assertThat(CorridorSpeedZones.forCorridor("I99")).isEmpty();
        assertThat(CorridorSpeedZones.locate("I25", null)).isNull();
        assertThat(CorridorSpeedZones.locate("I25", 207.9)).isNull();
        assertThat(CorridorSpeedZones.locate("I25", 271.1)).isNull();
    }

    @Test
    void retainsInclusiveBoundaryToleranceAndFirstZoneAtSharedEdges() {
        var zone = CorridorSpeedZones.forCorridor("I25").getFirst();
        assertThat(zone.contains(208.0)).isTrue();
        assertThat(zone.contains(221.5)).isTrue();
        assertThat(zone.contains(208.0 - 0.000_000_5)).isTrue();
        assertThat(zone.contains(221.5 + 0.000_000_5)).isTrue();
        assertThat(zone.contains(208.0 - 0.000_002)).isFalse();
        assertThat(zone.contains(221.5 + 0.000_002)).isFalse();
        assertThat(CorridorSpeedZones.locate("I25", 221.5)).isEqualTo(zone);
    }

    @Test
    void exportsStablePropertiesAndReadableLabels() {
        var zone = CorridorSpeedZones.forCorridor("I25").getFirst();
        assertThat(zone.label()).isEqualTo("MM 208-221.5 | 55 mph");
        assertThat(CorridorSpeedZones.asPropertyList("I25").getFirst())
            .isEqualTo(java.util.Map.of(
                "zoneKey", "I25-208-221_5", "zoneOrder", 0,
                "startMileMarker", 208.0, "endMileMarker", 221.5,
                "speedLimitMph", 55, "description", "Denver / Northglenn urban section",
                "label", zone.label()));
        assertThat(CorridorSpeedZones.formatMileMarker(213.100)).isEqualTo("213.1");
        assertThat(CorridorSpeedZones.formatMileMarker(225.552)).isEqualTo("225.552");
        assertThat(CorridorSpeedZones.formatMileMarker(208.000_000_1)).isEqualTo("208");
    }
}
