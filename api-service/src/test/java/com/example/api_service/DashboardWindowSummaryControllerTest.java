package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DashboardWindowSummaryControllerTest {
    final DashboardWindowSummaryService service=mock(DashboardWindowSummaryService.class);
    final DashboardWindowSummaryController controller=new DashboardWindowSummaryController(service);
    final OffsetDateTime end=OffsetDateTime.parse("2026-06-19T02:00:00Z");

    @Test void invalidReadsDoNotReachTheDatabase() {
        for(var selection:List.of(List.<String>of(),List.of("I25","I70","I25"),List.of("I80")))
            assertEquals(400,controller.summary(selection,24,end).getStatusCode().value());
        assertEquals(400,controller.summary(List.of("I25"),3,end).getStatusCode().value());
        assertEquals(400,controller.summary(List.of("I25"),24,null).getStatusCode().value());
        assertEquals(400,controller.summary(List.of("I25"),24,OffsetDateTime.now().plusDays(1)).getStatusCode().value());
        verifyNoInteractions(service);
    }

    @Test void oneReadSupportsBothCorridorsAndDeduplicatesSelection() {
        when(service.read(anyList(),anyInt(),any())).thenReturn(Map.of());
        assertEquals(200,controller.summary(List.of("I25","I70"),720,end).getStatusCode().value());
        assertEquals(200,controller.summary(List.of("I25","I25"),2,end).getStatusCode().value());
        verify(service).read(List.of("I25","I70"),720,end);
        verify(service).read(List.of("I25"),2,end);
    }
}
