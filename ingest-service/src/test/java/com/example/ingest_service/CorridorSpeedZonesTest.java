package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.common.CorridorSpeedZones;
import com.example.common.SpeedZoneDefinition;
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
}
