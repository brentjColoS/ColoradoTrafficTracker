package com.example.ingest_service;

import com.example.common.I70VariableSpeedSigns;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.cdot-variable-speeds")
public record CdotVariableSpeedProps(boolean enabled, int refreshSeconds) {
    public int boundedRefreshSeconds() { return Math.max(3600, refreshSeconds); }
    public int requestSpacingSeconds() {
        return Math.ceilDiv(boundedRefreshSeconds(), I70VariableSpeedSigns.devices().size());
    }
}
