package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class TrafficAnomalyAnalysisTest {
    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-10-07T12:00:00Z");
    private static final OffsetDateTime RECENT = NOW.minusMinutes(30);

    @Test
    void tenBaselineObservationsAreRequiredAndMissingValuesDoNotCount() {
        var samples = baseline().subList(0, 9);
        var input = new ArrayList<>(samples);
        input.add(sample(null, 60.0));
        input.add(sample(NOW.minusMinutes(45), null));
        input.add(sample(RECENT, 20.0));
        var result = analyze(input, 2.0, 3.0);
        assertEquals(9, result.baselineSampleCount());
        assertNull(result.baselineMean());
        assertEquals(0, result.checkedSamples());
        assertTrue(result.anomalies().isEmpty());
        assertEquals("Not enough baseline samples for anomaly detection", result.note());
    }

    @Test
    void usesSampleVarianceAndStrictZScoreBoundaryWhileIncludingTheRecentCutoff() {
        var samples = baseline();
        double std = Math.sqrt(250.0 / 9.0);
        double threshold = 60 - 2 * std;
        samples.add(sample(RECENT, threshold));
        samples.add(sample(NOW.minusMinutes(10), 40.0));
        var result = analyze(samples, 2.0, 3.0);
        assertEquals(10, result.baselineSampleCount());
        assertEquals(60.0, result.baselineMean());
        assertEquals(std, result.baselineStd(), 1e-12);
        assertEquals(2, result.checkedSamples());
        assertEquals(1, result.anomalies().size());
        assertEquals(40.0, result.anomalies().getFirst().observedSpeed());
        assertEquals(threshold, result.anomalies().getFirst().expectedMinimumSpeed(), 1e-12);
        assertEquals(20 / std, result.anomalies().getFirst().zScore(), 1e-12);
    }

    @Test
    void minimumDropIsInclusiveAndZeroVarianceRemainsUnavailableForZScores() {
        var samples = baseline(); samples.add(sample(NOW, 50.0));
        assertEquals(1, analyze(samples, 0.5, 10.0).anomalies().size());
        assertTrue(analyze(samples, 0.5, 10.01).anomalies().isEmpty());
        var flat = new ArrayList<TrafficHistorySample>();
        for (int i=0; i<10; i++) flat.add(sample(NOW.minusMinutes(40+i), 60.0));
        flat.add(sample(NOW, 20.0));
        var result = analyze(flat, 2.0, 3.0);
        assertEquals(1, result.checkedSamples());
        assertEquals(0.0, result.baselineStd());
        assertTrue(result.anomalies().isEmpty());
        assertEquals("Baseline variance is too small for z-score anomaly detection", result.note());
    }

    @Test
    void groupsChronologicallyAcrossTheExactGapAndKeepsStableEventIds() {
        var samples = baseline();
        samples.add(sample(NOW, 10.0));
        samples.add(sample(NOW.minusMinutes(7), 20.0));
        samples.add(sample(NOW.minusMinutes(4), 30.0));
        var result = analyze(samples, 2.0, 3.0);
        assertEquals(2, result.slowdownEvents().size());
        var first = result.slowdownEvents().getFirst();
        assertEquals("Slowdown-I25-20261007-1153-001", first.eventId());
        assertEquals(NOW.minusMinutes(7), first.startedAt());
        assertEquals(NOW.minusMinutes(4), first.endedAt());
        assertEquals(3, first.durationMinutes());
        assertEquals(2, first.sampleCount());
        assertEquals(20, first.minimumObservedSpeed());
        assertEquals(25, first.averageObservedSpeed());
        assertEquals(40, first.maximumDropMph());
        assertEquals("Slowdown-I25-20261007-1200-002", result.slowdownEvents().getLast().eventId());
    }

    @Test
    void sufficientHistoryStillExcludesMissingSpeedsAndOlderAnomalousObservations() {
        var samples = baseline();
        samples.add(sample(NOW.minusMinutes(90), 0.0));
        samples.add(sample(NOW, null));
        samples.add(sample(null, 20.0));
        samples.add(sample(NOW.minusMinutes(5), 20.0));
        var result = analyze(samples, 0.5, 3.0);
        assertEquals(11, result.baselineSampleCount());
        assertEquals(1, result.checkedSamples());
        assertEquals(1, result.anomalies().size());
        assertEquals(NOW.minusMinutes(5), result.anomalies().getFirst().polledAt());
    }

    private static TrafficAnomalyAnalysis.Assessment analyze(List<TrafficHistorySample> samples, double z, double drop) {
        return TrafficAnomalyAnalysis.analyze("I25", samples, RECENT, new TrafficAnomalyAnalysis.Thresholds(z, drop, 3));
    }

    private static ArrayList<TrafficHistorySample> baseline() {
        var result = new ArrayList<TrafficHistorySample>();
        for (int i=0; i<10; i++) result.add(sample(NOW.minusMinutes(40+i), i%2==0 ? 55.0 : 65.0));
        return result;
    }

    private static TrafficHistorySample sample(OffsetDateTime time, Double speed) {
        var result = new TrafficHistorySample(); result.setPolledAt(time); result.setAvgCurrentSpeed(speed); return result;
    }
}
