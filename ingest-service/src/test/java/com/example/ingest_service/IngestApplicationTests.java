package com.example.ingest_service;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.beans.factory.annotation.Autowired;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = "CDOT_VSL_POLL_SECONDS=30")
@ActiveProfiles("test")
class IngestApplicationTests {
    @Autowired CdotVariableSpeedProps signRefresh;

    @Test
    void legacyPollingConfigurationCannotOverrideTheSixHourDefault() {
        assertThat(signRefresh.refreshSeconds()).isEqualTo(21600);
        assertThat(signRefresh.requestSpacingSeconds()).isEqualTo(515);
    }

	@Test
	void contextLoads() {
	}

}
