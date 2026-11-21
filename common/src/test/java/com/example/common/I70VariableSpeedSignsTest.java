package com.example.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class I70VariableSpeedSignsTest {
    @Test
    void loadsTheReviewedCatalogWithUniqueIdsAndCorridorLocations() {
        var devices = I70VariableSpeedSigns.devices();
        assertThat(devices).hasSize(42);
        assertThat(devices).extracting(I70VariableSpeedSigns.Device::id).doesNotHaveDuplicates();
        assertThat(devices).allSatisfy(device -> {
            assertThat(device.id()).matches("OpenTMS-Sign[0-9]+");
            assertThat(device.mileMarker()).isBetween(206.0, 274.0);
            assertThat(device.direction()).isIn("EAST", "WEST");
            assertThat(device.longitude()).isBetween(-180.0, 180.0);
            assertThat(device.latitude()).isBetween(-90.0, 90.0);
            assertThat(I70VariableSpeedSigns.device(device.id())).isEqualTo(device);
            assertThat(device.regularLimitMph()).isPositive();
        });
        assertThat(I70VariableSpeedSigns.device("unknown")).isNull();
        assertThatThrownBy(() -> devices.clear()).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void derivesRegularLimitsOnlyInsideTheTrackedCorridor() {
        var inside = new I70VariableSpeedSigns.Device("fixture", 215, "EAST", -105, 39, "fixture");
        var outside = new I70VariableSpeedSigns.Device("fixture", 275, "EAST", -105, 39, "fixture");
        assertThat(inside.regularLimitMph()).isEqualTo(50);
        assertThat(outside.regularLimitMph()).isNull();
    }
}
