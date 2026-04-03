package com.example.api_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficSampleRepository repo;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @Test
    void latestReturnsBadRequestForBlankCorridor() throws Exception {
        mvc.perform(get("/api/traffic/latest").param("corridor", " "))
            .andExpect(status().isBadRequest());
    }

    @Test
    void latestReturnsDtoPayload() throws Exception {
        TrafficSample sample = sample("I25", 55.0);
        when(repo.findFirstByCorridorOrderByPolledAtDesc("I25")).thenReturn(Optional.of(sample));

        mvc.perform(get("/api/traffic/latest").param("corridor", "I25"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I25"))
            .andExpect(jsonPath("$.avgCurrentSpeed").value(55.0));
    }

    @Test
    void historyReturnsBadRequestForInvalidRange() throws Exception {
        mvc.perform(get("/api/traffic/history").param("corridor", "I25").param("windowMinutes", "0"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/history").param("corridor", "I25").param("limit", "0"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void historyReturnsSamples() throws Exception {
        TrafficSample sample = sample("I70", 43.0);
        when(repo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I70"), any(), eq(PageRequest.of(0, 2))))
            .thenReturn(new PageImpl<>(List.of(sample)));

        mvc.perform(get("/api/traffic/history")
                .param("corridor", "I70")
                .param("windowMinutes", "120")
                .param("limit", "2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I70"))
            .andExpect(jsonPath("$.returned").value(1))
            .andExpect(jsonPath("$.samples[0].avgCurrentSpeed").value(43.0));
    }

    @Test
    void corridorsReturnsDistinctNames() throws Exception {
        when(repo.findDistinctCorridors()).thenReturn(List.of("I25", "I70"));

        mvc.perform(get("/api/traffic/corridors"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0]").value("I25"))
            .andExpect(jsonPath("$[1]").value("I70"));
    }

    private static TrafficSample sample(String corridor, double speed) {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(corridor);
        sample.setAvgCurrentSpeed(speed);
        sample.setAvgFreeflowSpeed(60.0);
        sample.setMinCurrentSpeed(speed - 10.0);
        sample.setConfidence(0.85);
        sample.setIncidentsJson("{\"incidents\":[]}");
        sample.setPolledAt(OffsetDateTime.of(2026, 4, 3, 12, 0, 0, 0, ZoneOffset.UTC));
        return sample;
    }
}
