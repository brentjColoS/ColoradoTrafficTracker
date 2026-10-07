package com.example.api_service;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DirectionalCorridorGeometryController.class)
@AutoConfigureMockMvc(addFilters = false)
class DirectionalCorridorGeometryControllerTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private DirectionalCorridorGeometryClient geometryClient;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @MockBean
    private DashboardProps dashboardProps;

    @Test
    void returnsCacheableDirectionalGeometryForATrackedCorridor() throws Exception {
        when(geometryClient.fetch("I25")).thenReturn(Optional.of(objectMapper.readTree("""
            {"type":"FeatureCollection","features":[]}
            """)));

        mvc.perform(get("/dashboard-api/traffic/map/corridors/directions").param("corridor", "I-25"))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "max-age=86400, public"))
            .andExpect(jsonPath("$.type").value("FeatureCollection"));
        verify(geometryClient).fetch("I25");
    }

    @Test
    void rejectsUnknownCorridorsAndReportsUnavailableGeometry() throws Exception {
        mvc.perform(get("/dashboard-api/traffic/map/corridors/directions").param("corridor", "I76"))
            .andExpect(status().isBadRequest());

        when(geometryClient.fetch("I70")).thenReturn(Optional.empty());
        mvc.perform(get("/dashboard-api/traffic/map/corridors/directions").param("corridor", "I70"))
            .andExpect(status().isServiceUnavailable());
    }
}
