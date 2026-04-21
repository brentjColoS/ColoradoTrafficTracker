package com.example.api_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficDashboardController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficDashboardControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficSampleRepository sampleRepository;

    @MockBean
    private TrafficAnalyticsRepository analyticsRepository;

    @MockBean
    private TrafficHistoryIncidentRepository incidentRepository;

    @MockBean
    private TrafficProviderGuardStatusRepository statusRepository;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @MockBean
    private DashboardProps dashboardProps;

    @Test
    void summaryReturnsDashboardReadyPayload() throws Exception {
        TrafficSample latest = sample("I25", 58.0, 41.0, "tile");
        latest.setPolledAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(15));
        when(sampleRepository.findLatestUsableByCorridor(eq("I25"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(latest));

        when(analyticsRepository.summarizeCorridorWithSpeed(eq("I25"), any()))
            .thenReturn(List.of(corridorSummary("I25", 168L, 1313L, 72.8, 38.0, 6.4, 12274L)));
        when(analyticsRepository.findHotspotsByCorridor(eq("I25"), any(), eq(10)))
            .thenReturn(List.of(hotspot("I25", "S", 214, 21L, 42L, 205.0, 940, 4L, 8L)));
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(eq("I25"), any())).thenReturn(402L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(eq("I25"), any())).thenReturn(17L);
        when(incidentRepository.countDistinctReferencesByCorridorAndPolledAtGreaterThanEqual(eq("I25"), any())).thenReturn(131L);

        TrafficProviderGuardStatus guardStatus = new TrafficProviderGuardStatus();
        guardStatus.setProviderName("tomtom");
        guardStatus.setState("HEALTHY");
        guardStatus.setLastCheckedAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1));
        guardStatus.setLastSuccessAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1));
        when(statusRepository.findById("tomtom")).thenReturn(Optional.of(guardStatus));
        when(dashboardProps.providerStatusStaleAfterMinutes()).thenReturn(20);

        mvc.perform(get("/dashboard-api/traffic/summary").param("corridor", "I25"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I25"))
            .andExpect(jsonPath("$.latest.sourceMode").value("tile"))
            .andExpect(jsonPath("$.corridorSummary.avgCurrentSpeed").value(72.8))
            .andExpect(jsonPath("$.topHotspot.referenceLabel").value("I25 southbound near MM 214"))
            .andExpect(jsonPath("$.topHotspot.observationCount").value(42))
            .andExpect(jsonPath("$.topHotspot.incidentCount").value(21))
            .andExpect(jsonPath("$.topHotspot.hasDelaySignal").value(true))
            .andExpect(jsonPath("$.recentIncidentObservationCount").value(402))
            .andExpect(jsonPath("$.recentIncidentReferenceCount").value(131))
            .andExpect(jsonPath("$.recentMissingMileMarkerCount").value(17))
            .andExpect(jsonPath("$.speedDeltaFromWindowAverage").value(-14.8))
            .andExpect(jsonPath("$.notes[0]").value(org.hamcrest.Matchers.containsString("Tile-mode sampling is active")));
    }

    @Test
    void summaryRejectsInvalidParameters() throws Exception {
        mvc.perform(get("/api/traffic/summary").param("corridor", " "))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/summary").param("corridor", "I25").param("windowHours", "0"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/summary").param("corridor", "I25").param("recentIncidentWindowMinutes", "10081"))
            .andExpect(status().isBadRequest());
    }

    private static TrafficSample sample(String corridor, double avgCurrentSpeed, double minCurrentSpeed, String sourceMode) {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(corridor);
        sample.setAvgCurrentSpeed(avgCurrentSpeed);
        sample.setMinCurrentSpeed(minCurrentSpeed);
        sample.setSourceMode(sourceMode);
        sample.setPolledAt(OffsetDateTime.now(ZoneOffset.UTC));
        sample.setIncidentCount(3);
        return sample;
    }

    private static TrafficCorridorSummaryProjection corridorSummary(
        String corridor,
        Long bucketCount,
        Long sampleCount,
        Double avgCurrentSpeed,
        Double minCurrentSpeed,
        Double avgSpeedStddev,
        Long totalIncidentCount
    ) {
        return new TrafficCorridorSummaryProjection() {
            @Override public String getCorridor() { return corridor; }
            @Override public Long getBucketCount() { return bucketCount; }
            @Override public Long getSampleCount() { return sampleCount; }
            @Override public Double getAvgCurrentSpeed() { return avgCurrentSpeed; }
            @Override public Double getMinCurrentSpeed() { return minCurrentSpeed; }
            @Override public Double getAvgSpeedStddev() { return avgSpeedStddev; }
            @Override public Long getTotalIncidentCount() { return totalIncidentCount; }
            @Override public Instant getFirstBucketStart() { return OffsetDateTime.of(2026, 4, 12, 0, 0, 0, 0, ZoneOffset.UTC).toInstant(); }
            @Override public Instant getLastBucketStart() { return OffsetDateTime.of(2026, 4, 19, 5, 0, 0, 0, ZoneOffset.UTC).toInstant(); }
        };
    }

    private static TrafficIncidentHotspotProjection hotspot(
        String corridor,
        String travelDirection,
        Integer mileMarkerBand,
        Long incidentCount,
        Long observationCount,
        Double avgDelaySeconds,
        Integer maxDelaySeconds,
        Long archivedIncidentCount,
        Long archivedObservationCount
    ) {
        return new TrafficIncidentHotspotProjection() {
            @Override public String getCorridor() { return corridor; }
            @Override public String getTravelDirection() { return travelDirection; }
            @Override public Integer getMileMarkerBand() { return mileMarkerBand; }
            @Override public Long getObservationCount() { return observationCount; }
            @Override public Long getIncidentCount() { return incidentCount; }
            @Override public Double getAvgDelaySeconds() { return avgDelaySeconds; }
            @Override public Integer getMaxDelaySeconds() { return maxDelaySeconds; }
            @Override public Instant getFirstSeenAt() { return OffsetDateTime.of(2026, 4, 18, 23, 0, 0, 0, ZoneOffset.UTC).toInstant(); }
            @Override public Instant getLastSeenAt() { return OffsetDateTime.of(2026, 4, 19, 5, 0, 0, 0, ZoneOffset.UTC).toInstant(); }
            @Override public Long getArchivedObservationCount() { return archivedObservationCount; }
            @Override public Long getArchivedIncidentCount() { return archivedIncidentCount; }
        };
    }
}
