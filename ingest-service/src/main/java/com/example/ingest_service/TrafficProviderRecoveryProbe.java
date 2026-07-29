package com.example.ingest_service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class TrafficProviderRecoveryProbe {

    private final TrafficProviderGuardService providerGuardService;

    public TrafficProviderRecoveryProbe(TrafficProviderGuardService providerGuardService) {
        this.providerGuardService = providerGuardService;
    }

    @Scheduled(
        initialDelayString = "#{${traffic.observability.providerRecoveryProbeSeconds:60} * 1000}",
        fixedDelayString = "#{${traffic.observability.providerRecoveryProbeSeconds:60} * 1000}"
    )
    public void probeRecoveringProvider() {
        providerGuardService.attemptRecoveryProbe();
    }
}
