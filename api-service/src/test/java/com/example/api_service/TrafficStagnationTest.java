package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.api_service.dto.TrafficStagnationAssessmentDto;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.data.domain.PageImpl;

class TrafficStagnationTest {
    private static final ZoneId DENVER = ZoneId.of("America/Denver");

    @ParameterizedTest
    @CsvSource({
        "I25, 00:00:00, SMOOTH_EXPECTED", "I25, 05:59:59, SMOOTH_EXPECTED",
        "I25, 06:00:00, ACTIVE", "I25, 19:59:59, ACTIVE",
        "I25, 20:00:00, SHOULDER", "I25, 21:59:59, SHOULDER",
        "I25, 22:00:00, SMOOTH_EXPECTED", "I25, 23:59:59, SMOOTH_EXPECTED",
        "I70, 00:00:00, ACTIVE", "I70, 05:59:59, ACTIVE",
        "I70, 06:00:00, SHOULDER", "I70, 14:59:59, SHOULDER",
        "I70, 15:00:00, ACTIVE", "I70, 17:59:59, ACTIVE",
        "I70, 18:00:00, SMOOTH_EXPECTED", "I70, 21:59:59, SMOOTH_EXPECTED",
        "I70, 22:00:00, SHOULDER", "I70, 23:59:59, SHOULDER"
    })
    void scheduleFollowsDenverTimeInWinterAndSummer(String corridor, String time, String mode) {
        for (String date : List.of("2026-01-15", "2026-07-15")) {
            var local = LocalDate.parse(date).atTime(LocalTime.parse(time)).atZone(DENVER).toOffsetDateTime();
            for (ZoneOffset offset : List.of(ZoneOffset.UTC, ZoneOffset.ofHours(9))) {
                var now = local.withOffsetSameInstant(offset);
                var assessment = assess(corridor, now, List.of(), false);
                assertThat(assessment.operatingMode()).as("%s at %s", corridor, now).isEqualTo(mode);
                assertThat(assessment.eventActive()).isFalse();
            }
        }
    }

    @ParameterizedTest
    @CsvSource({
        "I25, 2026-03-08T08:59:59Z, SMOOTH_EXPECTED",
        "I25, 2026-03-08T09:00:00Z, SMOOTH_EXPECTED",
        "I25, 2026-03-08T12:00:00Z, ACTIVE",
        "I70, 2026-03-08T08:59:59Z, ACTIVE",
        "I70, 2026-03-08T09:00:00Z, ACTIVE",
        "I70, 2026-03-08T12:00:00Z, SHOULDER",
        "I25, 2026-11-01T07:30:00Z, SMOOTH_EXPECTED",
        "I25, 2026-11-01T08:30:00Z, SMOOTH_EXPECTED",
        "I70, 2026-11-01T07:30:00Z, ACTIVE",
        "I70, 2026-11-01T08:30:00Z, ACTIVE"
    })
    void daylightSavingTransitionsKeepTheCorridorSchedule(String corridor, String instant, String mode) {
        assertThat(assess(corridor, OffsetDateTime.parse(instant), List.of(), false).operatingMode())
            .isEqualTo(mode);
    }

    @ParameterizedTest
    @CsvSource({
        "I25, 12:00, 45", "I25, 20:00, 75", "I25, 23:00, 150",
        "I70, 02:00, 60", "I70, 10:00, 90", "I70, 19:00, 180"
    })
    void criticalRepeatedRunsRespectEachCorridorsScheduledThreshold(String corridor, String time, int minutes) {
        var now = denverTime(time);
        var before = assess(corridor, now, flatHistory(now, minutes - 1), false);
        var boundary = assess(corridor, now, flatHistory(now, minutes), false);
        assertThat(before.severity()).isEqualTo("WARN");
        assertThat(before.signalState()).isEqualTo("WATCH");
        assertThat(boundary.flatRunMinutes()).isEqualTo(minutes);
        assertThat(boundary.severity()).isEqualTo("CRITICAL");
        assertThat(boundary.signalState()).isEqualTo("STAGNATION_ALERT");
    }

    @ParameterizedTest
    @CsvSource({"I25, 23:00, 45", "I70, 19:00, 60"})
    void risingIncidentsApplyActiveThresholdsDuringSmoothHours(String corridor, String time, int minutes) {
        var now = denverTime(time);
        var history = flatHistory(now, minutes);
        assertThat(assess(corridor, now, history, false).severity()).isEqualTo("WARN");
        var event = assess(corridor, now, history, true);
        assertThat(event.operatingMode()).isEqualTo("EVENT_ACTIVE");
        assertThat(event.eventActive()).isTrue();
        assertThat(event.severity()).isEqualTo("CRITICAL");
        assertThat(event.note()).contains("incident threads rose from 0 to 2");
    }

    @ParameterizedTest
    @CsvSource({"I25, 12:00, 45", "I70, 02:00, 60"})
    void elevenSamplesAreWarmingUpAndTwelveCanRaiseAnAlert(String corridor, String time, int minutes) {
        var now = denverTime(time);
        for (int count : List.of(11, 12)) {
            var history = new ArrayList<TrafficHistorySample>();
            for (int index = 0; index < count; index++) {
                history.add(sample(now.minusSeconds((long) index * minutes * 60 / (count - 1)), 60));
            }
            var result = assess(corridor, now, history, false);
            assertThat(result.recentUsableSampleCount60m()).isEqualTo(count);
            assertThat(result.severity()).isEqualTo(count == 11 ? "NORMAL" : "CRITICAL");
            if (count == 11) assertThat(result.note()).contains("warming up");
        }
    }

    @ParameterizedTest
    @CsvSource({
        "I25, 12:00, 15, NORMAL, INFO", "I70, 02:00, 20, NORMAL, INFO",
        "I25, 20:00, 25, NORMAL, INFO", "I70, 10:00, 30, NORMAL, INFO",
        "I25, 23:00, 45, NORMAL, INFO",
        "I25, 12:00, 30, INFO, WARN", "I70, 02:00, 40, INFO, WARN",
        "I25, 20:00, 45, INFO, WARN"
    })
    void flatRunBoundariesEscalateOtherwiseChangingHistory(
        String corridor, String time, int minutes, String before, String boundary
    ) {
        var now = denverTime(time);
        assertThat(assess(corridor, now, flatThenChangingHistory(now, minutes - 1), false).severity())
            .isEqualTo(before);
        assertThat(assess(corridor, now, flatThenChangingHistory(now, minutes), false).severity())
            .isEqualTo(boundary);
    }

    @ParameterizedTest
    @CsvSource({
        "I25, 12:00, 7, NORMAL", "I25, 12:00, 6, INFO", "I25, 12:00, 4, INFO", "I25, 12:00, 3, WARN",
        "I70, 02:00, 6, NORMAL", "I70, 02:00, 5, INFO", "I70, 02:00, 4, INFO", "I70, 02:00, 3, WARN",
        "I25, 20:00, 5, NORMAL", "I25, 20:00, 4, INFO", "I25, 20:00, 3, INFO", "I25, 20:00, 2, WARN",
        "I70, 10:00, 5, NORMAL", "I70, 10:00, 4, INFO", "I70, 10:00, 3, INFO", "I70, 10:00, 2, WARN",
        "I25, 23:00, 3, NORMAL", "I25, 23:00, 2, INFO", "I25, 23:00, 1, WARN",
        "I70, 19:00, 3, NORMAL", "I70, 19:00, 2, INFO", "I70, 19:00, 1, WARN"
    })
    void distinctAveragesUseTheScheduledBaseline(String corridor, String time, int distinct, String severity) {
        var now = denverTime(time);
        var history = new ArrayList<TrafficHistorySample>();
        for (int index = 0; index < 12; index++) {
            history.add(sample(now.minusMinutes(index), 60 + index % distinct));
        }
        var result = assess(corridor, now, history, false);
        assertThat(result.distinctAverageCount60m()).isEqualTo(distinct);
        assertThat(result.severity()).isEqualTo(severity);
    }

    @ParameterizedTest
    @CsvSource({"2, CRITICAL", "3, WARN"})
    void activeI25CriticalRunAlsoRequiresFewDistinctAverages(int distinct, String severity) {
        var now = denverTime("12:00");
        var history = new ArrayList<TrafficHistorySample>();
        for (int minute = 0; minute <= 60; minute++) {
            history.add(sample(now.minusMinutes(minute), minute <= 45 ? 60 : 61 + minute % (distinct - 1)));
        }
        var result = assess("I25", now, history, false);
        assertThat(result.flatRunMinutes()).isEqualTo(45);
        assertThat(result.distinctAverageCount60m()).isEqualTo(distinct);
        assertThat(result.severity()).isEqualTo(severity);
    }

    @ParameterizedTest
    @CsvSource({
        "I25, 12:00, 20, 16, INFO", "I70, 02:00, 20, 17, INFO",
        "I25, 20:00, 25, 22, NORMAL", "I70, 10:00, 20, 18, INFO",
        "I25, 23:00, 20, 19, NORMAL", "I70, 19:00, 100, 97, NORMAL"
    })
    void repeatedStepRatioRaisesWatchAtTheScheduledBoundary(
        String corridor, String time, int comparisons, int repeated, String before
    ) {
        var now = denverTime(time);
        for (int steps : List.of(repeated - 1, repeated)) {
            var history = new ArrayList<TrafficHistorySample>();
            for (int index = 0; index <= comparisons; index++) {
                history.add(sample(now.minusSeconds(index * 30L), index <= steps ? 60 : 60 + index - steps));
            }
            var result = assess(corridor, now, history, false);
            assertThat(result.repeatedStepRatio60m()).isEqualTo((double) steps / comparisons);
            assertThat(result.severity()).isEqualTo(steps < repeated ? before : "WARN");
        }
    }

    private static OffsetDateTime denverTime(String time) {
        return LocalDate.of(2026, 1, 15).atTime(LocalTime.parse(time)).atZone(DENVER).toOffsetDateTime();
    }

    private static List<TrafficHistorySample> flatHistory(OffsetDateTime now, int minutes) {
        var samples = new ArrayList<TrafficHistorySample>();
        for (int minute = 0; minute <= minutes; minute++) {
            samples.add(sample(now.minusMinutes(minute), 60));
        }
        return samples;
    }

    private static List<TrafficHistorySample> flatThenChangingHistory(OffsetDateTime now, int flatMinutes) {
        var samples = new ArrayList<TrafficHistorySample>();
        for (int minute = 0; minute <= 60; minute++) {
            samples.add(sample(now.minusMinutes(minute), minute <= flatMinutes ? 60 : 61 + minute));
        }
        return samples;
    }

    private static TrafficHistorySample sample(OffsetDateTime time, double speed) {
        var sample = new TrafficHistorySample();
        sample.setPolledAt(time);
        sample.setAvgCurrentSpeed(speed);
        return sample;
    }

    private static TrafficStagnationAssessmentDto assess(
        String corridor, OffsetDateTime now, List<TrafficHistorySample> samples, boolean incidentRise
    ) {
        var history = mock(TrafficHistorySampleRepository.class);
        var incidents = mock(IncidentEventAnalyticsRepository.class);
        when(history.findUsableByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq(corridor), any(), any()))
            .thenReturn(new PageImpl<>(samples));
        when(incidents.countEventsOverlapping(corridor, now.minusMinutes(30), now))
            .thenReturn(incidentRise ? 2L : 0L);
        return new TrafficStagnation(history, incidents).assess(corridor, now, null).toDto();
    }
}
