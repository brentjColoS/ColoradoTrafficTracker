package com.example.api_service;

import java.time.Instant;

public interface TrafficHistoryCoverageProjection {
    Instant getFirstObservedAt();
    Instant getLastObservedAt();
    Instant getFirstZoneObservedAt();
    Instant getLastZoneObservedAt();
}
