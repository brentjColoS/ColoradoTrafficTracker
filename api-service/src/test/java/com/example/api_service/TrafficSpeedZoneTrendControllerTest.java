package com.example.api_service;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficSpeedZoneTrendController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficSpeedZoneTrendControllerTest {
    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficSpeedZoneTrendRepository repository;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @MockBean
    private DashboardProps dashboardProps;

    @Test
    void returnsCompleteBucketedZoneTrendsForLongRanges() throws Exception {
        Instant windowEnd = Instant.parse("2026-09-26T06:00:00Z");
        Instant windowStart = Instant.parse("2026-09-19T06:00:00Z");
        List<TrafficSpeedZoneTrendRepository.TrendPoint> rows = List.of(
            point("I70-206-213", 0, Instant.parse("2026-09-19T06:00:00Z"), 54.0),
            point("I70-213-216", 1, Instant.parse("2026-09-19T06:00:00Z"), 41.0),
            point("I70-206-213", 0, Instant.parse("2026-09-19T07:00:00Z"), 55.0)
        );
        when(repository.isAvailable()).thenReturn(true);
        when(repository.find("I70", windowStart, windowEnd, 60)).thenReturn(rows);

        mvc.perform(get("/dashboard-api/traffic/zones/trends")
                .param("corridor", "i70")
                .param("windowHours", "168")
                .param("asOf", "2026-09-26T00:00:00-06:00"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I70"))
            .andExpect(jsonPath("$.bucketMinutes").value(60))
            .andExpect(jsonPath("$.returned").value(3))
            .andExpect(jsonPath("$.availableBucketCount").value(2))
            .andExpect(jsonPath("$.points[1].zoneKey").value("I70-213-216"))
            .andExpect(jsonPath("$.points[1].avgCurrentSpeed").value(41.0));

        verify(repository).find("I70", windowStart, windowEnd, 60);
    }

    @Test
    void choosesBoundedDetailForEachDashboardRange() throws Exception {
        when(repository.isAvailable()).thenReturn(true);
        when(repository.find(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyInt()))
            .thenReturn(List.of(point("I25-208-221", 0, Instant.parse("2026-09-26T05:00:00Z"), 58.0)));

        mvc.perform(get("/api/traffic/zones/trends").param("corridor", "I25").param("windowHours", "6"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.bucketMinutes").value(5));
        mvc.perform(get("/api/traffic/zones/trends").param("corridor", "I25").param("windowHours", "24"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.bucketMinutes").value(15));
        mvc.perform(get("/api/traffic/zones/trends").param("corridor", "I25").param("windowHours", "720"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.bucketMinutes").value(180));
    }

    @Test
    void rejectsUnsupportedRangesAndUnavailableStorage() throws Exception {
        mvc.perform(get("/dashboard-api/traffic/zones/trends")
                .param("corridor", "US36")
                .param("windowHours", "168"))
            .andExpect(status().isBadRequest());
        mvc.perform(get("/dashboard-api/traffic/zones/trends")
                .param("corridor", "I25")
                .param("windowHours", "12"))
            .andExpect(status().isBadRequest());

        when(repository.isAvailable()).thenReturn(false);
        mvc.perform(get("/dashboard-api/traffic/zones/trends")
                .param("corridor", "I25")
                .param("windowHours", "24"))
            .andExpect(status().isServiceUnavailable());
    }

    private static TrafficSpeedZoneTrendRepository.TrendPoint point(
        String key,
        int order,
        Instant bucketStart,
        double speed
    ) {
        return new TrafficSpeedZoneTrendRepository.TrendPoint(
            key,
            order,
            "MM 206-213 | 60 mph",
            "Mountain corridor",
            206.0,
            213.0,
            60,
            bucketStart,
            speed,
            speed - 4,
            120
        );
    }
}
