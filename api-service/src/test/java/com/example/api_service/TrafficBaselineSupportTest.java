package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.api_service.dto.TrafficBaselineProfileDto;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class TrafficBaselineSupportTest {

    @Test
    void profilesMatchDenverWeekdayAndHourWithModestRecencyWeighting() {
        OffsetDateTime weekStart = OffsetDateTime.of(2026, 9, 14, 6, 0, 0, 0, ZoneOffset.UTC);
        List<TrafficBaselineSupport.Observation> observations = new ArrayList<>();
        for (int weeksBack = 1; weeksBack <= 13; weeksBack += 1) {
            double speed = 72 - (weeksBack - 1) * 2;
            observations.add(new TrafficBaselineSupport.Observation(
                weekStart.minusWeeks(weeksBack).plusHours(8).toInstant(),
                speed
            ));
        }

        TrafficBaselineProfileDto mondayEight = TrafficBaselineSupport.buildProfiles(observations, weekStart)
            .stream()
            .filter(profile -> profile.dayOfWeek() == 1 && profile.hourOfDay() == 8)
            .findFirst()
            .orElseThrow();

        assertThat(mondayEight.sourceProfile()).isEqualTo("EXACT_DAY");
        assertThat(mondayEight.sampleCount()).isEqualTo(13);
        assertThat(mondayEight.meanSpeed()).isGreaterThan(60.0);
        assertThat(mondayEight.standardDeviation()).isPositive();
        assertThat(mondayEight.coverageTwoSigma()).isBetween(0.0, 100.0);
    }

    @Test
    void sparseExactDaysFallBackToTheirDayType() {
        OffsetDateTime weekStart = OffsetDateTime.of(2026, 9, 14, 6, 0, 0, 0, ZoneOffset.UTC);
        List<TrafficBaselineSupport.Observation> observations = new ArrayList<>();
        for (int weeksBack = 1; weeksBack <= 2; weeksBack += 1) {
            for (int day = 1; day <= 5; day += 1) {
                observations.add(observation(weekStart, weeksBack, day, 8, 58 + day * 2));
            }
        }

        TrafficBaselineProfileDto tuesdayEight = TrafficBaselineSupport.buildProfiles(observations, weekStart)
            .stream()
            .filter(profile -> profile.dayOfWeek() == 2 && profile.hourOfDay() == 8)
            .findFirst()
            .orElseThrow();

        assertThat(tuesdayEight.sourceProfile()).isEqualTo("DAY_TYPE_FALLBACK");
        assertThat(tuesdayEight.sampleCount()).isEqualTo(10);
    }

    @Test
    void isolatedOutliersHaveLimitedInfluenceOnTheWeeklyProfile() {
        OffsetDateTime weekStart = OffsetDateTime.of(2026, 9, 14, 6, 0, 0, 0, ZoneOffset.UTC);
        List<TrafficBaselineSupport.Observation> observations = new ArrayList<>();
        for (int weeksBack = 1; weeksBack <= 12; weeksBack += 1) {
            observations.add(observation(weekStart, weeksBack, 1, 8, 65));
        }
        observations.add(observation(weekStart, 13, 1, 8, 10));

        TrafficBaselineProfileDto profile = TrafficBaselineSupport.buildProfiles(observations, weekStart)
            .stream()
            .filter(candidate -> candidate.dayOfWeek() == 1 && candidate.hourOfDay() == 8)
            .findFirst()
            .orElseThrow();

        assertThat(profile.meanSpeed()).isBetween(64.0, 66.0);
        assertThat(profile.coverageTwoSigma()).isLessThan(100.0);
    }

    @Test
    void weekAnchorsUseDenverMondayAcrossDaylightSavingTime() {
        assertThat(TrafficBaselineSupport.denverWeekStart(
            OffsetDateTime.parse("2026-09-10T20:30:00Z")
        )).isEqualTo(OffsetDateTime.parse("2026-09-07T06:00:00Z"));
        assertThat(TrafficBaselineSupport.denverWeekStart(
            OffsetDateTime.parse("2026-01-15T20:30:00Z")
        )).isEqualTo(OffsetDateTime.parse("2026-01-12T07:00:00Z"));
    }

    private static TrafficBaselineSupport.Observation observation(
        OffsetDateTime weekStart,
        int dayOfWeek,
        int hour,
        double speed
    ) {
        return observation(weekStart, 1, dayOfWeek, hour, speed);
    }

    private static TrafficBaselineSupport.Observation observation(
        OffsetDateTime weekStart,
        int weeksBack,
        int dayOfWeek,
        int hour,
        double speed
    ) {
        return new TrafficBaselineSupport.Observation(
            weekStart.minusWeeks(weeksBack).plusDays(dayOfWeek - 1L).plusHours(hour).toInstant(),
            speed
        );
    }
}
