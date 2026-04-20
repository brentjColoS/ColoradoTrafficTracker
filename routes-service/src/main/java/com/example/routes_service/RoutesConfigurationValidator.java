package com.example.routes_service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class RoutesConfigurationValidator implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(RoutesConfigurationValidator.class);

    private final RoutesProps routesProps;

    public RoutesConfigurationValidator(RoutesProps routesProps) {
        this.routesProps = routesProps;
    }

    @Override
    public void run(ApplicationArguments args) {
        ValidationReport report = validate(routesProps.corridors());
        report.warnings().forEach(warning -> log.warn("Routes configuration warning: {}", warning));
        if (!report.errors().isEmpty()) {
            throw new IllegalStateException("Invalid routes corridor configuration: " + String.join(" | ", report.errors()));
        }
    }

    static ValidationReport validate(List<RoutesProps.Corridor> corridors) {
        if (corridors == null || corridors.isEmpty()) {
            return new ValidationReport(List.of(), List.of());
        }

        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        for (RoutesProps.Corridor corridor : corridors) {
            if (corridor == null) {
                errors.add("Encountered a null corridor entry.");
                continue;
            }
            validateCorridor(corridor, errors, warnings);
        }
        return new ValidationReport(List.copyOf(errors), List.copyOf(warnings));
    }

    private static void validateCorridor(
        RoutesProps.Corridor corridor,
        List<String> errors,
        List<String> warnings
    ) {
        String corridorName = corridor.name() == null || corridor.name().isBlank()
            ? "<unnamed>"
            : corridor.name().trim();

        if ((corridor.startMileMarker() == null) != (corridor.endMileMarker() == null)) {
            errors.add(corridorName + " must define both startMileMarker and endMileMarker together.");
        }

        List<RoutesProps.MileMarkerAnchor> anchors = corridor.mileMarkerAnchors();
        if (anchors == null || anchors.isEmpty()) {
            warnings.add(corridorName + " has no configured mile-marker anchors.");
            return;
        }
        if (anchors.size() < 2) {
            errors.add(corridorName + " must define at least two mile-marker anchors when anchors are present.");
            return;
        }

        Bbox bbox = parseBbox(corridor.bbox(), corridorName, errors);
        boolean descending = corridor.startMileMarker() != null
            && corridor.endMileMarker() != null
            && corridor.startMileMarker() > corridor.endMileMarker();

        Double previousMileMarker = null;
        for (int i = 0; i < anchors.size(); i++) {
            RoutesProps.MileMarkerAnchor anchor = anchors.get(i);
            String prefix = corridorName + " anchor[" + i + "]";
            if (anchor == null) {
                errors.add(prefix + " is null.");
                continue;
            }
            if (anchor.mileMarker() == null || anchor.latitude() == null || anchor.longitude() == null) {
                errors.add(prefix + " must include mileMarker, latitude, and longitude.");
                continue;
            }
            if (anchor.label() == null || anchor.label().isBlank()) {
                errors.add(prefix + " must include a label.");
            }
            if (anchor.latitude() < -90.0 || anchor.latitude() > 90.0) {
                errors.add(prefix + " latitude is out of range.");
            }
            if (anchor.longitude() < -180.0 || anchor.longitude() > 180.0) {
                errors.add(prefix + " longitude is out of range.");
            }
            if (corridor.startMileMarker() != null && corridor.endMileMarker() != null) {
                double low = Math.min(corridor.startMileMarker(), corridor.endMileMarker());
                double high = Math.max(corridor.startMileMarker(), corridor.endMileMarker());
                if (anchor.mileMarker() < low || anchor.mileMarker() > high) {
                    errors.add(prefix + " mileMarker " + formatDecimal(anchor.mileMarker()) + " falls outside corridor range.");
                }
            }
            if (previousMileMarker != null) {
                int comparison = Double.compare(anchor.mileMarker(), previousMileMarker);
                if (comparison == 0) {
                    errors.add(prefix + " duplicates mileMarker " + formatDecimal(anchor.mileMarker()) + ".");
                } else if (descending && comparison > 0) {
                    errors.add(prefix + " must be listed in descending mile-marker order for " + corridorName + ".");
                } else if (!descending && comparison < 0) {
                    errors.add(prefix + " must be listed in ascending mile-marker order for " + corridorName + ".");
                }
            }
            previousMileMarker = anchor.mileMarker();

            if (bbox != null && !bbox.contains(anchor.latitude(), anchor.longitude())) {
                warnings.add(prefix + " lies outside the configured corridor bbox.");
            }
        }
    }

    private static Bbox parseBbox(String bbox, String corridorName, List<String> errors) {
        if (bbox == null || bbox.isBlank()) {
            return null;
        }

        String[] parts = bbox.split(",");
        if (parts.length != 4) {
            errors.add(corridorName + " bbox must have four comma-delimited values.");
            return null;
        }

        try {
            double north = Double.parseDouble(parts[0].trim());
            double west = Double.parseDouble(parts[1].trim());
            double south = Double.parseDouble(parts[2].trim());
            double east = Double.parseDouble(parts[3].trim());
            return new Bbox(north, west, south, east);
        } catch (NumberFormatException ex) {
            errors.add(corridorName + " bbox contains a non-numeric coordinate.");
            return null;
        }
    }

    private static String formatDecimal(double value) {
        return String.format(Locale.US, "%.1f", value);
    }

    record ValidationReport(
        List<String> errors,
        List<String> warnings
    ) {}

    private record Bbox(double north, double west, double south, double east) {
        boolean contains(double latitude, double longitude) {
            return latitude <= north && latitude >= south && longitude >= west && longitude <= east;
        }
    }
}
