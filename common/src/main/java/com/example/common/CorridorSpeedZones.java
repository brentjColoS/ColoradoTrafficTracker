package com.example.common;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class CorridorSpeedZones {
    private static final Map<String, List<SpeedZoneDefinition>> ZONES = Map.of(
        "I25",
        List.of(
            zone("I25", 0, 208.0, 221.5, 55, "Denver / Northglenn urban section"),
            zone("I25", 1, 221.5, 225.552, 65, "Northglenn / Thornton transition"),
            zone("I25", 2, 225.552, 271.0, 75, "Northern Front Range mainline")
        ),
        "I70",
        List.of(
            zone("I70", 0, 206.0, 213.1, 60, "Summit County west approach"),
            zone("I70", 1, 213.1, 216.0, 50, "Eisenhower-Johnson Memorial Tunnel"),
            zone("I70", 2, 216.0, 236.918, 65, "Silver Plume / Georgetown corridor"),
            zone("I70", 3, 236.918, 241.907, 60, "Idaho Springs area"),
            zone("I70", 4, 241.907, 244.857, 55, "East Idaho Springs constrained section"),
            zone("I70", 5, 244.857, 259.0, 65, "Floyd Hill / Jefferson County approach")
        )
    );

    private CorridorSpeedZones() {}

    public static List<SpeedZoneDefinition> forCorridor(String corridor) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return List.of();
        return ZONES.getOrDefault(normalized, List.of());
    }

    public static SpeedZoneDefinition locate(String corridor, Double mileMarker) {
        for (SpeedZoneDefinition zone : forCorridor(corridor)) {
            if (zone.contains(mileMarker)) return zone;
        }
        return null;
    }

    public static List<Map<String, Object>> asPropertyList(String corridor) {
        return forCorridor(corridor).stream()
            .map(zone -> {
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("zoneKey", zone.zoneKey());
                out.put("zoneOrder", zone.zoneOrder());
                out.put("startMileMarker", zone.startMileMarker());
                out.put("endMileMarker", zone.endMileMarker());
                out.put("speedLimitMph", zone.postedSpeedMph());
                out.put("description", zone.description());
                out.put("label", zone.label());
                return out;
            })
            .toList();
    }

    public static String formatMileMarker(double value) {
        if (Math.abs(value - Math.rint(value)) < 0.000_001) {
            return String.format(Locale.US, "%.0f", value);
        }
        return String.format(Locale.US, "%.3f", value)
            .replaceAll("0+$", "")
            .replaceAll("\\.$", "");
    }

    private static SpeedZoneDefinition zone(
        String corridor,
        int zoneOrder,
        double startMileMarker,
        double endMileMarker,
        int postedSpeedMph,
        String description
    ) {
        String corridorCode = corridor.trim().toUpperCase(Locale.ROOT);
        String zoneKey = corridorCode
            + "-"
            + formatMileMarker(startMileMarker).replace('.', '_')
            + "-"
            + formatMileMarker(endMileMarker).replace('.', '_');
        return new SpeedZoneDefinition(
            corridorCode,
            zoneKey,
            zoneOrder,
            startMileMarker,
            endMileMarker,
            postedSpeedMph,
            description
        );
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null || corridor.isBlank()) return null;
        return corridor.trim().toUpperCase(Locale.ROOT);
    }
}
