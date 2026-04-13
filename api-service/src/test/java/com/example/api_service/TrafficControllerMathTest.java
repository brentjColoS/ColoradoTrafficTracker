package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class TrafficControllerMathTest {

    @Test
    void stdDevUsesSampleStandardDeviationFormula() throws Exception {
        List<Double> values = List.of(2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0);

        double stdDev = (double) invokeStatic("stdDev", new Class<?>[]{List.class, double.class}, values, 5.0);

        assertThat(stdDev).isCloseTo(2.1380899353, org.assertj.core.data.Offset.offset(1e-9));
    }

    @Test
    void linearFitReturnsExpectedSlopeAndIntercept() throws Exception {
        OffsetDateTime base = OffsetDateTime.of(2026, 4, 10, 12, 0, 0, 0, ZoneOffset.UTC);
        List<TrafficHistorySample> samples = List.of(
            historySample(40.0, base),
            historySample(50.0, base.plusMinutes(10)),
            historySample(60.0, base.plusMinutes(20))
        );

        double[] fit = (double[]) invokeStatic("linearFit", new Class<?>[]{List.class}, samples);

        assertThat(fit[0]).isCloseTo(1.0, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(fit[1]).isCloseTo(40.0, org.assertj.core.data.Offset.offset(1e-9));
    }

    @Test
    void linearFitHandlesDegenerateDenominatorByReturningMeanIntercept() throws Exception {
        OffsetDateTime sameTime = OffsetDateTime.of(2026, 4, 10, 12, 0, 0, 0, ZoneOffset.UTC);
        List<TrafficHistorySample> samples = List.of(
            historySample(42.0, sameTime),
            historySample(48.0, sameTime),
            historySample(60.0, sameTime)
        );

        double[] fit = (double[]) invokeStatic("linearFit", new Class<?>[]{List.class}, samples);

        assertThat(fit[0]).isCloseTo(0.0, org.assertj.core.data.Offset.offset(1e-9));
        assertThat(fit[1]).isCloseTo(50.0, org.assertj.core.data.Offset.offset(1e-9));
    }

    @Test
    void residualStdDevCalculatesFromFitResiduals() throws Exception {
        OffsetDateTime base = OffsetDateTime.of(2026, 4, 10, 12, 0, 0, 0, ZoneOffset.UTC);
        List<TrafficHistorySample> samples = List.of(
            historySample(40.0, base),
            historySample(50.0, base.plusMinutes(10)),
            historySample(63.0, base.plusMinutes(20))
        );

        double residualStdDev = (double) invokeStatic(
            "residualStdDev",
            new Class<?>[]{List.class, double.class, double.class},
            samples,
            1.0,
            40.0
        );

        assertThat(residualStdDev).isCloseTo(3.0, org.assertj.core.data.Offset.offset(1e-9));
    }

    @Test
    void residualStdDevReturnsZeroWhenFewerThanThreeSamples() throws Exception {
        OffsetDateTime base = OffsetDateTime.of(2026, 4, 10, 12, 0, 0, 0, ZoneOffset.UTC);
        List<TrafficHistorySample> samples = List.of(
            historySample(40.0, base),
            historySample(50.0, base.plusMinutes(10))
        );

        double residualStdDev = (double) invokeStatic(
            "residualStdDev",
            new Class<?>[]{List.class, double.class, double.class},
            samples,
            1.0,
            40.0
        );

        assertThat(residualStdDev).isZero();
    }

    @Test
    void clampSpeedRestrictsRangeToZeroThroughHundred() throws Exception {
        double low = (double) invokeStatic("clampSpeed", new Class<?>[]{double.class}, -1.0);
        double within = (double) invokeStatic("clampSpeed", new Class<?>[]{double.class}, 64.25);
        double high = (double) invokeStatic("clampSpeed", new Class<?>[]{double.class}, 120.0);

        assertThat(low).isEqualTo(0.0);
        assertThat(within).isEqualTo(64.25);
        assertThat(high).isEqualTo(100.0);
    }

    private static Object invokeStatic(String name, Class<?>[] parameterTypes, Object... args) throws Exception {
        Method method = TrafficController.class.getDeclaredMethod(name, parameterTypes);
        method.setAccessible(true);
        return method.invoke(null, args);
    }

    private static TrafficHistorySample historySample(double speed, OffsetDateTime polledAt) {
        TrafficHistorySample sample = new TrafficHistorySample();
        sample.setCorridor("I25");
        sample.setAvgCurrentSpeed(speed);
        sample.setPolledAt(polledAt);
        sample.setSourceMode("tile");
        sample.setIncidentCount(0);
        sample.setIngestedAt(polledAt.plusSeconds(30));
        sample.setIsArchived(false);
        return sample;
    }
}
