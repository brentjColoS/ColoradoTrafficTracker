package com.example.api_service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficFlowCellController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficFlowCellControllerTest {
    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficFlowCellReadRepository repository;

    @MockBean
    private TrafficFlowCellFrequencyRepository frequencyRepository;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @MockBean
    private DashboardProps dashboardProps;

    @Test
    void returnsTheCurrentCorridorSnapshotAndCells() throws Exception {
        CurrentFlowCellSnapshotProjection snapshot = mock(CurrentFlowCellSnapshotProjection.class);
        when(snapshot.getCorridor()).thenReturn("I25");
        when(snapshot.getObservedAt()).thenReturn(Instant.parse("2026-09-23T19:41:00Z"));
        when(snapshot.getSourceZoom()).thenReturn(10);
        when(snapshot.getStatus()).thenReturn("OBSERVED");
        when(snapshot.getDetail()).thenReturn("Combined direction.");
        when(snapshot.getCellSizeMiles()).thenReturn(0.5);
        when(snapshot.getTotalCellCount()).thenReturn(126);
        when(snapshot.getSupportedCellCount()).thenReturn(126);
        when(snapshot.getUniqueSourcePathCount()).thenReturn(131);
        when(snapshot.getDuplicateSourcePathCount()).thenReturn(2);

        CurrentFlowCellProjection cell = mock(CurrentFlowCellProjection.class);
        when(cell.getCellId()).thenReturn("I25:208.000-208.500");
        when(cell.getObservedAt()).thenReturn(Instant.parse("2026-09-23T19:41:00Z"));
        when(cell.getStartMileMarker()).thenReturn(208.0);
        when(cell.getEndMileMarker()).thenReturn(208.5);
        when(cell.getDirection()).thenReturn("COMBINED");
        when(cell.getSpeedMph()).thenReturn(48.5);
        when(cell.getSourcePathCount()).thenReturn(3);
        when(cell.getOneSideSourceCount()).thenReturn(1);
        when(cell.getFullSourceCount()).thenReturn(2);
        when(cell.getUnknownCoverageSourceCount()).thenReturn(0);
        when(cell.getClosureEvidence()).thenReturn("NONE");
        when(cell.getCoveredMarkerMiles()).thenReturn(0.5);
        when(cell.getFinestSourceSpanMiles()).thenReturn(0.2);
        when(cell.getLengthWeightedSourceSpanMiles()).thenReturn(0.7);
        when(cell.getCoarsestSourceSpanMiles()).thenReturn(1.5);
        when(cell.getCoarsestSourceStartMileMarker()).thenReturn(207.5);
        when(cell.getCoarsestSourceEndMileMarker()).thenReturn(209.0);
        when(cell.getQuality()).thenReturn("FULL_CELL");

        when(repository.findCurrentSnapshot("I25")).thenReturn(List.of(snapshot));
        when(repository.findCurrentCells("I25")).thenReturn(List.of(cell));

        mvc.perform(get("/dashboard-api/traffic/map/flow-cells/current")
                .param("corridor", "i25"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I25"))
            .andExpect(jsonPath("$.status").value("OBSERVED"))
            .andExpect(jsonPath("$.supportedCellCount").value(126))
            .andExpect(jsonPath("$.cells[0].cellId").value("I25:208.000-208.500"))
            .andExpect(jsonPath("$.cells[0].direction").value("COMBINED"))
            .andExpect(jsonPath("$.cells[0].speedMph").value(48.5))
            .andExpect(jsonPath("$.cells[0].lengthWeightedSourceSpanMiles").value(0.7));
    }

    @Test
    void returnsTheExactUtcHourContainingTheRequestedTime() throws Exception {
        HourlyFlowCellProjection cell = mock(HourlyFlowCellProjection.class);
        when(cell.getCellId()).thenReturn("I70:206.000-206.500");
        when(cell.getDirection()).thenReturn("COMBINED");
        when(cell.getStartMileMarker()).thenReturn(206.0);
        when(cell.getEndMileMarker()).thenReturn(206.5);
        when(cell.getSourceZoomMin()).thenReturn(10);
        when(cell.getSourceZoomMax()).thenReturn(10);
        when(cell.getObservationCount()).thenReturn(42);
        when(cell.getAvgSpeedMph()).thenReturn(41.5);
        when(cell.getMinSpeedMph()).thenReturn(31.0);
        when(cell.getMaxSpeedMph()).thenReturn(52.0);
        when(cell.getFullCellObservationCount()).thenReturn(40);
        when(cell.getPartialCellObservationCount()).thenReturn(2);
        when(cell.getClosureObservationCount()).thenReturn(1);
        when(cell.getMinFinestSourceSpanMiles()).thenReturn(0.2);
        when(cell.getAvgLengthWeightedSourceSpanMiles()).thenReturn(0.8);
        when(cell.getMaxCoarsestSourceSpanMiles()).thenReturn(2.0);
        when(cell.getFirstObservedAt()).thenReturn(Instant.parse("2026-09-23T19:01:00Z"));
        when(cell.getLastObservedAt()).thenReturn(Instant.parse("2026-09-23T19:58:00Z"));

        OffsetDateTime hourStart = OffsetDateTime.parse("2026-09-23T19:00:00Z");
        when(repository.findHourlyCells("I70", hourStart)).thenReturn(List.of(cell));

        mvc.perform(get("/api/traffic/map/flow-cells/hourly")
                .param("corridor", "I70")
                .param("asOf", "2026-09-23T13:42:00-06:00"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I70"))
            .andExpect(jsonPath("$.hourStart").value("2026-09-23T19:00:00Z"))
            .andExpect(jsonPath("$.hourEnd").value("2026-09-23T20:00:00Z"))
            .andExpect(jsonPath("$.resolution").value("HOURLY"))
            .andExpect(jsonPath("$.cells[0].observationCount").value(42))
            .andExpect(jsonPath("$.cells[0].closureObservationCount").value(1));

        verify(repository).findHourlyCells("I70", hourStart);
    }

    @Test
    void rejectsUntrackedCorridorsAndReportsMissingBuckets() throws Exception {
        mvc.perform(get("/dashboard-api/traffic/map/flow-cells/current")
                .param("corridor", "US36"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/dashboard-api/traffic/map/flow-cells/hourly")
                .param("corridor", "I25")
                .param("asOf", "2026-09-22T18:00:00Z"))
            .andExpect(status().isNotFound());

        mvc.perform(get("/dashboard-api/traffic/map/flow-cells/frequency")
                .param("corridor", "I25")
                .param("windowHours", "24"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void returnsBoundedSlowdownFrequencyForLongRanges() throws Exception {
        Instant firstObservedAt = Instant.parse("2026-09-24T21:01:00Z");
        Instant lastObservedAt = Instant.parse("2026-09-25T20:58:00Z");
        TrafficFlowCellFrequencyRepository.FrequencyCell cell =
            new TrafficFlowCellFrequencyRepository.FrequencyCell(
                "I25:208.000-208.500",
                "COMBINED",
                208.0,
                208.5,
                55,
                24,
                1_416,
                43.5,
                8,
                3,
                1,
                0,
                firstObservedAt,
                lastObservedAt
            );
        Instant windowEnd = Instant.parse("2026-09-25T21:00:00Z");
        Instant windowStart = Instant.parse("2026-09-18T21:00:00Z");
        when(frequencyRepository.find("I25", windowStart, windowEnd)).thenReturn(List.of(cell));

        mvc.perform(get("/dashboard-api/traffic/map/flow-cells/frequency")
                .param("corridor", "i25")
                .param("windowHours", "168")
                .param("asOf", "2026-09-25T15:00:00-06:00"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I25"))
            .andExpect(jsonPath("$.resolution").value("SLOWDOWN_FREQUENCY"))
            .andExpect(jsonPath("$.requestedHourCount").value(168))
            .andExpect(jsonPath("$.availableHourCount").value(24))
            .andExpect(jsonPath("$.cells[0].postedSpeedMph").value(55))
            .andExpect(jsonPath("$.cells[0].slowdownHourCount").value(8));

        verify(frequencyRepository).find("I25", windowStart, windowEnd);
    }
}
