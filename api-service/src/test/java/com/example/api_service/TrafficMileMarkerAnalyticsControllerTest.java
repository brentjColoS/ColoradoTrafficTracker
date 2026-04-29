package com.example.api_service;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficMileMarkerAnalyticsController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficMileMarkerAnalyticsControllerTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private CorridorRefRepository corridorRefRepository;

    @MockBean
    private TrafficHistoryIncidentRepository incidentRepository;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @MockBean
    private DashboardProps dashboardProps;

    @Test
    void coverageReturnsPerCorridorAssessment() throws Exception {
        CorridorRef corridor = new CorridorRef();
        corridor.setCode("I25");
        corridor.setStartMileMarker(271.0);
        corridor.setEndMileMarker(208.0);
        corridor.setMileMarkerAnchorsJson(objectMapper.writeValueAsString(List.of(
            java.util.Map.of("label", "North", "mileMarker", 271.0, "latitude", 40.58, "longitude", -105.02),
            java.util.Map.of("label", "South", "mileMarker", 208.0, "latitude", 39.74, "longitude", -104.99)
        )));

        when(corridorRefRepository.findAllByOrderByCodeAsc()).thenReturn(List.of(corridor));
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(eq("I25"), org.mockito.ArgumentMatchers.any(OffsetDateTime.class))).thenReturn(100L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNull(eq("I25"), org.mockito.ArgumentMatchers.any(OffsetDateTime.class))).thenReturn(84L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(eq("I25"), org.mockito.ArgumentMatchers.any(OffsetDateTime.class))).thenReturn(16L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNullAndMileMarkerConfidenceGreaterThanEqual(
            eq("I25"),
            org.mockito.ArgumentMatchers.any(OffsetDateTime.class),
            eq(0.75)
        )).thenReturn(70L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(eq("I25"), org.mockito.ArgumentMatchers.any(OffsetDateTime.class), eq("anchor_interpolated"))).thenReturn(12L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(eq("I25"), org.mockito.ArgumentMatchers.any(OffsetDateTime.class), eq("range_interpolated"))).thenReturn(72L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(eq("I25"), org.mockito.ArgumentMatchers.any(OffsetDateTime.class), eq("direction_only"))).thenReturn(10L);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(eq("I25"), org.mockito.ArgumentMatchers.any(OffsetDateTime.class), eq("off_corridor"))).thenReturn(6L);
        when(incidentRepository.averageDistanceToCorridorMeters(eq("I25"), org.mockito.ArgumentMatchers.any(OffsetDateTime.class))).thenReturn(36.42);

        mvc.perform(get("/dashboard-api/traffic/analytics/mile-marker-coverage").param("windowHours", "168"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridorCount").value(1))
            .andExpect(jsonPath("$.corridors[0].corridor").value("I25"))
            .andExpect(jsonPath("$.corridors[0].configuredAnchorCount").value(2))
            .andExpect(jsonPath("$.corridors[0].resolvedIncidentCount").value(84))
            .andExpect(jsonPath("$.corridors[0].resolvedRatePercent").value(84.0))
            .andExpect(jsonPath("$.corridors[0].highConfidenceRatePercent").value(83.3))
            .andExpect(jsonPath("$.corridors[0].anchorCoveragePercent").value(14.3))
            .andExpect(jsonPath("$.corridors[0].offCorridorRatePercent").value(6.0))
            .andExpect(jsonPath("$.corridors[0].dominantMethod").value("range_interpolated"))
            .andExpect(jsonPath("$.corridors[0].qualityState").value("attention"))
            .andExpect(jsonPath("$.corridors[0].qualitySummary").value("Anchor calibration is active, but many incidents are still falling back to range estimates."))
            .andExpect(jsonPath("$.corridors[0].avgDistanceToCorridorMeters").value(36.4));
    }

    @Test
    void coverageRejectsInvalidWindow() throws Exception {
        mvc.perform(get("/api/traffic/analytics/mile-marker-coverage").param("windowHours", "0"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void coverageSurfacesIdleRangeOnlyAnchoredAndCriticalStates() throws Exception {
        CorridorRef idle = corridor("IDLE", "[]");
        CorridorRef rangeOnly = corridor("RANGE", null);
        CorridorRef anchored = corridor("ANCH", objectMapper.writeValueAsString(List.of(java.util.Map.of("mileMarker", 1))));
        CorridorRef critical = corridor("CRIT", objectMapper.writeValueAsString(List.of(java.util.Map.of("mileMarker", 1))));
        CorridorRef attention = corridor("ATTN", objectMapper.writeValueAsString(List.of(java.util.Map.of("mileMarker", 1))));
        when(corridorRefRepository.findAllByOrderByCodeAsc()).thenReturn(List.of(idle, rangeOnly, anchored, critical, attention));

        stubAssessment("IDLE", 0, 0, 0, 0, 0, 0, 0, 0, null);
        stubAssessment("RANGE", 20, 18, 2, 12, 0, 16, 2, 0, 85.0);
        stubAssessment("ANCH", 20, 19, 1, 18, 17, 1, 1, 0, 60.0);
        stubAssessment("CRIT", 20, 8, 12, 6, 1, 1, 1, 6, 180.0);
        stubAssessment("ATTN", 20, 18, 2, 18, 0, 18, 0, 0, 90.0);

        mvc.perform(get("/api/traffic/analytics/mile-marker-coverage").param("windowHours", "24"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridors[0].corridor").value("IDLE"))
            .andExpect(jsonPath("$.corridors[0].qualityState").value("idle"))
            .andExpect(jsonPath("$.corridors[1].qualityState").value("range_only"))
            .andExpect(jsonPath("$.corridors[1].qualitySummary").value("Range-based calibration is active because no corridor anchors are configured."))
            .andExpect(jsonPath("$.corridors[2].qualityState").value("anchored"))
            .andExpect(jsonPath("$.corridors[2].qualitySummary").value("Anchor calibration is carrying most recent incident placements cleanly."))
            .andExpect(jsonPath("$.corridors[3].qualityState").value("critical"))
            .andExpect(jsonPath("$.corridors[3].qualitySummary").value("Too many incidents are landing off corridor; review corridor geometry and snapping."))
            .andExpect(jsonPath("$.corridors[4].qualityState").value("attention"))
            .andExpect(jsonPath("$.corridors[4].qualitySummary").value("Anchors are configured, but recent incidents are not resolving through them yet."));
    }

    private CorridorRef corridor(String code, String anchorsJson) {
        CorridorRef corridor = new CorridorRef();
        corridor.setCode(code);
        corridor.setStartMileMarker(100.0);
        corridor.setEndMileMarker(110.0);
        corridor.setMileMarkerAnchorsJson(anchorsJson);
        return corridor;
    }

    private void stubAssessment(
        String corridor,
        long recentIncidentCount,
        long resolvedIncidentCount,
        long unresolvedIncidentCount,
        long highConfidenceCount,
        long anchorInterpolatedCount,
        long rangeInterpolatedCount,
        long directionOnlyCount,
        long offCorridorCount,
        Double avgDistanceToCorridorMeters
    ) {
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqual(eq(corridor), org.mockito.ArgumentMatchers.any(OffsetDateTime.class)))
            .thenReturn(recentIncidentCount);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNull(eq(corridor), org.mockito.ArgumentMatchers.any(OffsetDateTime.class)))
            .thenReturn(resolvedIncidentCount);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNull(eq(corridor), org.mockito.ArgumentMatchers.any(OffsetDateTime.class)))
            .thenReturn(unresolvedIncidentCount);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndClosestMileMarkerIsNotNullAndMileMarkerConfidenceGreaterThanEqual(
            eq(corridor),
            org.mockito.ArgumentMatchers.any(OffsetDateTime.class),
            eq(0.75)
        )).thenReturn(highConfidenceCount);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(eq(corridor), org.mockito.ArgumentMatchers.any(OffsetDateTime.class), eq("anchor_interpolated")))
            .thenReturn(anchorInterpolatedCount);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(eq(corridor), org.mockito.ArgumentMatchers.any(OffsetDateTime.class), eq("range_interpolated")))
            .thenReturn(rangeInterpolatedCount);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(eq(corridor), org.mockito.ArgumentMatchers.any(OffsetDateTime.class), eq("direction_only")))
            .thenReturn(directionOnlyCount);
        when(incidentRepository.countByCorridorAndPolledAtGreaterThanEqualAndMileMarkerMethod(eq(corridor), org.mockito.ArgumentMatchers.any(OffsetDateTime.class), eq("off_corridor")))
            .thenReturn(offCorridorCount);
        when(incidentRepository.averageDistanceToCorridorMeters(eq(corridor), org.mockito.ArgumentMatchers.any(OffsetDateTime.class)))
            .thenReturn(avgDistanceToCorridorMeters);
    }
}
