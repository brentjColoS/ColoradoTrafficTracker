package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.wdtinc.mapbox_vector_tile.VectorTile;
import java.util.List;
import org.junit.jupiter.api.Test;

class TrafficTileDecoderTest {
    private static final TrafficTile WORLD = new TrafficTile(0, 0, 0);

    @Test
    void emptyAndMalformedPayloadsReturnNoFeatures() {
        assertThat(TrafficTileDecoder.decode(null, WORLD)).isEmpty();
        assertThat(TrafficTileDecoder.decode(new byte[0], WORLD)).isEmpty();
        assertThat(TrafficTileDecoder.decode(new byte[]{(byte) 0xff}, WORLD)).isEmpty();
    }

    @Test
    void decodesLayerTagsAndCoordinatesWithoutChangingZeroValues() {
        var layer = layer(feature(VectorTile.Tile.GeomType.LINESTRING, 9, 4096, 4096, 10, 200, 0)
            .addAllTags(List.of(0, 0, 1, 1, 2, 2, 99, 0, 0, 99, 0)))
            .addAllKeys(List.of("traffic_level", "road_type", "closed"))
            .addValues(VectorTile.Tile.Value.newBuilder().setDoubleValue(0))
            .addValues(VectorTile.Tile.Value.newBuilder().setStringValue("motorway"))
            .addValues(VectorTile.Tile.Value.newBuilder().setBoolValue(false));

        var decoded = TrafficTileDecoder.decode(tile(layer), WORLD);

        assertThat(decoded).singleElement().satisfies(value -> {
            assertThat(value.layerName()).isEqualTo("Traffic flow");
            assertThat(value.tags()).containsEntry("traffic_level", 0.0)
                .containsEntry("road_type", "motorway").containsEntry("closed", false).hasSize(3);
            assertThat(value.paths()).hasSize(1);
            assertThat(value.paths().get(0)).hasSize(2);
            assertThat(value.paths().get(0).get(0)[0]).isCloseTo(0, within(0.000001));
            assertThat(value.paths().get(0).get(0)[1]).isCloseTo(0, within(0.000001));
            assertThat(value.paths().get(0).get(1)[1]).isCloseTo(8.7890625, within(0.000001));
        });
    }

    @Test
    void preservesMultiplePathsAndSignedGeometryDeltas() {
        var decoded = TrafficTileDecoder.decode(tile(layer(feature(VectorTile.Tile.GeomType.LINESTRING,
            9, 4096, 4096, 10, 200, 0, 9, 199, 200, 10, 200, 0))), WORLD);

        var paths = decoded.get(0).paths();
        assertThat(paths).hasSize(2).allSatisfy(path -> assertThat(path).hasSize(2));
        assertThat(paths.get(1).get(0)[1]).isCloseTo(0, within(0.000001));
        assertThat(paths.get(1).get(0)[0]).isNegative();
    }

    @Test
    void pointsRemainSeparatePathsAndPolygonClosureRepeatsTheFirstPoint() {
        var points = TrafficTileDecoder.decode(tile(layer(feature(VectorTile.Tile.GeomType.POINT,
            17, 4096, 4096, 200, 0))), WORLD).get(0).paths();
        assertThat(points).hasSize(2).allSatisfy(path -> assertThat(path).hasSize(1));

        var ring = TrafficTileDecoder.decode(tile(layer(feature(VectorTile.Tile.GeomType.POLYGON,
            9, 4096, 4096, 18, 200, 0, 0, 200, 15))), WORLD).get(0).paths().get(0);
        assertThat(ring).hasSize(4);
        assertThat(ring.get(3)).containsExactly(ring.get(0));
    }

    @Test
    void skipsUnknownOrEmptyFeaturesAndKeepsCompletePointsBeforeTruncatedCommands() {
        var layer = layer(feature(VectorTile.Tile.GeomType.UNKNOWN, 9, 0, 0))
            .addFeatures(feature(VectorTile.Tile.GeomType.LINESTRING))
            .addFeatures(feature(VectorTile.Tile.GeomType.LINESTRING, 9, 4096, 4096, 10, 200));

        assertThat(TrafficTileDecoder.decode(tile(layer), WORLD)).singleElement()
            .satisfies(value -> assertThat(value.paths().get(0)).hasSize(1));
    }

    private static VectorTile.Tile.Feature.Builder feature(VectorTile.Tile.GeomType type, Integer... geometry) {
        return VectorTile.Tile.Feature.newBuilder().setType(type).addAllGeometry(List.of(geometry));
    }

    private static VectorTile.Tile.Layer.Builder layer(VectorTile.Tile.Feature.Builder feature) {
        return VectorTile.Tile.Layer.newBuilder().setVersion(2).setName("Traffic flow")
            .setExtent(4096).addFeatures(feature);
    }

    private static byte[] tile(VectorTile.Tile.Layer.Builder layer) {
        return VectorTile.Tile.newBuilder().addLayers(layer).build().toByteArray();
    }
}
