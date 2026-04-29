package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.example.api_service.dto.TrafficDashboardSummaryDto;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;

@ExtendWith(MockitoExtension.class)
class TrafficDashboardControllerLogicTest {

    @Mock
    private TrafficSampleRepository sampleRepository;

    @Mock
    private TrafficHistorySampleRepository historyRepository;

    @Mock
    private TrafficAnalyticsRepository analyticsRepository;

    @Mock
    private TrafficHistoryIncidentRepository incidentRepository;

    @Mock
    private TrafficProviderGuardStatusRepository statusRepository;

    @Mock
    private ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider;

    private TrafficDashboardController controller;

    @BeforeEach
    void setUp() {
        controller = new TrafficDashboardController(
            sampleRepository,
            historyRepository,
            analyticsRepository,
            incidentRepository,
            statusRepositoryProvider,
            new DashboardProps(true, 20)
        );
        when(statusRepositoryProvider.getIfAvailable()).thenReturn(statusRepository);
    }

    @Test
    void summaryAddsOperationalNotesWhenFeedIsStaleAndStillWarmingUp() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficSample latest = sample("I25", 61.0, 54.0, now.minusMinutes(185), "tile");

        when(sampleRepository.findLatestUsableByCorridor(eq("I25"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of());
        when(sampleRepository.findFirstByCorridorOrderByPolledAtDesc("I25"))
            .thenReturn(Optional.of(latest));
        when(analyticsRepository.summarizeCorridorWithSpeed(eq("I25"), any()))
            .thenReturn(List.of());
        when(analyticsRepository.findHotspotsByCorridor(eq("I25"), any(), eq(10)))
            .thenReturn(List.of());
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(eq("I25"), any()))
            .thenReturn(8L, 0L, 0L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(eq("I25"), any()))
            .thenReturn(8L);
        when(incidentRepository.countDistinctReferencesByCorridorAndPolledAtGreaterThanEqual(eq("I25"), any()))
            .thenReturn(2L);
        when(historyRepository.findUsableByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I25"), any(), eq(PageRequest.of(0, 240))))
            .thenReturn(new PageImpl<>(List.of(
                historySample("I25", 61.0, 54.0, now.minusMinutes(5), "sig-a", "sem-a", false, null),
                historySample("I25", 61.0, 54.0, now.minusMinutes(20), "sig-a", "sem-a", false, null),
                historySample("I25", 60.5, 53.5, now.minusMinutes(35), "sig-b", "sem-b", false, null),
                historySample("I25", 60.0, 53.0, now.minusMinutes(50), "sig-c", "sem-c", false, null),
                historySample("I25", 59.5, 52.5, now.minusMinutes(65), "sig-d", "sem-d", false, null)
            )));

        TrafficProviderGuardStatus status = new TrafficProviderGuardStatus();
        status.setProviderName("tomtom");
        status.setState("HEALTHY");
        status.setLastCheckedAt(now.minusMinutes(30));
        status.setLastSuccessAt(now.minusMinutes(30));
        when(statusRepository.findById("tomtom")).thenReturn(Optional.of(status));

        ResponseEntity<TrafficDashboardSummaryDto> response = controller.summary("I25", 168, 720, true);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        TrafficDashboardSummaryDto body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.providerStatus().freshnessState()).isEqualTo("STALE");
        assertThat(body.sampleAgeMinutes()).isGreaterThan(180);
        assertThat(body.notes()).anyMatch(note -> note.contains("Tile-mode sampling is active"));
        assertThat(body.notes()).anyMatch(note -> note.contains("Provider guard status is stale"));
        assertThat(body.notes()).anyMatch(note -> note.contains("outside the expected live window"));
        assertThat(body.notes()).anyMatch(note -> note.contains("Rolling corridor analytics are not available yet"));
        assertThat(body.notes()).anyMatch(note -> note.contains("fall back to corridor and direction only"));
        assertThat(body.stagnationAssessment().note()).contains("warming up");
        assertThat(body.stagnationAssessment().recentUsableSampleCount60m()).isEqualTo(4);
    }

    @Test
    void summaryElevatesEventActiveWhenIncidentsRiseAndSpeedDrops() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficSample latest = sample("I70", 61.5, 44.0, now.minusMinutes(4), "tile");

        when(sampleRepository.findLatestUsableByCorridor(eq("I70"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(latest));
        when(analyticsRepository.summarizeCorridorWithSpeed(eq("I70"), any()))
            .thenReturn(List.of(corridorSummary("I70", 72.0, 47.0, 14L)));
        when(analyticsRepository.findHotspotsByCorridor(eq("I70"), any(), eq(10)))
            .thenReturn(List.of());
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(eq("I70"), any()))
            .thenReturn(12L, 12L, 13L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(eq("I70"), any()))
            .thenReturn(0L);
        when(incidentRepository.countDistinctReferencesByCorridorAndPolledAtGreaterThanEqual(eq("I70"), any()))
            .thenReturn(9L);
        when(historyRepository.findUsableByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I70"), any(), eq(PageRequest.of(0, 240))))
            .thenReturn(new PageImpl<>(eventActiveHistory(now)));
        when(statusRepository.findById("tomtom")).thenReturn(Optional.empty());

        ResponseEntity<TrafficDashboardSummaryDto> response = controller.summary("I70", 24, 720, true);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        TrafficDashboardSummaryDto body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.stagnationAssessment().eventActive()).isTrue();
        assertThat(body.stagnationAssessment().operatingMode()).isEqualTo("EVENT_ACTIVE");
        assertThat(body.stagnationAssessment().signalState()).isEqualTo("EVENT_ACTIVE");
        assertThat(body.stagnationAssessment().minimumSpeedDeltaFrom2hAverage()).isLessThanOrEqualTo(-8.0);
        assertThat(body.stagnationAssessment().averageSpeedShift15m()).isLessThanOrEqualTo(-3.0);
        assertThat(body.stagnationAssessment().note()).contains("Event-active monitoring is in effect because");
        assertThat(body.stagnationAssessment().note()).contains("incident activity rose");
        assertThat(body.stagnationAssessment().note()).contains("average speed shifted");
    }

    @Test
    void summaryReportsCriticalRepeatedStateWhenSpeedSignatureStallsForHours() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficSample latest = sample("I70", 65.7, 55.9, now.minusMinutes(2), "tile");

        when(sampleRepository.findLatestUsableByCorridor(eq("I70"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(latest));
        when(analyticsRepository.summarizeCorridorWithSpeed(eq("I70"), any()))
            .thenReturn(List.of(corridorSummary("I70", 65.7, 55.9, 4L)));
        when(analyticsRepository.findHotspotsByCorridor(eq("I70"), any(), eq(10)))
            .thenReturn(List.of());
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(eq("I70"), any()))
            .thenReturn(0L, 0L, 0L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(eq("I70"), any()))
            .thenReturn(0L);
        when(incidentRepository.countDistinctReferencesByCorridorAndPolledAtGreaterThanEqual(eq("I70"), any()))
            .thenReturn(0L);
        when(historyRepository.findUsableByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I70"), any(), eq(PageRequest.of(0, 240))))
            .thenReturn(new PageImpl<>(flatHistory(now, 100, 2, 65.7, 55.9, "sig-flat", "sem-flat")));
        when(statusRepository.findById("tomtom")).thenReturn(Optional.empty());

        TrafficDashboardSummaryDto body = controller.summary("I70", 168, 720, true).getBody();

        assertThat(body).isNotNull();
        assertThat(body.stagnationAssessment().signalState()).isEqualTo("STAGNATION_ALERT");
        assertThat(body.stagnationAssessment().severity()).isEqualTo("CRITICAL");
        assertThat(body.stagnationAssessment().flatRunMinutes()).isGreaterThanOrEqualTo(180);
        assertThat(body.stagnationAssessment().distinctAverageCount60m()).isEqualTo(1);
        assertThat(body.stagnationAssessment().semanticFlowStable()).isTrue();
        assertThat(body.stagnationAssessment().note()).contains("repeated speed state");
    }

    @Test
    void summaryPrefersLocalizedSlowdownNarrativeWhenTailMovesUnderStableMainline() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficSample latest = sample("I70", 65.7, 55.9, now.minusMinutes(3), "tile");
        latest.setLocalizedSlowdown(true);
        latest.setLocalizedSlowdownNote("Localized slowdown near MM 241.9 is holding below the corridor average.");

        when(sampleRepository.findLatestUsableByCorridor(eq("I70"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(latest));
        when(analyticsRepository.summarizeCorridorWithSpeed(eq("I70"), any()))
            .thenReturn(List.of(corridorSummary("I70", 65.7, 55.9, 4L)));
        when(analyticsRepository.findHotspotsByCorridor(eq("I70"), any(), eq(10)))
            .thenReturn(List.of());
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(eq("I70"), any()))
            .thenReturn(0L, 0L, 0L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(eq("I70"), any()))
            .thenReturn(0L);
        when(incidentRepository.countDistinctReferencesByCorridorAndPolledAtGreaterThanEqual(eq("I70"), any()))
            .thenReturn(0L);
        when(historyRepository.findUsableByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I70"), any(), eq(PageRequest.of(0, 240))))
            .thenReturn(new PageImpl<>(flatHistory(now, 20, 3, 65.7, 55.9, "sig-flat", "sem-flat")
                .stream()
                .peek(sample -> {
                    sample.setLocalizedSlowdown(true);
                    sample.setLocalizedSlowdownNote("Localized slowdown near MM 241.9 is holding below the corridor average.");
                })
                .toList()));
        when(statusRepository.findById("tomtom")).thenReturn(Optional.empty());

        TrafficDashboardSummaryDto body = controller.summary("I70", 24, 720, true).getBody();

        assertThat(body).isNotNull();
        assertThat(body.stagnationAssessment().localizedSlowdown()).isTrue();
        assertThat(body.stagnationAssessment().note())
            .contains("Localized slowdown near MM 241.9")
            .contains("decoded mainline speed state is otherwise holding steady");
    }

    private static List<TrafficHistorySample> eventActiveHistory(OffsetDateTime now) {
        List<TrafficHistorySample> samples = new ArrayList<>();
        for (int index = 0; index < 20; index++) {
            double avg = index < 5 ? 63.0 + (index * 0.1) : 67.0 + ((index % 4) * 0.6);
            double min = index < 5 ? 44.0 + (index * 0.2) : 58.0 + ((index % 5) * 0.5);
            samples.add(historySample(
                "I70",
                avg,
                min,
                now.minusMinutes(index * 4L),
                "sig-" + index,
                "sem-" + (index % 3),
                false,
                null
            ));
        }
        return samples;
    }

    private static List<TrafficHistorySample> flatHistory(
        OffsetDateTime now,
        int rows,
        int spacingMinutes,
        double avgCurrentSpeed,
        double minCurrentSpeed,
        String speedSignature,
        String semanticSignature
    ) {
        List<TrafficHistorySample> samples = new ArrayList<>();
        for (int index = 0; index < rows; index++) {
            samples.add(historySample(
                "I70",
                avgCurrentSpeed,
                minCurrentSpeed,
                now.minusMinutes((long) index * spacingMinutes),
                speedSignature,
                semanticSignature,
                false,
                null
            ));
        }
        return samples;
    }

    private static TrafficSample sample(String corridor, double avgCurrentSpeed, double minCurrentSpeed, OffsetDateTime polledAt, String sourceMode) {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(corridor);
        sample.setAvgCurrentSpeed(avgCurrentSpeed);
        sample.setAvgFreeflowSpeed(avgCurrentSpeed + 8.0);
        sample.setMinCurrentSpeed(minCurrentSpeed);
        sample.setPolledAt(polledAt);
        sample.setIncidentCount(3);
        sample.setSourceMode(sourceMode);
        return sample;
    }

    private static TrafficHistorySample historySample(
        String corridor,
        double avgCurrentSpeed,
        double minCurrentSpeed,
        OffsetDateTime polledAt,
        String speedSignature,
        String semanticSignature,
        boolean localizedSlowdown,
        String localizedSlowdownNote
    ) {
        TrafficHistorySample sample = new TrafficHistorySample();
        sample.setCorridor(corridor);
        sample.setAvgCurrentSpeed(avgCurrentSpeed);
        sample.setMinCurrentSpeed(minCurrentSpeed);
        sample.setPolledAt(polledAt);
        sample.setIncidentCount(1);
        sample.setSourceMode("tile");
        sample.setSpeedStateSignature(speedSignature);
        sample.setSemanticFlowSignature(semanticSignature);
        sample.setLocalizedSlowdown(localizedSlowdown);
        sample.setLocalizedSlowdownNote(localizedSlowdownNote);
        return sample;
    }

    private static TrafficCorridorSummaryProjection corridorSummary(
        String corridor,
        double avgCurrentSpeed,
        double minCurrentSpeed,
        long totalIncidentCount
    ) {
        return new TrafficCorridorSummaryProjection() {
            @Override public String getCorridor() { return corridor; }
            @Override public Long getBucketCount() { return 24L; }
            @Override public Long getSampleCount() { return 240L; }
            @Override public Double getAvgCurrentSpeed() { return avgCurrentSpeed; }
            @Override public Double getMinCurrentSpeed() { return minCurrentSpeed; }
            @Override public Double getAvgSpeedStddev() { return 6.0; }
            @Override public Long getTotalIncidentCount() { return totalIncidentCount; }
            @Override public java.time.Instant getFirstBucketStart() { return OffsetDateTime.now(ZoneOffset.UTC).minusHours(24).toInstant(); }
            @Override public java.time.Instant getLastBucketStart() { return OffsetDateTime.now(ZoneOffset.UTC).toInstant(); }
        };
    }
}
