package com.example.common;

import java.util.Locale;

public record SpeedZoneDefinition(
    String corridor,
    String zoneKey,
    int zoneOrder,
    double startMileMarker,
    double endMileMarker,
    int postedSpeedMph,
    String description
) {
    public boolean contains(Double mileMarker) {
        if (mileMarker == null) return false;
        double value = mileMarker;
        double epsilon = 0.000_001;
        return value + epsilon >= startMileMarker && value - epsilon <= endMileMarker;
    }

    public String label() {
        return String.format(
            Locale.US,
            "MM %s-%s | %d mph",
            CorridorSpeedZones.formatMileMarker(startMileMarker),
            CorridorSpeedZones.formatMileMarker(endMileMarker),
            postedSpeedMph
        );
    }
}
