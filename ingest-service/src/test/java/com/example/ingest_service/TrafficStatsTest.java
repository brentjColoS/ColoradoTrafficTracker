package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class TrafficStatsTest {

    @Test
    void fromSpeedsComputesSummaryStatistics() {
        TrafficStats stats = TrafficStats.fromSpeeds(List.of(40.0, 50.0, 60.0, 70.0, 80.0));

        assertThat(stats.sampleCount()).isEqualTo(5);
        assertThat(stats.avgSpeed()).isEqualTo(60.0);
        assertThat(stats.minSpeed()).isEqualTo(40.0);
        assertThat(stats.stddev()).isCloseTo(15.811, org.assertj.core.data.Offset.offset(0.001));
        assertThat(stats.p10Speed()).isEqualTo(44.0);
        assertThat(stats.p50Speed()).isEqualTo(60.0);
        assertThat(stats.p90Speed()).isEqualTo(76.0);
    }

    @Test
    void fromSpeedsReturnsEmptyStatsForNoInput() {
        TrafficStats stats = TrafficStats.fromSpeeds(List.of());

        assertThat(stats.sampleCount()).isZero();
        assertThat(stats.avgSpeed()).isNull();
        assertThat(stats.minSpeed()).isNull();
        assertThat(stats.stddev()).isNull();
        assertThat(stats.p10Speed()).isNull();
        assertThat(stats.p50Speed()).isNull();
        assertThat(stats.p90Speed()).isNull();
    }
}
