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
    final Clock clock = Clock.fixed(Instant.parse("2026-10-13T05:00:00Z"), ZoneOffset.UTC);
    final DashboardWindowSummaryService service = new DashboardWindowSummaryService(zones, incidents, corridors, analytics, clock);
    final OffsetDateTime end = OffsetDateTime.parse("2026-06-19T02:00:42Z");
    final OffsetDateTime minute = end.withSecond(0);

    DashboardWindowSummaryServiceTest() {
        for (String code : List.of("I25","I70")) {
            CorridorRef ref = new CorridorRef(); ref.setCode(code); ref.setStartMileMarker(20.0); ref.setEndMileMarker(0.0);
            when(corridors.findById(code)).thenReturn(Optional.of(ref));
        }
        when(incidents.hasDurableEventsAtOrBefore(any())).thenReturn(true);
        when(incidents.countDurableTimelineByCorridorBetween(anyString(),any(),any())).thenReturn(1501L);
        when(analytics.findWindowAverageSpeed(anyString(),any(),any())).thenReturn(55.0);
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
        assertEquals(52.5,value.worstZone().speedMph()); assertEquals(1501L,value.observedIncidents());
        assertEquals(1,value.bucketMinutes());
        verify(incidents).countDurableTimelineByCorridorBetween("I25",minute.minusHours(2),minute);
        service.read(List.of("I25"),2,end.withSecond(59));
        verify(analytics,times(1)).findWindowAverageSpeed("I25",minute.minusHours(2),minute);
    }

    @Test void longWindowsUseExactSpeedBoundsAndAllSupportedResolutions() {
        for(int hours:List.of(2,6,24,168,720)) {
            var value=service.read(List.of("I25","I70"),hours,end).get("I25");
            assertEquals(hours,value.hours());
            assertEquals(Map.of(2,1,6,5,24,15,168,60,720,180).get(hours),value.bucketMinutes());
            assertEquals(55.0,value.averageSpeed());
            verify(analytics).findWindowAverageSpeed("I25",minute.minusHours(hours),minute);
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
        when(analytics.findWindowAverageSpeed(anyString(),any(),any())).thenReturn(null);
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
        when(analytics.findWindowAverageSpeed(eq("I25"),any(),any())).thenAnswer(call->{entered.countDown();release.await(3,TimeUnit.SECONDS);return 55.0;});
        var executor=Executors.newSingleThreadExecutor();
        try {
            var first=executor.submit(()->service.read(List.of("I25"),2,end));
            assertTrue(entered.await(3,TimeUnit.SECONDS));
            var second=service.read(List.of("I70"),2,end).get("I70");
            assertFalse(second.speedAvailable());assertTrue(second.busy());verify(analytics,never()).findWindowAverageSpeed(eq("I70"),any(),any());
            release.countDown();assertNotNull(first.get(3,TimeUnit.SECONDS));
        } finally {release.countDown();executor.shutdownNow();}
    }
}
