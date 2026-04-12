package com.example.api_service;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    properties = {
        "api.security.enabled=true",
        "api.security.keys=test-key,another-key,fresh-key,fresh-other-key",
        "api.rate-limit.enabled=true",
        "api.rate-limit.requests-per-minute=2",
        "spring.flyway.enabled=false",
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration"
    }
)
@AutoConfigureMockMvc
class ApiSecurityAndRateLimitTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficSampleRepository sampleRepo;

    @MockBean
    private TrafficHistorySampleRepository historyRepo;

    @Test
    void apiRequiresKeyForProtectedRoutes() throws Exception {
        mvc.perform(get("/api/traffic/latest").param("corridor", "I25"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void healthEndpointIsPublic() throws Exception {
        mvc.perform(get("/api/traffic/health"))
            .andExpect(status().isOk());
    }

    @Test
    void dashboardIsPublic() throws Exception {
        mvc.perform(get("/dashboard/index.html"))
            .andExpect(status().isOk());
    }

    @Test
    void dashboardRootForwardsToIndex() throws Exception {
        mvc.perform(get("/dashboard/"))
            .andExpect(status().isOk());
    }

    @Test
    void rateLimitReturnsTooManyRequestsAfterThreshold() throws Exception {
        when(historyRepo.findDistinctCorridors()).thenReturn(List.of("I25", "I70"));

        mvc.perform(get("/api/traffic/corridors").header("X-API-Key", "test-key"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/traffic/corridors").header("X-API-Key", "test-key"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/traffic/corridors").header("X-API-Key", "test-key"))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void rateLimitBucketsRequestsPerApiKey() throws Exception {
        when(historyRepo.findDistinctCorridors()).thenReturn(List.of("I25", "I70"));

        mvc.perform(get("/api/traffic/corridors").header("X-API-Key", "fresh-key"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/traffic/corridors").header("X-API-Key", "fresh-key"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/traffic/corridors").header("X-API-Key", "fresh-other-key"))
            .andExpect(status().isOk());
    }
}
