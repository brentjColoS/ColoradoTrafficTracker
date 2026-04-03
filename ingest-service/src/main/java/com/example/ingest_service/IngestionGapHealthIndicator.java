package com.example.ingest_service;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

@Component("ingestionGap")
public class IngestionGapHealthIndicator implements HealthIndicator {

    private final TrafficSampleRepository sampleRepository;
    private final TrafficObservabilityProps observabilityProps;

    public IngestionGapHealthIndicator(
        TrafficSampleRepository sampleRepository,
        TrafficObservabilityProps observabilityProps
    ) {
        this.sampleRepository = sampleRepository;
        this.observabilityProps = observabilityProps;
    }

    @Override
    public Health health() {
        Optional<TrafficSample> latest = sampleRepository.findTopByOrderByPolledAtDesc();
        if (latest.isEmpty()) {
            return Health.unknown()
                .withDetail("reason", "No traffic samples persisted yet")
                .build();
        }

        OffsetDateTime latestPolledAt = latest.get().getPolledAt();
        long ageMinutes = Math.max(0, Duration.between(latestPolledAt, OffsetDateTime.now(ZoneOffset.UTC)).toMinutes());
        int threshold = Math.max(1, observabilityProps.ingestGapMinutes());

        Health.Builder builder = ageMinutes > threshold ? Health.outOfService() : Health.up();
        return builder
            .withDetail("latestSamplePolledAt", latestPolledAt)
            .withDetail("ageMinutes", ageMinutes)
            .withDetail("thresholdMinutes", threshold)
            .build();
    }
}
