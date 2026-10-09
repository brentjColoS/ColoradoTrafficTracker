package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.example.api_service.DashboardDataController.Section;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class DashboardDataControllerTest {
    final DashboardDataService service = mock(DashboardDataService.class);
    final DashboardDataController controller = new DashboardDataController(service);

    @Test void rejectsUnboundedRangesCorridorsAndVersionHints() {
        assertEquals(400,controller.snapshot(List.of(1),24,false,"").getStatusCode().value());
        assertEquals(400,controller.snapshot(List.of(),24,false,"").getStatusCode().value());
        assertEquals(400,controller.snapshot(List.of(24),1,false,"").getStatusCode().value());
        assertEquals(400,controller.snapshot(List.of(24),24,false,"x".repeat(4097)).getStatusCode().value());
        assertEquals(400,controller.snapshot(List.of(2,2,2,2,2,2),24,false,"").getStatusCode().value());
        OffsetDateTime end=OffsetDateTime.now();
        assertEquals(400,controller.history(List.of("unknown"),24,end,false,"").getStatusCode().value());
        assertEquals(400,controller.history(List.of(),24,end,false,"").getStatusCode().value());
        assertEquals(400,controller.history(List.of("I25","I70","I25"),24,end,false,"").getStatusCode().value());
        assertEquals(400,controller.history(List.of("I25"),1,end,false,"").getStatusCode().value());
        assertEquals(400,controller.history(List.of("I25"),24,null,false,"").getStatusCode().value());
        assertEquals(400,controller.history(List.of("I25"),24,end,false,"x".repeat(4097)).getStatusCode().value());
        verifyNoInteractions(service);
    }

    @Test void acceptsOnlyWhitelistedReadsAndDeduplicatesInputs() {
        when(service.snapshot(anyList(),anyInt(),anyBoolean(),anySet())).thenReturn(Map.of());
        assertEquals(200,controller.snapshot(List.of(24,24),24,false,"same,same").getStatusCode().value());
        verify(service).snapshot(List.of(24),24,false,Set.of("same"));
        OffsetDateTime end=OffsetDateTime.now();
        when(service.history(anyList(),anyInt(),any(),anyBoolean(),anySet())).thenReturn(Map.of());
        assertEquals(200,controller.history(List.of("I25","I25"),6,end,true,"").getStatusCode().value());
        verify(service).history(List.of("I25"),6,end,true,Set.of(""));
    }

    @Test void bootstrapEscapesProviderTextAndHonorsPublicDataAndReviewModes() throws Exception {
        when(service.bootstrap()).thenReturn(Map.of("example",
            new Section(200,"one",OffsetDateTime.now(),Map.of("description","</script><script>alert(1)</script>"))));
        var mapper=new ObjectMapper().findAndRegisterModules();
        var page=new DashboardPageController(service,mapper,new DashboardProps(true,60));
        String html=page.page("0","0","0").getBody();
        assertTrue(html.contains("id=\"dashboardBootstrap\""));
        assertTrue(html.contains("data-deferred=\"zones\""));
        assertFalse(html.contains("</script><script>alert(1)</script>"));
        assertTrue(html.contains("\\u003c/script>"));
        assertEquals("no-store",page.page("0","0","0").getHeaders().getCacheControl());
        for(String[] mode:List.of(new String[]{"1","0","0"},new String[]{"0","1","0"},new String[]{"0","0","1"})) {
            assertFalse(page.page(mode[0],mode[1],mode[2]).getBody().contains("dashboardBootstrap"));
        }
        assertFalse(new DashboardPageController(service,mapper,new DashboardProps(false,60))
            .page("0","0","0").getBody().contains("dashboardBootstrap"));
        verify(service,times(2)).bootstrap();
        verify(service,never()).snapshot(anyList(),anyInt(),anyBoolean(),anySet());
    }
    @Test void mvcBindsBatchParametersAndOmitsUnchangedPayloads() throws Exception {
        when(service.snapshot(anyList(),anyInt(),anyBoolean(),anySet())).thenReturn(Map.of("health",
            new Section(200,"known",OffsetDateTime.now(),null)));
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller)
            .setMessageConverters(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(
                new ObjectMapper().findAndRegisterModules())).build();
        for(String base:List.of("/api","/dashboard-api")) mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(base+"/traffic/dashboard/snapshot")
                .param("ranges","2,6,24").param("selectedHours","6").param("known","known"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.health.version").value("known"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.health.data").doesNotExist());
        verify(service,times(2)).snapshot(List.of(2,6,24),6,false,Set.of("known"));
    }

}
