package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.example.api_service.dto.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;

class DashboardWindowSummaryServiceTest {
    final TrafficSpeedZoneTrendRepository zones = mock(TrafficSpeedZoneTrendRepository.class);
    final CurrentIncidentRepository incidents = mock(CurrentIncidentRepository.class);
    final CorridorRefRepository corridors = mock(CorridorRefRepository.class);
    final TrafficAnalyticsRepository analytics = mock(TrafficAnalyticsRepository.class);
    final HistoricalIncidentEpisodes legacy = mock(HistoricalIncidentEpisodes.class);
    final TrafficWindowStatisticsProjection statistics = mock(TrafficWindowStatisticsProjection.class);
    final Clock clock = Clock.fixed(Instant.parse("2026-10-13T05:00:00Z"), ZoneOffset.UTC);
    final DashboardWindowSummaryService service = new DashboardWindowSummaryService(zones, incidents, corridors, analytics, legacy, clock);
    final OffsetDateTime end = OffsetDateTime.parse("2026-06-19T02:00:42Z");
    final OffsetDateTime minute = end.withSecond(0);

    DashboardWindowSummaryServiceTest() {
        for (String code : List.of("I25","I70")) {
            CorridorRef ref = new CorridorRef(); ref.setCode(code); ref.setStartMileMarker(20.0); ref.setEndMileMarker(0.0);
            when(corridors.findById(code)).thenReturn(Optional.of(ref));
        }
        when(incidents.hasDurableEventsAtOrBefore(any())).thenReturn(true);
        when(incidents.countDurableTimelineByCorridorBetween(anyString(),any(),any())).thenReturn(1501L);
        when(statistics.getAverageSpeed()).thenReturn(55.0);
        when(statistics.getLowestObservedSpeed()).thenReturn(41.0);
        when(statistics.getAverageTravelMinutes()).thenReturn(28.0);
        when(statistics.getFastestTravelMinutes()).thenReturn(22.0);
        when(statistics.getSlowestTravelMinutes()).thenReturn(40.0);
        when(analytics.findWindowStatistics(anyString(),any(),any(),nullable(Double.class),nullable(OffsetDateTime.class))).thenReturn(statistics);
        when(zones.isAvailable()).thenReturn(true);
        when(zones.find(anyString(),any(),any(),anyInt())).thenAnswer(call -> {
            Instant until=call.getArgument(2);long bucket=(int)call.getArgument(3)*60L;
            return raw(List.of(zone("a",0,10,30.0,until.minusSeconds(bucket),2),zone("b",10,20,60.0,until.minusSeconds(bucket),4),
                zone("a",0,10,60.0,until.minusSeconds(bucket*2),6),zone("b",10,20,60.0,until.minusSeconds(bucket*2),4)));
        });
    }

    static TrafficSpeedZoneTrendPointDto zone(String key,double start,double finish,Double speed,Instant time,long observations) {
        return new TrafficSpeedZoneTrendPointDto(key,0,key,"zone",start,finish,65,time,speed,speed,observations);
    }
    static List<TrafficSpeedZoneTrendRepository.TrendPoint> raw(List<TrafficSpeedZoneTrendPointDto> rows) {
        return rows.stream().map(row->new TrafficSpeedZoneTrendRepository.TrendPoint(row.zoneKey(),row.zoneOrder(),row.zoneLabel(),row.zoneDescription(),
            row.startMileMarker(),row.endMileMarker(),row.postedSpeedMph(),row.bucketStart(),row.avgCurrentSpeed(),row.minCurrentSpeed(),row.observationCount())).toList();
    }

    @Test void windowMetricsUseCompleteJourneysObservedWeightsAndUncappedEvents() {
        var value=service.read(List.of("I25"),2,end).get("I25");
        assertEquals(minute.toInstant(),value.end()); assertEquals(minute.minusHours(2).toInstant(),value.start());
        assertEquals(55.0,value.averageSpeed()); assertEquals(25.0,value.averageTravelMinutes());
        assertEquals(20.0,value.fastestTravelMinutes()); assertEquals(30.0,value.slowestTravelMinutes());
        assertEquals("ZONE_BUCKETS",value.travelMethod());
        assertEquals(52.5,value.worstZone().speedMph()); assertEquals(1501L,value.observedIncidents());
        assertEquals(1,value.bucketMinutes());
        verify(incidents).countDurableTimelineByCorridorBetween("I25",minute.minusHours(2),minute);
        service.read(List.of("I25"),2,end.withSecond(59));
        verify(analytics,times(1)).findWindowStatistics("I25",minute.minusHours(2),minute,20.0,null);
    }

    @Test void longWindowsUseExactSpeedBoundsAndAllSupportedResolutions() {
        for(int hours:List.of(2,6,24,168,720)) {
            var value=service.read(List.of("I25","I70"),hours,end).get("I25");
            assertEquals(hours,value.hours());
            assertEquals(Map.of(2,1,6,5,24,15,168,60,720,180).get(hours),value.bucketMinutes());
            assertEquals(55.0,value.averageSpeed());
            verify(analytics).findWindowStatistics("I25",minute.minusHours(hours),minute,20.0,null);
        }
        verify(zones).find("I25",minute.minusHours(720).toInstant(),minute.toInstant(),180);
    }

    @Test void partialFailuresKeepIndependentFieldsAndNeverProduceFalseZero() {
        doThrow(new IllegalStateException("busy")).when(zones).find(eq("I25"),any(),any(),anyInt());
        when(incidents.countDurableTimelineByCorridorBetween(eq("I25"),any(),any())).thenThrow(new IllegalStateException("busy"));
        var values=service.read(List.of("I25","I70"),24,end);
        assertEquals(55.0,values.get("I25").averageSpeed());
        assertNull(values.get("I25").averageTravelMinutes());assertNull(values.get("I25").observedIncidents());
        assertFalse(values.get("I25").incidentsAvailable()); assertFalse(values.get("I25").zonesAvailable());
        assertEquals(25.0,values.get("I70").averageTravelMinutes());
    }

    @Test void absentSpeedAndEventMetadataNeverBecomeZero() {
        when(analytics.findWindowStatistics(anyString(),any(),any(),nullable(Double.class),nullable(OffsetDateTime.class))).thenReturn(null);
        doReturn(List.of()).when(zones).find(anyString(),any(),any(),anyInt());
        when(incidents.hasDurableEventsAtOrBefore(any())).thenReturn(false);
        var value=service.read(List.of("I25"),2,end).get("I25");
        assertNull(value.averageSpeed());assertNull(value.averageTravelMinutes());assertNull(value.worstZone());
        assertNull(value.observedIncidents());assertTrue(value.speedAvailable());assertTrue(value.zonesAvailable());
        verify(incidents,never()).countDurableTimelineByCorridorBetween(anyString(),any(),any());
    }

    @Test void unavailableZoneConnectionDoesNotHideIndependentSpeedOrIncidents() {
        when(zones.isAvailable()).thenReturn(false);
        var value=service.read(List.of("I25"),24,end).get("I25");
        assertEquals(55.0,value.averageSpeed());assertEquals(1501L,value.observedIncidents());
        assertNull(value.averageTravelMinutes());assertFalse(value.zonesAvailable());
        verify(zones,never()).find(anyString(),any(),any(),anyInt());
    }

    @Test void gapsDuplicatesMissingLimitsAndStoppedTrafficDoNotInventTravelTimes() {
        Instant time=end.toInstant();
        var complete=List.of(zone("a",10,0,30.0,time,1),zone("b",20,10,60.0,time,1));
        assertEquals(30.0,DashboardWindowSummaryService.travelMinutes(complete,20.0));
        for(var points:List.of(List.of(zone("a",0,10,30.0,time,1)),
            List.of(zone("a",0,10,30.0,time,1),zone("b",11,21,60.0,time,1)),
            List.of(zone("a",0,10,30.0,time,1),zone("a",0,10,60.0,time,1)),
            List.of(zone("a",0,20,0.0,time,1)),List.of(zone("a",0,20,null,time,1)))) {
            assertNull(DashboardWindowSummaryService.travelMinutes(points,20.0));
        }
        assertNull(DashboardWindowSummaryService.travelMinutes(complete,null));
        var invalid=new TrafficSpeedZoneTrendPointDto("a",0,"a","a",null,20.0,65,time,60.0,60.0,1L);
        assertNull(DashboardWindowSummaryService.travelMinutes(List.of(invalid),20.0));
    }

    @Test void partialBucketDurationsDoNotOutweighWholeIntervals() {
        var until=OffsetDateTime.parse("2026-06-19T02:02:00Z");var left=until.minusMinutes(7).toInstant();var right=until.minusMinutes(2).toInstant();
        doReturn(raw(List.of(zone("a",0,10,30.0,left,1),zone("b",10,20,60.0,left,1),zone("a",0,10,60.0,right,1),zone("b",10,20,60.0,right,1))))
            .when(zones).find(eq("I25"),any(),any(),eq(5));
        assertEquals((30.0*5+20.0*2)/7,service.read(List.of("I25"),6,until).get("I25").averageTravelMinutes(),0.000001);
    }

    @Test void simultaneousColdReadsCannotFanOutDatabaseWork() throws Exception {
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        when(analytics.findWindowStatistics(eq("I25"),any(),any(),anyDouble(),nullable(OffsetDateTime.class))).thenAnswer(call->{entered.countDown();release.await(3,TimeUnit.SECONDS);return statistics;});
        var executor=Executors.newSingleThreadExecutor();
        try {
            var first=executor.submit(()->service.read(List.of("I25"),2,end));
            assertTrue(entered.await(3,TimeUnit.SECONDS));
            var second=service.read(List.of("I70"),2,end).get("I70");
            assertFalse(second.speedAvailable());assertTrue(second.busy());verify(analytics,never()).findWindowStatistics(eq("I70"),any(),any(),anyDouble(),nullable(OffsetDateTime.class));
            release.countDown();assertNotNull(first.get(3,TimeUnit.SECONDS));
        } finally {release.countDown();executor.shutdownNow();}
    }

    @Test void absentZonesUseRetainedCorridorEstimatesWithoutInventingWorstZone() {
        doReturn(List.of()).when(zones).find(anyString(),any(),any(),anyInt());
        var value=service.read(List.of("I25"),24,end).get("I25");
        assertEquals(28.0,value.averageTravelMinutes());assertEquals(22.0,value.fastestTravelMinutes());
        assertEquals(40.0,value.slowestTravelMinutes());assertEquals("CORRIDOR_AVERAGES",value.travelMethod());
        assertNull(value.worstZone());assertTrue(value.zonesAvailable());
    }

    @Test void invalidFallbackEstimatesRemainUnavailable() {
        doReturn(List.of()).when(zones).find(anyString(),any(),any(),anyInt());
        int offset=0;
        for(Double invalid:Arrays.asList(null,0.0,-1.0,Double.NaN,Double.POSITIVE_INFINITY)) {
            when(statistics.getAverageTravelMinutes()).thenReturn(invalid);
            when(statistics.getFastestTravelMinutes()).thenReturn(invalid);
            when(statistics.getSlowestTravelMinutes()).thenReturn(invalid);
            var value=service.read(List.of("I25"),24,end.plusDays(offset++)).get("I25");
            assertNull(value.averageTravelMinutes());assertNull(value.fastestTravelMinutes());assertNull(value.slowestTravelMinutes());
            assertEquals("UNAVAILABLE",value.travelMethod());
        }
    }

    @Test void missingDistanceDoesNotProduceFallbackTravelTimes() {
        when(corridors.findById("I25")).thenReturn(Optional.empty());
        doReturn(List.of()).when(zones).find(anyString(),any(),any(),anyInt());
        var value=service.read(List.of("I25"),24,end).get("I25");
        assertEquals(55.0,value.averageSpeed());assertNull(value.averageTravelMinutes());
        assertEquals("UNAVAILABLE",value.travelMethod());
    }

    @Test void incompleteOrStoppedZoneObservationsDoNotTriggerFallback() {
        for(double speed:List.of(0.0,60.0)) {
            doReturn(raw(List.of(zone("a",0,10,speed,minute.toInstant().minusSeconds(60),1))))
                .when(zones).find(anyString(),any(),any(),anyInt());
            var value=service.read(List.of("I25"),2,end.plusDays((long)speed)).get("I25");
            assertNull(value.averageTravelMinutes());assertEquals("UNAVAILABLE",value.travelMethod());
        }
    }

    @Test void recordedExtentSelectsHistoricalDistanceWithoutChangingOtherCorridors() {
        Instant changed=Instant.parse("2026-10-02T20:37:44Z");
        assertEquals(53.0,DashboardWindowSummaryService.distanceAt("I70",68.0,changed.minusSeconds(1),changed));
        assertEquals(68.0,DashboardWindowSummaryService.distanceAt("I70",68.0,changed,changed));
        assertEquals(68.0,DashboardWindowSummaryService.distanceAt("I70",68.0,changed.plusSeconds(1),changed));
        assertEquals(53.0,DashboardWindowSummaryService.distanceAt("I70",68.0,changed,null));
        assertEquals(20.0,DashboardWindowSummaryService.distanceAt("I70",20.0,changed,changed));
        assertEquals(63.0,DashboardWindowSummaryService.distanceAt("I25",63.0,changed.minusSeconds(1),changed));
        assertNull(DashboardWindowSummaryService.distanceAt("I70",null,changed,changed));
    }

    @Test void completeOlderZoneCoverageUsesItsRecordedExtent() {
        CorridorRef ref=new CorridorRef();ref.setCode("I70");ref.setStartMileMarker(206.0);ref.setEndMileMarker(274.0);
        when(corridors.findById("I70")).thenReturn(Optional.of(ref));
        var extent=new org.springframework.data.projection.SpelAwareProxyProjectionFactory().createProjection(
            TrafficAnalyticsRepository.RecordedExtentChange.class,
            Map.of("changedAt",java.sql.Timestamp.from(Instant.parse("2026-10-02T20:37:44Z"))));
        when(analytics.findRecordedI70ExtentChange()).thenReturn(extent);
        doReturn(raw(List.of(zone("old",206,259,60.0,minute.toInstant().minusSeconds(60),1))))
            .when(zones).find(eq("I70"),any(),any(),anyInt());
        var value=service.read(List.of("I70"),2,end).get("I70");
        assertEquals(53.0,value.averageTravelMinutes());assertEquals("ZONE_BUCKETS",value.travelMethod());
        service.read(List.of("I70"),6,end);
        verify(analytics,times(1)).findRecordedI70ExtentChange();
        verify(analytics).findWindowStatistics("I70",minute.minusHours(2),minute,68.0,OffsetDateTime.parse("2026-10-02T20:37:44Z"));
    }

    @Test void archivedIncidentsAreEstimatedWithoutUsingCappedMarkers() {
        when(incidents.hasDurableEventsAtOrBefore(any())).thenReturn(false);
        when(incidents.hasHistoricalObservationsAtOrBefore(eq("I25"),any())).thenReturn(true);
        when(legacy.count(eq("I25"),any(),any())).thenReturn(1121L);
        doReturn(List.of()).when(zones).find(anyString(),any(),any(),anyInt());
        var value=service.read(List.of("I25"),720,end).get("I25");
        assertEquals(1121L,value.observedIncidents());assertTrue(value.incidentsAvailable());
        assertEquals("RECONSTRUCTED_EPISODES",value.incidentMethod());assertEquals(41.0,value.lowestObservedSpeed());
        verify(incidents,never()).findHistoricalTimelineByCorridorBetween(anyString(),any(),any(),any(),anyInt());
        service.read(List.of("I25"),720,end.withSecond(59));
        verify(legacy,times(1)).count(anyString(),any(),any());
    }

    @Test void speedAndTravelForBothCorridorsAreEmittedBeforeSlowCounts() {
        List<DashboardWindowSummaryService.Frame> frames=new ArrayList<>();
        when(incidents.countDurableTimelineByCorridorBetween(eq("I25"),any(),any())).thenAnswer(call->{
            assertEquals(55.0,frames.getLast().summaries().get("I70").averageSpeed());
            assertEquals(25.0,frames.getLast().summaries().get("I70").averageTravelMinutes());
            return 1501L;
        });
        var result=service.read(List.of("I25","I70"),24,end,frames::add);
        assertEquals(55.0,frames.getFirst().summaries().get("I25").averageSpeed());
        assertNull(frames.getFirst().summaries().get("I25").observedIncidents());
        assertFalse(frames.getFirst().complete());assertTrue(frames.getLast().complete());
        assertEquals(result,frames.getLast().summaries());
        frames.clear();service.read(List.of("I25","I70"),24,end,frames::add);
        assertEquals(1,frames.size());assertTrue(frames.getFirst().complete());
        verify(corridors,times(1)).findById("I25");
    }

    @Test void disconnectAfterTheFirstStageStopsExpensiveWorkAndReleasesCapacity() {
        assertThrows(IllegalStateException.class,()->service.read(List.of("I25","I70"),24,end,frame->{throw new IllegalStateException("Disconnected");}));
        verifyNoInteractions(legacy);verify(incidents,never()).hasDurableEventsAtOrBefore(any());
        verify(zones,never()).find(anyString(),any(),any(),anyInt());
        assertFalse(service.read(List.of("I25"),24,end).get("I25").busy());
    }

    @Test void aCachedCorridorIsEmittedBeforeTheOtherCorridorStartsLoading() {
        service.read(List.of("I25"),24,end);
        List<DashboardWindowSummaryService.Frame> frames=new ArrayList<>();
        when(analytics.findWindowStatistics(eq("I70"),any(),any(),anyDouble(),nullable(OffsetDateTime.class))).thenAnswer(call->{
            assertEquals(1501L,frames.getFirst().summaries().get("I25").observedIncidents());return statistics;
        });
        service.read(List.of("I25","I70"),24,end,frames::add);
        assertFalse(frames.getFirst().complete());assertTrue(frames.getLast().complete());
    }

    @Test void aPendingIncidentCalculationCannotBlockAnotherWindowsEarlyFields() throws Exception {
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),ready=new CountDownLatch(1);
        when(incidents.countDurableTimelineByCorridorBetween(eq("I25"),any(),eq(minute))).thenAnswer(call->{entered.countDown();release.await(3,TimeUnit.SECONDS);return 1501L;});
        var executor=Executors.newFixedThreadPool(2);
        try {
            var first=executor.submit(()->service.read(List.of("I25"),24,end,ignored->{}));
            assertTrue(entered.await(3,TimeUnit.SECONDS));
            var next=executor.submit(()->service.read(List.of("I25"),24,end.minusHours(1),frame->{
                if(frame.summaries().get("I25").averageTravelMinutes()!=null) ready.countDown();
            }));
            assertTrue(ready.await(2,TimeUnit.SECONDS));assertFalse(next.get(2,TimeUnit.SECONDS).get("I25").busy());
            release.countDown();first.get(3,TimeUnit.SECONDS);
        } finally {release.countDown();executor.shutdownNow();}
    }

    @Test void failedArchivedReadsPreserveEarlierMetricsAndDoNotInventZero() {
        when(incidents.hasDurableEventsAtOrBefore(any())).thenReturn(false);
        when(incidents.hasHistoricalObservationsAtOrBefore(anyString(),any())).thenReturn(true);
        when(legacy.count(anyString(),any(),any())).thenThrow(new IllegalStateException("Timeout"));
        var value=service.read(List.of("I25"),24,end).get("I25");
        assertEquals(55.0,value.averageSpeed());assertEquals(25.0,value.averageTravelMinutes());
        assertNull(value.observedIncidents());assertFalse(value.incidentsAvailable());assertEquals("UNAVAILABLE",value.incidentMethod());
    }
}
