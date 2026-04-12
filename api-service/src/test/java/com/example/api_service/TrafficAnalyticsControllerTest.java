package com.example.api_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficAnalyticsController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficAnalyticsControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficAnalyticsRepository analyticsRepository;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @Test
    void corridorsReturnsSummaryRollups() throws Exception {
        when(analyticsRepository.summarizeCorridors(any())).thenReturn(List.of(
            corridorSummary("I25", 24L, 96L, 48.2, 22.0, 6.8, 14L),
            corridorSummary("I70", 24L, 88L, 44.7, 18.5, 7.4, 19L)
        ));

        mvc.perform(get("/api/traffic/analytics/corridors").param("windowHours", "168"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridorCount").value(2))
            .andExpect(jsonPath("$.corridors[0].corridor").value("I25"))
            .andExpect(jsonPath("$.corridors[0].sampleCount").value(96))
            .andExpect(jsonPath("$.corridors[1].totalIncidentCount").value(19));
    }

    @Test
    void trendsReturnChronologicalBuckets() throws Exception {
        when(analyticsRepository.findTrend(eq("I25"), any(), eq(2))).thenReturn(List.of(
            trend("I25", OffsetDateTime.of(2026, 4, 12, 12, 0, 0, 0, ZoneOffset.UTC), 3L, 41.0),
            trend("I25", OffsetDateTime.of(2026, 4, 12, 11, 0, 0, 0, ZoneOffset.UTC), 4L, 45.0)
        ));

        mvc.perform(get("/api/traffic/analytics/trends")
                .param("corridor", "I25")
                .param("windowHours", "24")
                .param("limit", "2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.returned").value(2))
            .andExpect(jsonPath("$.buckets[0].bucketStart").value("2026-04-12T11:00:00Z"))
            .andExpect(jsonPath("$.buckets[1].bucketStart").value("2026-04-12T12:00:00Z"));
    }

    @Test
    void hotspotsReturnReferenceLabels() throws Exception {
        when(analyticsRepository.findHotspotsByCorridor(eq("I25"), any(), eq(3))).thenReturn(List.of(
            hotspot("I25", "S", 214, 7L, 380.0, 900, 2L)
        ));

        mvc.perform(get("/api/traffic/analytics/hotspots")
                .param("corridor", "I25")
                .param("windowHours", "72")
                .param("limit", "3"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.returned").value(1))
            .andExpect(jsonPath("$.hotspots[0].referenceLabel").value("I25 southbound near MM 214"))
            .andExpect(jsonPath("$.hotspots[0].incidentCount").value(7))
            .andExpect(jsonPath("$.hotspots[0].archivedIncidentCount").value(2));
    }

    @Test
    void trendsRejectInvalidLimits() throws Exception {
        mvc.perform(get("/api/traffic/analytics/trends")
                .param("corridor", "I25")
                .param("limit", "0"))
            .andExpect(status().isBadRequest());
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
            @Override public OffsetDateTime getFirstBucketStart() { return OffsetDateTime.of(2026, 4, 10, 0, 0, 0, 0, ZoneOffset.UTC); }
            @Override public OffsetDateTime getLastBucketStart() { return OffsetDateTime.of(2026, 4, 11, 23, 0, 0, 0, ZoneOffset.UTC); }
        };
    }

    private static TrafficCorridorTrendProjection trend(
        String corridor,
        OffsetDateTime bucketStart,
        Long sampleCount,
        Double avgCurrentSpeed
    ) {
        return new TrafficCorridorTrendProjection() {
            @Override public String getCorridor() { return corridor; }
            @Override public OffsetDateTime getBucketStart() { return bucketStart; }
            @Override public Long getSampleCount() { return sampleCount; }
            @Override public Double getAvgCurrentSpeed() { return avgCurrentSpeed; }
            @Override public Double getAvgFreeflowSpeed() { return 55.0; }
            @Override public Double getMinCurrentSpeed() { return 30.0; }
            @Override public Double getAvgConfidence() { return 0.85; }
            @Override public Double getAvgSpeedStddev() { return 5.5; }
            @Override public Double getAvgP50Speed() { return 44.0; }
            @Override public Double getAvgP90Speed() { return 50.0; }
            @Override public Long getTotalIncidents() { return 2L; }
            @Override public Long getArchivedSampleCount() { return 1L; }
        };
    }

    private static TrafficIncidentHotspotProjection hotspot(
        String corridor,
        String direction,
        Integer mileMarkerBand,
        Long incidentCount,
        Double avgDelaySeconds,
        Integer maxDelaySeconds,
        Long archivedIncidentCount
    ) {
        return new TrafficIncidentHotspotProjection() {
            @Override public String getCorridor() { return corridor; }
            @Override public String getTravelDirection() { return direction; }
            @Override public Integer getMileMarkerBand() { return mileMarkerBand; }
            @Override public Long getIncidentCount() { return incidentCount; }
            @Override public Double getAvgDelaySeconds() { return avgDelaySeconds; }
            @Override public Integer getMaxDelaySeconds() { return maxDelaySeconds; }
            @Override public OffsetDateTime getFirstSeenAt() { return OffsetDateTime.of(2026, 4, 10, 12, 0, 0, 0, ZoneOffset.UTC); }
            @Override public OffsetDateTime getLastSeenAt() { return OffsetDateTime.of(2026, 4, 12, 8, 0, 0, 0, ZoneOffset.UTC); }
            @Override public Long getArchivedIncidentCount() { return archivedIncidentCount; }
        };
    }
}
