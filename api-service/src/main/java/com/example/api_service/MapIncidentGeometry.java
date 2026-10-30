package com.example.api_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class MapIncidentGeometry {
    private final ObjectMapper objectMapper;

    MapIncidentGeometry(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    IncidentDisplayGeometry displayGeometry(CurrentMapIncident incident, CorridorRef corridor) {
        JsonNode geometry = geometryNode(incident.getGeometryJson());
        double[] providerPoint = incidentSourcePoint(incident, geometry);
        ProjectionMatch markerSnap = usesSourceMileMarker(incident)
            ? snapMileMarkerToCorridor(incident.getClosestMileMarker(), corridor)
            : null;
        if (markerSnap != null) {
            return new IncidentDisplayGeometry(
                pointGeometry(markerSnap.lon(), markerSnap.lat()),
                "mile_marker_snapped",
                roundToSingleDecimal(markerSnap.distanceMeters()),
                providerPoint == null ? null : providerPoint[0],
                providerPoint == null ? null : providerPoint[1]
            );
        }
        ProjectionMatch snap = providerPoint == null ? null : snapToCorridor(providerPoint[0], providerPoint[1], corridor);
        if (snap != null) {
            return new IncidentDisplayGeometry(
                pointGeometry(snap.lon(), snap.lat()),
                "corridor_snapped",
                roundToSingleDecimal(snap.distanceMeters()),
                providerPoint[0],
                providerPoint[1]
            );
        }
        if (providerPoint != null) {
            return new IncidentDisplayGeometry(
                pointGeometry(providerPoint[1], providerPoint[0]),
                incident.getCentroidLat() != null && incident.getCentroidLon() != null ? "centroid" : "provider_center",
                null,
                providerPoint[0],
                providerPoint[1]
            );
        }
        if (geometry != null) {
            return new IncidentDisplayGeometry(geometry, "provider_geometry", null, null, null);
        }
        return new IncidentDisplayGeometry(null, "unavailable", null, null, null);
    }

    private static boolean usesSourceMileMarker(CurrentMapIncident incident) {
        if (incident == null || incident.getClosestMileMarker() == null) return false;
        String method = incident.getMileMarkerMethod();
        if (method == null) return false;
        String normalized = method.trim().toLowerCase(Locale.ROOT);
        return "source_marker".equals(normalized) || "source_range_midpoint".equals(normalized);
    }

    private ProjectionMatch snapMileMarkerToCorridor(Double mileMarker, CorridorRef corridor) {
        if (mileMarker == null || corridor == null) return null;
        double[] estimate = estimateMileMarkerPoint(mileMarker, corridor.getMileMarkerAnchorsJson());
        return estimate == null ? null : snapToCorridor(estimate[0], estimate[1], corridor);
    }

    private double[] estimateMileMarkerPoint(double mileMarker, String anchorsJson) {
        if (anchorsJson == null || anchorsJson.isBlank()) return null;
        List<MileMarkerAnchor> anchors = new ArrayList<>();
        try {
            JsonNode root = objectMapper.readTree(anchorsJson);
            if (!root.isArray()) return null;
            for (JsonNode node : root) {
                JsonNode marker = node.path("mileMarker");
                JsonNode latitude = node.path("latitude");
                JsonNode longitude = node.path("longitude");
                if (marker.isNumber() && latitude.isNumber() && longitude.isNumber()) {
                    anchors.add(new MileMarkerAnchor(
                        marker.asDouble(),
                        latitude.asDouble(),
                        longitude.asDouble()
                    ));
                }
            }
        } catch (Exception e) {
            return null;
        }
        if (anchors.size() < 2) return null;
        anchors.sort((left, right) -> Double.compare(left.mileMarker(), right.mileMarker()));

        MileMarkerAnchor left = anchors.get(0);
        MileMarkerAnchor right = anchors.get(1);
        if (mileMarker >= anchors.get(anchors.size() - 1).mileMarker()) {
            left = anchors.get(anchors.size() - 2);
            right = anchors.get(anchors.size() - 1);
        } else if (mileMarker > left.mileMarker()) {
            for (int i = 0; i < anchors.size() - 1; i++) {
                MileMarkerAnchor candidateLeft = anchors.get(i);
                MileMarkerAnchor candidateRight = anchors.get(i + 1);
                if (mileMarker >= candidateLeft.mileMarker() && mileMarker <= candidateRight.mileMarker()) {
                    left = candidateLeft;
                    right = candidateRight;
                    break;
                }
            }
        }

        double markerSpan = right.mileMarker() - left.mileMarker();
        if (markerSpan == 0.0) return null;
        double ratio = (mileMarker - left.mileMarker()) / markerSpan;
        return new double[]{
            left.lat() + ((right.lat() - left.lat()) * ratio),
            left.lon() + ((right.lon() - left.lon()) * ratio)
        };
    }

    private double[] incidentSourcePoint(CurrentMapIncident incident, JsonNode geometry) {
        if (incident.getCentroidLat() != null && incident.getCentroidLon() != null) {
            return new double[]{incident.getCentroidLat(), incident.getCentroidLon()};
        }
        List<double[]> points = geometryPoints(geometry);
        if (points.isEmpty()) return null;

        double latSum = 0.0;
        double lonSum = 0.0;
        for (double[] point : points) {
            latSum += point[0];
            lonSum += point[1];
        }
        return new double[]{latSum / points.size(), lonSum / points.size()};
    }

    private JsonNode pointGeometry(double lon, double lat) {
        ObjectNode point = objectMapper.createObjectNode();
        point.put("type", "Point");
        point.putArray("coordinates")
            .add(lon)
            .add(lat);
        return point;
    }

    private ProjectionMatch snapToCorridor(double lat, double lon, CorridorRef corridor) {
        if (corridor == null) return null;
        List<double[]> polyline = geometryPoints(geometryNode(corridor.getGeometryJson()));
        if (polyline.size() < 2) return null;

        ProjectionMatch best = null;
        for (int i = 0; i < polyline.size() - 1; i++) {
            SegmentProjection projection = projectOntoSegment(lat, lon, polyline.get(i), polyline.get(i + 1));
            if (best == null || projection.distanceMeters() < best.distanceMeters()) {
                best = new ProjectionMatch(projection.lat(), projection.lon(), projection.distanceMeters());
            }
        }
        return best;
    }

    private static SegmentProjection projectOntoSegment(double plat, double plon, double[] start, double[] end) {
        double lat0 = Math.toRadians(plat);
        double mLat = 111320.0;
        double mLon = 111320.0 * Math.cos(lat0);

        double ax = (start[1] - plon) * mLon;
        double ay = (start[0] - plat) * mLat;
        double bx = (end[1] - plon) * mLon;
        double by = (end[0] - plat) * mLat;

        double vectorX = bx - ax;
        double vectorY = by - ay;
        double len2 = (vectorX * vectorX) + (vectorY * vectorY);
        if (len2 == 0.0) return new SegmentProjection(start[0], start[1], Math.hypot(ax, ay));

        double t = -(ax * vectorX + ay * vectorY) / len2;
        t = Math.max(0.0, Math.min(1.0, t));

        double lat = start[0] + ((end[0] - start[0]) * t);
        double lon = start[1] + ((end[1] - start[1]) * t);
        double px = ax + (t * vectorX);
        double py = ay + (t * vectorY);
        return new SegmentProjection(lat, lon, Math.hypot(px, py));
    }

    JsonNode geometryNode(String rawGeometry) {
        if (rawGeometry == null || rawGeometry.isBlank()) return null;
        try {
            return objectMapper.readTree(rawGeometry);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<double[]> geometryPoints(JsonNode geometry) {
        List<double[]> points = new ArrayList<>();
        if (geometry == null || geometry.isMissingNode()) return points;

        String type = geometry.path("type").asText("");
        JsonNode coordinates = geometry.path("coordinates");

        if ("Point".equals(type)) {
            addPoint(points, coordinates);
            return points;
        }
        if ("LineString".equals(type)) {
            for (JsonNode point : coordinates) addPoint(points, point);
            return points;
        }
        if ("MultiLineString".equals(type)) {
            for (JsonNode line : coordinates) {
                for (JsonNode point : line) addPoint(points, point);
            }
        }
        return points;
    }

    private static void addPoint(List<double[]> points, JsonNode coordinate) {
        if (!coordinate.isArray() || coordinate.size() < 2) return;
        points.add(new double[]{coordinate.get(1).asDouble(), coordinate.get(0).asDouble()});
    }

    private static double roundToSingleDecimal(double value) {
        return Math.round(value * 10.0) / 10.0;
    }

    record IncidentDisplayGeometry(
        JsonNode geometry,
        String source,
        Double snapDistanceMeters,
        Double providerLat,
        Double providerLon
    ) {}
    private record SegmentProjection(double lat, double lon, double distanceMeters) {}
    private record ProjectionMatch(double lat, double lon, double distanceMeters) {}
    private record MileMarkerAnchor(double mileMarker, double lat, double lon) {}
}
