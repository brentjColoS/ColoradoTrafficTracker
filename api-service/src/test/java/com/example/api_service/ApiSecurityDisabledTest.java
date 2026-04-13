package com.example.api_service;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    properties = {
        "api.security.enabled=false",
        "api.rate-limit.enabled=false",
        "api.rate-limit.requests-per-minute=1",
        "spring.flyway.enabled=false",
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration"
    }
)
@AutoConfigureMockMvc
class ApiSecurityDisabledTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficSampleRepository sampleRepo;

    @MockBean
    private TrafficHistorySampleRepository historyRepo;

    @MockBean
    private CorridorRefRepository corridorRefRepository;

    @MockBean
    private TrafficHistoryIncidentRepository incidentRepository;

    @MockBean
    private TrafficAnalyticsRepository analyticsRepository;

    @Test
    void protectedRoutesDoNotRequireApiKeyWhenSecurityDisabled() throws Exception {
        when(sampleRepo.findFirstByCorridorOrderByPolledAtDesc("I25")).thenReturn(Optional.empty());

        mvc.perform(get("/api/traffic/latest").param("corridor", "I25"))
            .andExpect(status().isNotFound());
    }

    @Test
    void rateLimitDoesNotThrottleWhenDisabled() throws Exception {
        when(historyRepo.findDistinctCorridors()).thenReturn(List.of("I25", "I70"));

        mvc.perform(get("/api/traffic/corridors"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/traffic/corridors"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/traffic/corridors"))
            .andExpect(status().isOk());
    }
}
