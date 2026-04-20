package com.example.routes_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

class RoutesConfigurationValidatorTest {

    @Test
    void validatesConfiguredAnchorsWhenOrderedWithinRange() {
        RoutesProps.Corridor corridor = new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            271.0,
            208.0,
            List.of(
                new RoutesProps.MileMarkerAnchor("MM 270", 270.0, 40.5901, -105.0011),
                new RoutesProps.MileMarkerAnchor("MM 240", 240.0, 40.1576, -104.9787),
                new RoutesProps.MileMarkerAnchor("MM 208", 208.0, 39.7117, -104.9992)
            ),
            "40.627367,-105.031128,39.700390,-104.970703",
            null
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).isEmpty();
        assertThat(report.warnings()).isEmpty();
    }

    @Test
    void rejectsOutOfOrderAnchorsForDescendingCorridorRange() {
        RoutesProps.Corridor corridor = new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            271.0,
            208.0,
            List.of(
                new RoutesProps.MileMarkerAnchor("MM 220", 220.0, 39.8702, -104.9874),
                new RoutesProps.MileMarkerAnchor("MM 240", 240.0, 40.1576, -104.9787)
            ),
            "40.627367,-105.031128,39.700390,-104.970703",
            null
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).anyMatch(error -> error.contains("descending mile-marker order"));
    }

    @Test
    void validatesOrderedAnchorsForAscendingCorridorRange() {
        RoutesProps.Corridor corridor = new RoutesProps.Corridor(
            "I70",
            "Interstate 70",
            "I-70",
            "E",
            "W",
            206.0,
            259.0,
            List.of(
                new RoutesProps.MileMarkerAnchor("MM 206", 206.0, 39.6322, -106.0580),
                new RoutesProps.MileMarkerAnchor("MM 230", 230.0, 39.7428, -105.6830),
                new RoutesProps.MileMarkerAnchor("MM 259", 259.0, 39.7018, -105.2020)
            ),
            "39.797997,-106.437378,39.492291,-104.963837",
            null
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).isEmpty();
        assertThat(report.warnings()).isEmpty();
    }

    @Test
    void startupRunnerFailsFastWhenConfigurationIsInvalid() {
        RoutesProps routesProps = new RoutesProps(List.of(
            new RoutesProps.Corridor(
                "I25",
                "Interstate 25",
                "I-25",
                "S",
                "N",
                271.0,
                208.0,
                List.of(new RoutesProps.MileMarkerAnchor("Broken", null, 40.0, -105.0)),
                "40.627367,-105.031128,39.700390,-104.970703",
                null
            )
        ));

        RoutesConfigurationValidator validator = new RoutesConfigurationValidator(routesProps);

        assertThatThrownBy(() -> validator.run(null))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Invalid routes corridor configuration");
    }
}
