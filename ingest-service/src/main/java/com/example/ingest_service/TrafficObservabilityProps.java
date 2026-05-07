package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.observability")
public record TrafficObservabilityProps(
    int ingestGapMinutes,
    int quotaWarnPercent,
    int quotaCriticalPercent,
    int providerNullCycleThreshold,
    int providerStaleCycleThreshold,
    int providerRecoveryProbeSeconds
) {
    public TrafficObservabilityProps {
        providerRecoveryProbeSeconds = Math.max(10, providerRecoveryProbeSeconds);
    }
}
