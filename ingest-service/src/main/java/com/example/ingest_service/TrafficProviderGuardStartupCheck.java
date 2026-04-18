package com.example.ingest_service;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class TrafficProviderGuardStartupCheck implements ApplicationRunner {

    private final TrafficProviderGuardService providerGuardService;
    private final TrafficProps trafficProps;

    public TrafficProviderGuardStartupCheck(
        TrafficProviderGuardService providerGuardService,
        TrafficProps trafficProps
    ) {
        this.providerGuardService = providerGuardService;
        this.trafficProps = trafficProps;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!trafficProps.startupValidationEnabled()) {
            return;
        }
        providerGuardService.verifyProviderAccessAtStartup(trafficProps.tomtomApiKey());
    }
}
