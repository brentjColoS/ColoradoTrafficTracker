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
            null,
            null,
            550.0
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
            null,
            null,
            550.0
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
            null,
            null,
            null
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).isEmpty();
        assertThat(report.warnings()).isEmpty();
    }

    @Test
    void rejectsNonPositiveSnapDistanceOverrides() {
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
                new RoutesProps.MileMarkerAnchor("MM 240", 240.0, 40.1576, -104.9787)
            ),
            "40.627367,-105.031128,39.700390,-104.970703",
            null,
            null,
            0.0
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).anyMatch(error -> error.contains("maxSnapDistanceMeters must be greater than zero"));
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
                null,
                null,
                null
            )
        ));

        RoutesConfigurationValidator validator = new RoutesConfigurationValidator(routesProps);

        assertThatThrownBy(() -> validator.run(null))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Invalid routes corridor configuration");
    }

    @Test
    void validateReturnsEmptyReportWhenCorridorsAreMissing() {
        RoutesConfigurationValidator.ValidationReport nullReport = RoutesConfigurationValidator.validate(null);
        RoutesConfigurationValidator.ValidationReport emptyReport = RoutesConfigurationValidator.validate(List.of());

        assertThat(nullReport).isNotNull();
        assertThat(nullReport.errors()).isEmpty();
        assertThat(nullReport.warnings()).isEmpty();
        assertThat(emptyReport).isNotNull();
        assertThat(emptyReport.errors()).isEmpty();
        assertThat(emptyReport.warnings()).isEmpty();
    }

    @Test
    void warnsWhenAnchorsAreMissing() {
        RoutesProps.Corridor corridor = new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            271.0,
            208.0,
            null,
            "40.627367,-105.031128,39.700390,-104.970703",
            null,
            null,
            550.0
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).isEmpty();
        assertThat(report.warnings()).containsExactly("I25 has no configured mile-marker anchors.");
    }

    @Test
    void rejectsMalformedAndNonNumericBboxValues() {
        RoutesProps.Corridor malformed = new RoutesProps.Corridor(
            "I25",
            "Interstate 25",
            "I-25",
            "S",
            "N",
            271.0,
            208.0,
            List.of(
                new RoutesProps.MileMarkerAnchor("MM 270", 270.0, 40.5901, -105.0011),
                new RoutesProps.MileMarkerAnchor("MM 208", 208.0, 39.7117, -104.9992)
            ),
            "40.627367,-105.031128,39.700390",
            null,
            null,
            550.0
        );
        RoutesProps.Corridor nonNumeric = new RoutesProps.Corridor(
            "I70",
            "Interstate 70",
            "I-70",
            "E",
            "W",
            206.0,
            259.0,
            List.of(
                new RoutesProps.MileMarkerAnchor("MM 206", 206.0, 39.6322, -106.0580),
                new RoutesProps.MileMarkerAnchor("MM 259", 259.0, 39.7018, -105.2020)
            ),
            "north,-106.437378,39.492291,-104.963837",
            null,
            null,
            550.0
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(malformed, nonNumeric));

        assertThat(report.errors()).contains(
            "I25 bbox must have four comma-delimited values.",
            "I70 bbox contains a non-numeric coordinate."
        );
    }

    @Test
    void rejectsDuplicateAndOutOfRangeAnchorValuesUsingFormattedMessages() {
        RoutesProps.Corridor corridor = new RoutesProps.Corridor(
            null,
            "Interstate 25",
            "I-25",
            "S",
            "N",
            271.0,
            208.0,
            List.of(
                new RoutesProps.MileMarkerAnchor("MM 280", 280.0, 40.5901, -105.0011),
                new RoutesProps.MileMarkerAnchor("MM 280 duplicate", 280.0, 40.1576, -104.9787)
            ),
            "40.627367,-105.031128,39.700390,-104.970703",
            null,
            null,
            550.0
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).contains(
            "<unnamed> anchor[0] mileMarker 280.0 falls outside corridor range.",
            "<unnamed> anchor[1] mileMarker 280.0 falls outside corridor range.",
            "<unnamed> anchor[1] duplicates mileMarker 280.0."
        );
    }

    @Test
    void rejectsOutOfRangeCoordinatesAndSingleEndedCorridorRanges() {
        RoutesProps.Corridor corridor = new RoutesProps.Corridor(
            "I70",
            "Interstate 70",
            "I-70",
            "E",
            "W",
            206.0,
            null,
            List.of(
                new RoutesProps.MileMarkerAnchor("North", 206.0, 91.0, -181.0),
                new RoutesProps.MileMarkerAnchor("South", 207.0, -91.0, 181.0)
            ),
            "39.797997,-106.437378,39.492291,-104.963837",
            null,
            null,
            550.0
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).contains(
            "I70 must define both startMileMarker and endMileMarker together.",
            "I70 anchor[0] latitude is out of range.",
            "I70 anchor[0] longitude is out of range.",
            "I70 anchor[1] latitude is out of range.",
            "I70 anchor[1] longitude is out of range."
        );
    }

    @Test
    void warnsWhenAnchorFallsOutsideValidBboxButAcceptsBoundaryCoordinates() {
        RoutesProps.Corridor corridor = new RoutesProps.Corridor(
            "I70",
            "Interstate 70",
            "I-70",
            "E",
            "W",
            206.0,
            259.0,
            List.of(
                new RoutesProps.MileMarkerAnchor("North boundary", 206.0, 39.797997, -106.437378),
                new RoutesProps.MileMarkerAnchor("Outside east", 230.0, 39.7000, -104.963000),
                new RoutesProps.MileMarkerAnchor("South boundary", 259.0, 39.492291, -104.963837)
            ),
            "39.797997,-106.437378,39.492291,-104.963837",
            null,
            null,
            null
        );

        RoutesConfigurationValidator.ValidationReport report = RoutesConfigurationValidator.validate(List.of(corridor));

        assertThat(report.errors()).isEmpty();
        assertThat(report.warnings()).containsExactly("I70 anchor[1] lies outside the configured corridor bbox.");
    }
}
