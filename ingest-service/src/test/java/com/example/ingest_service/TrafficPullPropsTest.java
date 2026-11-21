package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;

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

    @Test
    void springBindsEveryIncidentOverride() {
        var props = bind(Map.of(
            "traffic.pull.incidents.enabled", "false",
            "traffic.pull.incidents.provider", "tomtom",
            "traffic.pull.incidents.poll-seconds", "777",
            "traffic.pull.incidents.tile-zoom", "6",
            "traffic.pull.incidents.lease-check-seconds", "22"));

        assertThat(props.incidents()).isEqualTo(new TrafficPullProps.Incidents(false, "tomtom", 777, 6, 22));
    }

    static TrafficPullProps bind(Map<String, String> values) {
        return new Binder(new MapConfigurationPropertySource(values))
            .bind("traffic.pull", Bindable.of(TrafficPullProps.class)).get();
    }
}
