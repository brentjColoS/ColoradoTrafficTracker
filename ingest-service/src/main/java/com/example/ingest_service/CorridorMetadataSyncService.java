package com.example.ingest_service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CorridorMetadataSyncService {
    private final CorridorRefRepository corridorRefRepository;

    public CorridorMetadataSyncService(CorridorRefRepository corridorRefRepository) {
        this.corridorRefRepository = corridorRefRepository;
    }

    @Transactional
    public void sync(List<TrafficProps.Corridor> corridors) {
        if (corridors == null || corridors.isEmpty()) return;

        Map<String, CorridorRef> existing = new HashMap<>();
        corridorRefRepository.findAllById(corridors.stream().map(TrafficProps.Corridor::name).toList())
            .forEach(ref -> existing.put(ref.getCode(), ref));

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        for (TrafficProps.Corridor corridor : corridors) {
            CorridorRef ref = existing.getOrDefault(corridor.name(), new CorridorRef());
            if (ref.getCode() == null) {
                ref.setCode(corridor.name());
                ref.setCreatedAt(now);
            }

            ref.setDisplayName(nonBlank(corridor.displayName(), corridor.name()));
            ref.setRoadNumber(nonBlank(corridor.roadNumber(), corridor.name()));
            ref.setPrimaryDirection(normalizeDirection(corridor.primaryDirection()));
            ref.setSecondaryDirection(normalizeDirection(corridor.secondaryDirection()));
            ref.setStartMileMarker(corridor.startMileMarker());
            ref.setEndMileMarker(corridor.endMileMarker());
            ref.setMileMarkerAnchorsJson(anchorsJson(corridor.mileMarkerAnchors()));
            ref.setBbox(corridor.bbox());

            double[] center = bboxCenter(corridor.bbox());
            ref.setCenterLat(center[0]);
            ref.setCenterLon(center[1]);

            String configuredGeometry = corridor.geometryJson();
            if (configuredGeometry != null && !configuredGeometry.isBlank()) {
                ref.setGeometryJson(configuredGeometry);
                ref.setGeometrySource("configured");
                ref.setGeometryUpdatedAt(now);
            } else if (ref.getGeometryJson() == null || ref.getGeometryJson().isBlank()) {
                ref.setGeometryJson(CorridorGeometrySupport.fallbackGeoJsonFromBbox(
                    corridor.bbox(),
                    corridor.primaryDirection(),
                    corridor.secondaryDirection()
                ));
                ref.setGeometrySource("bbox-derived");
                ref.setGeometryUpdatedAt(now);
            }

            ref.setUpdatedAt(now);

            corridorRefRepository.save(ref);
        }
    }

    private static String nonBlank(String preferred, String fallback) {
        return preferred != null && !preferred.isBlank() ? preferred.trim() : fallback;
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return direction.trim().toUpperCase();
    }

    private static double[] bboxCenter(String bbox) {
        String[] parts = bbox.split(",");
        if (parts.length != 4) return new double[]{0.0, 0.0};
        double lat1 = Double.parseDouble(parts[0].trim());
        double lon1 = Double.parseDouble(parts[1].trim());
        double lat2 = Double.parseDouble(parts[2].trim());
        double lon2 = Double.parseDouble(parts[3].trim());
        return new double[]{(lat1 + lat2) / 2.0, (lon1 + lon2) / 2.0};
    }

    private static String anchorsJson(List<TrafficProps.MileMarkerAnchor> anchors) {
        if (anchors == null || anchors.isEmpty()) {
            return null;
        }

        StringBuilder json = new StringBuilder("[");
        boolean appended = false;
        for (TrafficProps.MileMarkerAnchor anchor : anchors) {
            if (anchor == null || anchor.mileMarker() == null || anchor.latitude() == null || anchor.longitude() == null) {
                continue;
            }
            if (appended) {
                json.append(',');
            }
            json.append('{')
                .append("\"label\":\"").append(escapeJson(anchor.label())).append("\",")
                .append("\"mileMarker\":").append(formatDecimal(anchor.mileMarker())).append(',')
                .append("\"latitude\":").append(formatDecimal(anchor.latitude())).append(',')
                .append("\"longitude\":").append(formatDecimal(anchor.longitude()))
                .append('}');
            appended = true;
        }
        if (!appended) {
            return null;
        }
        json.append(']');
        return json.toString();
    }

    private static String formatDecimal(Double value) {
        return String.format(Locale.US, "%.6f", value);
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "";
        }
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"");
    }
}
