package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TrafficPropsTest {

    @Test
    void useTileModeIsCaseInsensitive() {
        TrafficProps tile = new TrafficProps("k", 60, "TiLe", 10, 4, 500.0);
        TrafficProps point = new TrafficProps("k", 60, "point", 10, 4, 500.0);

        assertThat(tile.useTileMode()).isTrue();
        assertThat(point.useTileMode()).isFalse();
    }
}
