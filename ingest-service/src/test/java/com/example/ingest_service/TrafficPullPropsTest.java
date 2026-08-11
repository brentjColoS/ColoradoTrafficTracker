package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TrafficPullPropsTest {

    @Test
    void usesZeroCostSplitDefaultsWhenNestedSettingsAreMissing() {
        TrafficPullProps props = new TrafficPullProps(null, null, null);

        assertThat(props.flow().provider()).isEqualTo("tomtom");
        assertThat(props.flow().pollSeconds()).isEqualTo(60);
        assertThat(props.flow().tileZoom()).isEqualTo(10);
        assertThat(props.incidents().provider()).isEqualTo("cdot");
        assertThat(props.incidents().pollSeconds()).isEqualTo(900);
        assertThat(props.incidents().tileZoom()).isEqualTo(9);
        assertThat(props.incidents().leaseCheckSeconds()).isEqualTo(60);
        assertThat(props.monthlyRequestBudget().targetRequests()).isEqualTo(190_000);
        assertThat(props.monthlyRequestBudget().hardStopRequests()).isEqualTo(195_000);
        assertThat(props.monthlyRequestBudget().allowanceRequests()).isEqualTo(200_000);
    }
}
