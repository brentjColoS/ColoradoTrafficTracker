package com.example.ingest_service;

import com.wdtinc.mapbox_vector_tile.VectorTile;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class TrafficTileDecoder {
    private static final Logger log = LoggerFactory.getLogger(TrafficTileDecoder.class);

    private TrafficTileDecoder() {}

    static List<DecodedTrafficFeature> decode(byte[] bytes, TrafficTile tile) {
        try {
            return decodeTile(bytes, tile);
        } catch (IOException e) {
            log.debug("Unable to decode tile {}/{}/{}: {}", tile.z(), tile.x(), tile.y(), e.toString());
            return List.of();
        }
    }

    static List<DecodedTrafficFeature> decodeIncidentTile(byte[] bytes, TrafficTile tile) {
        try {
            return decodeTile(bytes, tile);
        } catch (IOException e) {
            throw new java.io.UncheckedIOException("Malformed incident tile " + tile.z() + "/" + tile.x() + "/" + tile.y(), e);
        }
    }

    private static List<DecodedTrafficFeature> decodeTile(byte[] bytes, TrafficTile tile) throws IOException {
        if (bytes == null || bytes.length == 0) return List.of();
        VectorTile.Tile decoded = VectorTile.Tile.parseFrom(bytes);
        List<DecodedTrafficFeature> out = new ArrayList<>();

        for (VectorTile.Tile.Layer layer : decoded.getLayersList()) {
            int extent = layer.hasExtent() ? layer.getExtent() : 4096;
            for (VectorTile.Tile.Feature feature : layer.getFeaturesList()) {
                if (feature.getType() == VectorTile.Tile.GeomType.UNKNOWN) continue;
                List<List<double[]>> paths = decodeGeometry(feature, extent, tile);
                if (paths.isEmpty()) continue;
                out.add(new DecodedTrafficFeature(layer.getName(), paths, decodeTags(layer, feature)));
            }
        }

        return out;
    }

    private static Map<String, Object> decodeTags(VectorTile.Tile.Layer layer, VectorTile.Tile.Feature feature) {
        Map<String, Object> tags = new LinkedHashMap<>();
        List<Integer> indexed = feature.getTagsList();
        for (int i = 0; i + 1 < indexed.size(); i += 2) {
            int keyIndex = indexed.get(i);
            int valueIndex = indexed.get(i + 1);
            if (keyIndex < 0 || keyIndex >= layer.getKeysCount()) continue;
            if (valueIndex < 0 || valueIndex >= layer.getValuesCount()) continue;

            String key = layer.getKeys(keyIndex);
            Object value = toValue(layer.getValues(valueIndex));
            if (value != null) tags.put(key, value);
        }
        return tags;
    }

    private static Object toValue(VectorTile.Tile.Value value) {
        if (value.hasStringValue()) return value.getStringValue();
        if (value.hasFloatValue()) return value.getFloatValue();
        if (value.hasDoubleValue()) return value.getDoubleValue();
        if (value.hasIntValue()) return value.getIntValue();
        if (value.hasUintValue()) return value.getUintValue();
        if (value.hasSintValue()) return value.getSintValue();
        if (value.hasBoolValue()) return value.getBoolValue();
        return null;
    }

    private static List<List<double[]>> decodeGeometry(VectorTile.Tile.Feature feature, int extent, TrafficTile tile) {
        List<Integer> geometry = feature.getGeometryList();
        List<List<double[]>> paths = new ArrayList<>();
        List<double[]> current = new ArrayList<>();

        int x = 0;
        int y = 0;
        int idx = 0;

        while (idx < geometry.size()) {
            int commandHeader = geometry.get(idx++);
            int command = commandHeader & 0x7;
            int count = commandHeader >> 3;

            if (command == 1 || command == 2) {
                for (int i = 0; i < count; i++) {
                    if (idx + 1 >= geometry.size()) break;
                    if (command == 1 && !current.isEmpty()) {
                        paths.add(current);
                        current = new ArrayList<>();
                    }

                    x += decodeZigZag(geometry.get(idx++));
                    y += decodeZigZag(geometry.get(idx++));
                    current.add(toLatLon(tile, extent, x, y));

                    if (feature.getType() == VectorTile.Tile.GeomType.POINT) {
                        paths.add(current);
                        current = new ArrayList<>();
                    }
                }
            } else if (command == 7) {
                if (!current.isEmpty() && feature.getType() == VectorTile.Tile.GeomType.POLYGON) {
                    current.add(current.get(0));
                }
            } else {
                break;
            }
        }

        if (!current.isEmpty()) {
            paths.add(current);
        }
        return paths;
    }

    private static int decodeZigZag(int encoded) {
        return (encoded >>> 1) ^ (-(encoded & 1));
    }

    private static double[] toLatLon(TrafficTile tile, int extent, int geomX, int geomY) {
        double n = Math.pow(2.0, tile.z());
        double worldX = tile.x() + (geomX / (double) extent);
        double worldY = tile.y() + (geomY / (double) extent);

        double lon = (worldX / n) * 360.0 - 180.0;
        double mercatorY = Math.PI - (2.0 * Math.PI * worldY / n);
        double lat = Math.toDegrees(Math.atan(Math.sinh(mercatorY)));
        return new double[]{lat, lon};
    }

}
