package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.mile-marker-calibration")
public record TrafficMileMarkerCalibrationProps(
    boolean enabled,
    boolean runOnStartup,
    int lookbackHours,
    int batchSize
) {}
