package com.example.api_service;

import java.util.Optional;
import org.springframework.data.domain.PageRequest;

final class LatestTrafficSamples {
    private LatestTrafficSamples() {}

    static Optional<TrafficSample> find(TrafficSampleRepository repository, String corridor, boolean preferUsable) {
        if (preferUsable) {
            var samples = repository.findLatestUsableByCorridor(corridor, PageRequest.of(0, 1));
            var usable = samples == null ? Optional.<TrafficSample>empty() : samples.stream().findFirst();
            if (usable.isPresent()) return usable;
        }
        return repository.findFirstByCorridorOrderByPolledAtDesc(corridor);
    }
}
