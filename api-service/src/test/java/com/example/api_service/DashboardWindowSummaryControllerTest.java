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
    final DashboardWindowSummaryController controller=new DashboardWindowSummaryController(service,
        new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules());
    final OffsetDateTime end=OffsetDateTime.parse("2026-06-19T02:00:00Z");

    @Test void invalidReadsDoNotReachTheDatabase() {
        for(var selection:List.of(List.<String>of(),List.of("I25","I70","I25"),List.of("I80")))
            assertEquals(400,controller.summary(selection,24,end).getStatusCode().value());
        assertEquals(400,controller.summary(List.of("I25"),3,end).getStatusCode().value());
        assertEquals(400,controller.summary(List.of("I25"),24,null).getStatusCode().value());
        assertEquals(400,controller.summary(List.of("I25"),24,OffsetDateTime.now().plusDays(1)).getStatusCode().value());
        assertEquals(400,controller.progressive(List.of("I25"),3,end).getStatusCode().value());
        verifyNoInteractions(service);
    }

    @Test void oneReadSupportsBothCorridorsAndDeduplicatesSelection() {
        when(service.read(anyList(),anyInt(),any())).thenReturn(Map.of());
        assertEquals(200,controller.summary(List.of("I25","I70"),720,end).getStatusCode().value());
        assertEquals(200,controller.summary(List.of("I25","I25"),2,end).getStatusCode().value());
        verify(service).read(List.of("I25","I70"),720,end);
        verify(service).read(List.of("I25"),2,end);
    }

    @Test void progressiveReadsFlushFramesAndKeepTheOrdinaryJsonContract() throws Exception {
        var frame=new DashboardWindowSummaryService.Frame(Map.of(),true);
        doAnswer(call->{java.util.function.Consumer<DashboardWindowSummaryService.Frame> update=call.getArgument(3);update.accept(frame);return Map.of();})
            .when(service).read(anyList(),anyInt(),any(),any());
        var response=controller.progressive(List.of("I25","I25"),24,end);
        var bytes=new java.io.ByteArrayOutputStream();
        response.getBody().writeTo(bytes);
        assertEquals("application/x-ndjson",response.getHeaders().getContentType().toString());
        assertEquals("no-store",response.getHeaders().getCacheControl());
        assertEquals("{\"summaries\":{},\"complete\":true}\n",bytes.toString(java.nio.charset.StandardCharsets.UTF_8));
        verify(service).read(eq(List.of("I25")),eq(24),eq(end),any());
    }
}
