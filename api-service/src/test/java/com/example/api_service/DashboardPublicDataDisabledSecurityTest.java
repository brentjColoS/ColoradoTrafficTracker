package com.example.api_service;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    properties = {
        "api.security.enabled=true",
        "api.security.keys=test-key",
        "dashboard.public-data-enabled=false",
        "api.rate-limit.enabled=false",
        "spring.flyway.enabled=false",
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration"
    }
)
@AutoConfigureMockMvc
class DashboardPublicDataDisabledSecurityTest {

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
    void dashboardApiSurfaceIsDeniedWhenPublicDataDisabled() throws Exception {
        mvc.perform(get("/dashboard-api/traffic/corridors"))
            .andExpect(status().isForbidden());
    }
}
