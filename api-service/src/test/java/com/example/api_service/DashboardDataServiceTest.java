package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.example.api_service.DashboardDataController.Section;
import com.example.api_service.dto.GeoJsonFeatureCollectionDto;
import com.example.api_service.dto.OperationalStatusDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthEndpoint;
import org.springframework.http.ResponseEntity;

class DashboardDataServiceTest {
    final TrafficDashboardController summaries = mock(TrafficDashboardController.class);
    final TrafficAnalyticsController analytics = mock(TrafficAnalyticsController.class);
    final TrafficController traffic = mock(TrafficController.class);
    final TrafficSpeedZoneTrendController zones = mock(TrafficSpeedZoneTrendController.class);
    final DashboardHistoryBlocks historyBlocks = mock(DashboardHistoryBlocks.class);
    final TrafficFlowCellController cells = mock(TrafficFlowCellController.class);
    final TrafficMapController maps = mock(TrafficMapController.class);
    final OperationalStatusController status = mock(OperationalStatusController.class);
    final IncidentRevisionRepository revisions = mock(IncidentRevisionRepository.class);
    final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-10-08T00:00:00Z"));
    final Clock clock = new Clock() {
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now.get(); }
    };
    final DashboardDataService service;

    @SuppressWarnings("unchecked")
    DashboardDataServiceTest() {
        ObjectProvider<HealthEndpoint> health = mock(ObjectProvider.class);
        HealthEndpoint endpoint = mock(HealthEndpoint.class);
        when(health.getObject()).thenReturn(endpoint);
        when(endpoint.health()).thenReturn(Health.up().build());
        when(maps.corridors()).thenReturn(new GeoJsonFeatureCollectionDto(List.of()));
        when(status.operationalStatus()).thenReturn(ResponseEntity.ok(new OperationalStatusDto(
            "HEALTHY", OffsetDateTime.now(clock), "Fresh", List.of())));
        when(revisions.revision(anyString())).thenReturn("poll-one");
        when(maps.sharedIncidents(anyString())).thenReturn(ResponseEntity.ok(new TrafficMapController.SharedIncidents(
            List.of(), OffsetDateTime.now(clock).minusDays(30), false)));
        // Unavailable slices exercise independent failure handling rather than fabricated chart data.
        when(summaries.currentSummary(anyString())).thenReturn(ResponseEntity.notFound().build());
        when(analytics.trends(anyString(), anyInt(), anyInt(), anyBoolean(), any())).thenReturn(ResponseEntity.notFound().build());
        when(analytics.baselines(anyString(), any())).thenReturn(ResponseEntity.notFound().build());
        when(traffic.history(anyString(), anyInt(), anyInt(), anyBoolean(), anyBoolean(), any())).thenReturn(ResponseEntity.notFound().build());
        when(zones.trends(anyString(), anyInt(), any())).thenReturn(ResponseEntity.notFound().build());
        when(zones.baselines(anyString(), any())).thenReturn(ResponseEntity.notFound().build());
        when(cells.current(anyString())).thenReturn(ResponseEntity.notFound().build());
        when(cells.frequency(anyString(), anyInt(), any())).thenReturn(ResponseEntity.notFound().build());
        when(maps.incidentTimeline(anyString(), anyInt(), anyInt(), any())).thenReturn(ResponseEntity.ok(new GeoJsonFeatureCollectionDto(List.of())));
        service = new DashboardDataService(summaries, analytics, traffic, zones, cells, maps, status, health, revisions,
            new ObjectMapper().findAndRegisterModules(), historyBlocks, clock);
    }

    @Test void sharesIncidentsAcrossAllRangesAndOnlyReloadsAfterRevisionChanges() {
        var initial = service.snapshot(List.of(2,6,24,168,720),24,false,Set.of());
        assertEquals(200, initial.get("/traffic/map/incidents/shared?corridor=I25").status());
        now.set(now.get().plusSeconds(61));
        service.snapshot(List.of(2,6,24,168,720),24,false,Set.of());
        verify(maps,times(1)).sharedIncidents("I25");
        verify(maps,times(1)).sharedIncidents("I70");
        verify(maps,never()).recentIncidents(anyString(),anyInt(),anyInt());
        when(revisions.revision("I25")).thenReturn("closed-event");
        service.snapshot(List.of(24),24,false,Set.of());
        verify(maps,times(2)).sharedIncidents("I25");
        verify(maps,times(1)).sharedIncidents("I70");
    }

    @Test void cappedSharedIncidentsKeepIndependentShortWindowCoverage() {
        when(maps.sharedIncidents("I25")).thenReturn(ResponseEntity.ok(new TrafficMapController.SharedIncidents(
            List.of(), OffsetDateTime.now(clock).minusDays(30), true)));
        when(maps.recentIncidents(eq("I25"),anyInt(),eq(1000))).thenReturn(ResponseEntity.ok(new GeoJsonFeatureCollectionDto(List.of())));
        var result = service.snapshot(List.of(24),24,false,Set.of());
        for(int hours: List.of(2,6,24,168,720)) {
            verify(maps).recentIncidents("I25",hours*60,1000);
            assertEquals(200,result.get(DashboardDataService.key("/traffic/map/incidents/recent?corridor=I25&windowMinutes="+hours*60+"&limit=1000")).status());
        }
    }

    @Test void knownVersionsOmitPayloadWithoutClaimingFailedSectionsAreFresh() {
        var initial = service.snapshot(List.of(24),24,false,Set.of());
        var versions = initial.values().stream().map(Section::version).filter(java.util.Objects::nonNull).collect(java.util.stream.Collectors.toSet());
        var next = service.snapshot(List.of(24),24,false,versions);
        assertNull(next.get("health").data());
        assertEquals(initial.get("health").fetchedAt(),next.get("health").fetchedAt());
        assertEquals(404,next.get("/traffic/summary?corridor=I25&preferUsable=true&recentIncidentWindowMinutes=1440&windowHours=168").status());
        verify(status,times(1)).operationalStatus();
        now.set(now.get().plusSeconds(21));
        assertNotNull(service.snapshot(List.of(24),24,false,versions).get("health").data());
    }

    @Test void concurrentVisitorsShareTheSameDatasetRead() {
        var a = CompletableFuture.supplyAsync(() -> service.snapshot(List.of(24),24,false,Set.of()));
        var b = CompletableFuture.supplyAsync(() -> service.snapshot(List.of(24),24,false,Set.of()));
        CompletableFuture.allOf(a,b).join();
        verify(maps,times(1)).sharedIncidents("I25");
        verify(maps,times(1)).corridors();
    }

    @Test void historicalBatchKeepsResolutionAndHistoricalIncidentState() {
        var end = OffsetDateTime.parse("2026-09-15T12:00:00Z");
        var result = service.history(List.of("I25","I70"),6,end,false,Set.of());
        verify(historyBlocks).trends("I25",175,end);
        verify(historyBlocks).history("I25",360,420,end);
        verify(maps).incidentTimeline("I25",360,1000,end);
        assertTrue(result.keySet().stream().allMatch(key -> key.contains("asOf=")));
        service.history(List.of("I25"),2,end,true,Set.of());
        verify(historyBlocks).zones("I25",2,end);
        verify(zones).baselines("I25",end);
        verify(maps,never()).sharedIncidents(anyString());
        verify(summaries,never()).currentSummary(anyString());
        verifyNoInteractions(cells,status);
    }

    @Test void revisionFailureDoesNotMakeOtherSectionsUnavailable() {
        when(revisions.revision("I25")).thenThrow(new IllegalStateException("Unavailable"));
        var result = service.snapshot(List.of(24),24,false,Set.of());
        assertEquals(503,result.get("/traffic/map/incidents/shared?corridor=I25").status());
        assertEquals(200,result.get("/traffic/map/incidents/shared?corridor=I70").status());
        assertEquals(200,result.get("health").status());
    }
    @Test void inactiveLongRangesReuseDataUntilSelectedWhileCurrentViewsRemainFresh() {
        when(zones.trends(anyString(), anyInt(), any())).thenAnswer(call -> ResponseEntity.ok(
            new com.example.api_service.dto.TrafficSpeedZoneTrendResponseDto(call.getArgument(0),
                now.get(), now.get(), call.getArgument(1), 60, 0, 0, null, null, List.of())));
        service.snapshot(List.of(2,6,24,168,720),24,false,Set.of());
        now.set(now.get().plusSeconds(61));
        service.snapshot(List.of(2,6,24,168,720),24,false,Set.of());
        verify(zones,times(2)).trends("I25",24,null);
        verify(zones,times(2)).trends("I25",2,null);
        verify(zones,times(1)).trends("I25",6,null);
        verify(zones,times(1)).trends("I25",720,null);
        service.snapshot(List.of(2,6,24,168,720),720,false,Set.of());
        verify(zones,times(2)).trends("I25",720,null);
        now.set(now.get().plusSeconds(240));
        service.snapshot(List.of(6),24,false,Set.of());
        verify(zones,times(2)).trends("I25",6,null);
    }

    @Test void historicalBaselinesReuseOnlyTheSameDenverWeek() {
        var first = OffsetDateTime.parse("2026-09-15T12:00:00Z");
        when(analytics.baselines(anyString(),any())).thenAnswer(call -> ResponseEntity.ok(
            new com.example.api_service.dto.TrafficBaselineResponseDto(call.getArgument(0),
                TrafficBaselineSupport.denverWeekStart(call.getArgument(1)),first.minusWeeks(13),13,8,0,List.of())));
        var a = service.history(List.of("I25"),6,first,false,Set.of());
        var b = service.history(List.of("I25"),6,first.plusDays(1),false,Set.of());
        var aBaseline = a.values().stream().filter(section -> section.data() instanceof com.example.api_service.dto.TrafficBaselineResponseDto).findFirst().orElseThrow();
        var bBaseline = b.values().stream().filter(section -> section.data() instanceof com.example.api_service.dto.TrafficBaselineResponseDto).findFirst().orElseThrow();
        assertEquals(aBaseline.version(),bBaseline.version());
        verify(analytics,times(1)).baselines(anyString(),any());
        service.history(List.of("I25"),6,first.plusWeeks(1),false,Set.of());
        verify(analytics,times(2)).baselines(anyString(),any());
    }

}
