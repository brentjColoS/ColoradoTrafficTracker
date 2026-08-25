package com.example.ingest_service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TrafficSampleWriter {
    private final TrafficSampleRepository sampleRepo;
    private final TrafficSpeedZoneSampleRepository zoneSampleRepo;
    private final Counter samplesPersistedCounter;

    public TrafficSampleWriter(
        TrafficSampleRepository sampleRepo,
        TrafficSpeedZoneSampleRepository zoneSampleRepo,
        MeterRegistry meterRegistry
    ) {
        this.sampleRepo = sampleRepo;
        this.zoneSampleRepo = zoneSampleRepo;
        this.samplesPersistedCounter = Counter.builder("traffic.ingest.samples.persisted.total")
            .description("Total persisted traffic samples")
            .register(meterRegistry);
    }

    @Transactional
    public TrafficSample saveSample(TrafficSample sample) {
        return saveSampleWithZones(sample, List.of());
    }

    @Transactional
    public TrafficSample saveSampleWithZones(TrafficSample sample, List<TrafficSpeedZoneSample> zoneSamples) {
        sample.setIncidentsJson(null);
        TrafficSample saved = sampleRepo.save(sample);
        samplesPersistedCounter.increment();
        persistZoneSamples(saved, zoneSamples);
        return saved;
    }

    private void persistZoneSamples(TrafficSample sample, List<TrafficSpeedZoneSample> zoneSamples) {
        if (zoneSamples == null || zoneSamples.isEmpty()) return;
        for (TrafficSpeedZoneSample zoneSample : zoneSamples) {
            zoneSample.setSample(sample);
            zoneSample.setCorridor(sample.getCorridor());
            zoneSample.setPolledAt(sample.getPolledAt());
            if (zoneSample.getIngestedAt() == null) {
                zoneSample.setIngestedAt(sample.getIngestedAt());
            }
        }
        zoneSampleRepo.saveAll(zoneSamples);
    }
}
