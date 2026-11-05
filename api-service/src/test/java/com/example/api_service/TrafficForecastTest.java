package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import org.junit.jupiter.api.Test;

class TrafficForecastTest {
    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-10-07T12:00:00Z");

    @Test
    void needsEightUsableSamplesAndFiltersMissingTimeAndSpeed() {
        var samples = series(40, 1); samples.removeLast();
        var noTime = new TrafficHistorySample(); noTime.setAvgCurrentSpeed(50.0); samples.add(noTime);
        var noSpeed = new TrafficHistorySample(); noSpeed.setPolledAt(NOW); samples.add(noSpeed);
        var result = TrafficForecast.predict(samples, NOW, 60, 15);
        assertEquals(7, result.sourceSamples());
        assertTrue(result.predictions().isEmpty());
        assertEquals("Not enough source samples for forecasting", result.note());
    }

    @Test
    void sortsObservationsWithoutMutatingInputAndKeepsTheMinimumBand() {
        var samples = series(40, 2); Collections.reverse(samples);
        var original = new ArrayList<>(samples);
        var result = TrafficForecast.predict(samples, NOW, 35, 15);
        assertEquals(original, samples);
        assertEquals(8, result.sourceSamples());
        assertEquals(3, result.predictions().size());
        for (int i=0; i<3; i++) {
            var point = result.predictions().get(i);
            assertEquals(NOW.plusMinutes(15L*(i+1)), point.timestamp());
            assertEquals(56+2*i, point.predictedSpeed(), 1e-12);
            assertEquals(54+2*i, point.lowerBoundSpeed(), 1e-12);
            assertEquals(58+2*i, point.upperBoundSpeed(), 1e-12);
        }
        assertNull(result.note());
    }

    @Test
    void repeatedTimestampsUseTheMeanWithoutDividingByZero() {
        var samples = series(50, 0); samples.forEach(sample -> sample.setPolledAt(NOW));
        samples.get(0).setAvgCurrentSpeed(42.0);
        samples.get(1).setAvgCurrentSpeed(48.0);
        samples.get(2).setAvgCurrentSpeed(60.0);
        var result = TrafficForecast.predict(samples, NOW, 15, 15);
        var point = result.predictions().getFirst();
        assertEquals(50, point.predictedSpeed());
        assertEquals(44.70849737787082, point.lowerBoundSpeed(), 1e-12);
        assertEquals(55.29150262212918, point.upperBoundSpeed(), 1e-12);
    }

    @Test
    void clampsPredictionsAndBothBandsToTheExistingSpeedRange() {
        for (int slope : new int[]{-2, 2}) {
            var result = TrafficForecast.predict(series(slope<0 ? 10 : 80, slope), NOW, 60, 15);
            var last = result.predictions().getLast();
            double expected = slope<0 ? 0 : 100;
            assertEquals(expected, last.predictedSpeed());
            assertEquals(slope<0 ? 0 : 98, last.lowerBoundSpeed());
            assertEquals(slope<0 ? 2 : 100, last.upperBoundSpeed());
        }
    }

    @Test
    void residualVariationWidensTheBandBeyondTheMinimum() {
        var samples = series(50, 1);
        double[] noise = {-4, 4, 4, -4, -4, 4, 4, -4};
        for (int i=0; i<8; i++) samples.get(i).setAvgCurrentSpeed(50+i+noise[i]);
        var point = TrafficForecast.predict(samples, NOW, 15, 15).predictions().getFirst();
        assertEquals(58, point.predictedSpeed(), 1e-12);
        assertEquals(53.381197846482994, point.lowerBoundSpeed(), 1e-12);
        assertEquals(62.618802153517006, point.upperBoundSpeed(), 1e-12);
    }

    private static ArrayList<TrafficHistorySample> series(double first, double increment) {
        var samples = new ArrayList<TrafficHistorySample>();
        for (int i=0; i<8; i++) {
            var sample = new TrafficHistorySample(); sample.setPolledAt(NOW.minusMinutes(105-15L*i));
            sample.setAvgCurrentSpeed(first+increment*i); samples.add(sample);
        }
        return samples;
    }
}
