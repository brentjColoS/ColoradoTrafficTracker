package com.example.api_service;

import com.example.api_service.dto.ForecastPointDto;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;

final class TrafficForecast {
    private TrafficForecast() {}

    static Forecast predict(List<TrafficHistorySample> samples, OffsetDateTime now,
                            int horizonMinutes, int stepMinutes) {
        List<TrafficHistorySample> recent = samples.stream()
            .filter(s -> s.getPolledAt() != null && s.getAvgCurrentSpeed() != null)
            .sorted(Comparator.comparing(TrafficHistorySample::getPolledAt))
            .toList();

        if (recent.size() < 8) {
            return new Forecast(recent.size(), List.of(), "Not enough source samples for forecasting");
        }

        double[] fit = linearFit(recent);
        double slopePerMinute = fit[0];
        double intercept = fit[1];
        double residualStd = residualStdDev(recent, slopePerMinute, intercept);

        int horizonSteps = Math.max(1, (int) Math.ceil((double) horizonMinutes / stepMinutes));
        long baseMinute = recent.get(0).getPolledAt().toEpochSecond() / 60;

        List<ForecastPointDto> predictions = java.util.stream.IntStream.rangeClosed(1, horizonSteps)
            .mapToObj(step -> {
                OffsetDateTime ts = now.plusMinutes((long) step * stepMinutes);
                long x = (ts.toEpochSecond() / 60) - baseMinute;
                double predicted = clampSpeed((slopePerMinute * x) + intercept);
                double band = Math.max(2.0, residualStd);
                return new ForecastPointDto(
                    ts,
                    predicted,
                    clampSpeed(predicted - band),
                    clampSpeed(predicted + band)
                );
            })
            .toList();

        return new Forecast(recent.size(), predictions, null);
    }

    record Forecast(int sourceSamples, List<ForecastPointDto> predictions, String note) {}

    private static double[] linearFit(List<TrafficHistorySample> samples) {
        long baseMinute = samples.get(0).getPolledAt().toEpochSecond() / 60;
        double sumX = 0.0;
        double sumY = 0.0;
        double sumXY = 0.0;
        double sumXX = 0.0;

        for (TrafficHistorySample sample : samples) {
            double x = (sample.getPolledAt().toEpochSecond() / 60) - baseMinute;
            double y = sample.getAvgCurrentSpeed();
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }

        double n = samples.size();
        double denominator = (n * sumXX) - (sumX * sumX);
        if (Math.abs(denominator) < 1e-9) {
            return new double[]{0.0, sumY / n};
        }

        double slope = ((n * sumXY) - (sumX * sumY)) / denominator;
        double intercept = (sumY - (slope * sumX)) / n;
        return new double[]{slope, intercept};
    }

    private static double residualStdDev(List<TrafficHistorySample> samples, double slope, double intercept) {
        if (samples.size() < 3) return 0.0;
        long baseMinute = samples.get(0).getPolledAt().toEpochSecond() / 60;
        double sumSq = 0.0;
        for (TrafficHistorySample sample : samples) {
            double x = (sample.getPolledAt().toEpochSecond() / 60) - baseMinute;
            double predicted = (slope * x) + intercept;
            double delta = sample.getAvgCurrentSpeed() - predicted;
            sumSq += delta * delta;
        }
        return Math.sqrt(sumSq / (samples.size() - 2));
    }

    private static double clampSpeed(double speed) {
        if (speed < 0.0) return 0.0;
        if (speed > 100.0) return 100.0;
        return speed;
    }
}
