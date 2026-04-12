package com.example.ingest_service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public record TrafficStats(
    int sampleCount,
    Double avgSpeed,
    Double minSpeed,
    Double stddev,
    Double p10Speed,
    Double p50Speed,
    Double p90Speed
) {
    public static TrafficStats fromSpeeds(List<Double> input) {
        List<Double> speeds = input == null ? List.of() : input.stream().filter(v -> v != null).sorted(Comparator.naturalOrder()).toList();
        if (speeds.isEmpty()) {
            return new TrafficStats(0, null, null, null, null, null, null);
        }

        double sum = 0.0;
        for (double speed : speeds) sum += speed;
        double avg = sum / speeds.size();

        double sumSq = 0.0;
        for (double speed : speeds) {
            double delta = speed - avg;
            sumSq += delta * delta;
        }

        return new TrafficStats(
            speeds.size(),
            avg,
            speeds.get(0),
            speeds.size() > 1 ? Math.sqrt(sumSq / (speeds.size() - 1)) : 0.0,
            percentile(speeds, 0.10),
            percentile(speeds, 0.50),
            percentile(speeds, 0.90)
        );
    }

    private static Double percentile(List<Double> sortedValues, double quantile) {
        if (sortedValues.isEmpty()) return null;
        if (sortedValues.size() == 1) return sortedValues.get(0);

        double index = quantile * (sortedValues.size() - 1);
        int lower = (int) Math.floor(index);
        int upper = (int) Math.ceil(index);
        if (lower == upper) return sortedValues.get(lower);

        double weight = index - lower;
        return sortedValues.get(lower) + ((sortedValues.get(upper) - sortedValues.get(lower)) * weight);
    }
}
