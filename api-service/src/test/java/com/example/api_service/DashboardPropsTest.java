package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DashboardPropsTest {

    @Test
    void recordExposesPublicDataFlag() {
        DashboardProps props = new DashboardProps(true, 20);

        assertThat(props.publicDataEnabled()).isTrue();
        assertThat(props.providerStatusStaleAfterMinutes()).isEqualTo(20);
    }
}
