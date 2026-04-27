package com.example.ingest_service;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TrafficProviderGuardStartupCheckTest {

    @Mock
    private TrafficProviderGuardService providerGuardService;

    @Test
    void skipsStartupValidationWhenDisabled() {
        TrafficProviderGuardStartupCheck check = new TrafficProviderGuardStartupCheck(
            providerGuardService,
            new TrafficProps("test-key", 60, "tile", 10, "", 4, 500.0, 35_000, 38_000, 40_000, false)
        );

        check.run(null);

        verify(providerGuardService, never()).verifyProviderAccessAtStartup("test-key");
    }

    @Test
    void runsStartupValidationWhenEnabled() {
        TrafficProviderGuardStartupCheck check = new TrafficProviderGuardStartupCheck(
            providerGuardService,
            new TrafficProps("test-key", 60, "tile", 10, "", 4, 500.0, 35_000, 38_000, 40_000, true)
        );

        check.run(null);

        verify(providerGuardService).verifyProviderAccessAtStartup("test-key");
    }
}
