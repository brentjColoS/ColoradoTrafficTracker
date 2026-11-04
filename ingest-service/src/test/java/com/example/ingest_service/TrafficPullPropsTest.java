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
        assertThat(props.flow().precision()).isEqualTo(TrafficPullProps.Precision.DEFAULT);
        assertThat(props.incidents().provider()).isEqualTo("cdot");
        assertThat(props.incidents().pollSeconds()).isEqualTo(900);
        assertThat(props.incidents().tileZoom()).isEqualTo(9);
        assertThat(props.incidents().leaseCheckSeconds()).isEqualTo(60);
        assertThat(props.monthlyRequestBudget().targetRequests()).isEqualTo(190_000);
        assertThat(props.monthlyRequestBudget().hardStopRequests()).isEqualTo(195_000);
        assertThat(props.monthlyRequestBudget().allowanceRequests()).isEqualTo(200_000);
    }
    static TrafficPullProps bind(java.util.Map<String, String> values) {
        return new org.springframework.boot.context.properties.bind.Binder(
            new org.springframework.boot.context.properties.source.MapConfigurationPropertySource(values))
            .bind("traffic.pull", org.springframework.boot.context.properties.bind.Bindable.of(TrafficPullProps.class)).get();
    }

    @Test
    void springBindsAllIncidentOverridesIncludingDisabledPolling() {
        var props = bind(java.util.Map.of(
            "traffic.pull.incidents.enabled", "false",
            "traffic.pull.incidents.provider", "offline-fixture",
            "traffic.pull.incidents.poll-seconds", "777",
            "traffic.pull.incidents.tile-zoom", "6",
            "traffic.pull.incidents.lease-check-seconds", "22"));

        assertThat(props.incidents()).isEqualTo(new TrafficPullProps.Incidents(false, "offline-fixture", 777, 6, 22));
    }

    @Test
    void legacyIncidentConstructorRetainsTheLeaseCheckDefault() {
        assertThat(new TrafficPullProps.Incidents(true, "cdot", 900, 9).leaseCheckSeconds()).isEqualTo(60);
    }

}
