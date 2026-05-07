package com.example.ingest_service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class TrafficProviderRecoveryProbe {

    private final TrafficProviderGuardService providerGuardService;
    private final TrafficProps trafficProps;

    public TrafficProviderRecoveryProbe(
        TrafficProviderGuardService providerGuardService,
        TrafficProps trafficProps
    ) {
        this.providerGuardService = providerGuardService;
        this.trafficProps = trafficProps;
    }

    @Scheduled(
        initialDelayString = "#{${traffic.observability.providerRecoveryProbeSeconds:60} * 1000}",
        fixedDelayString = "#{${traffic.observability.providerRecoveryProbeSeconds:60} * 1000}"
    )
    public void probeRecoveringProvider() {
        providerGuardService.attemptRecoveryProbe(trafficProps.tomtomApiKey());
    }
}
