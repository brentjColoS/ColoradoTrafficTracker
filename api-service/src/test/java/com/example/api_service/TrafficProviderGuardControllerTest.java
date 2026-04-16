package com.example.api_service;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficProviderGuardController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficProviderGuardControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficProviderGuardStatusRepository statusRepository;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @MockBean
    private DashboardProps dashboardProps;

    @Test
    void returnsUnknownStatusWhenGuardRowIsMissing() throws Exception {
        when(statusRepository.findById("tomtom")).thenReturn(Optional.empty());

        mvc.perform(get("/dashboard-api/system/provider-status"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.providerName").value("tomtom"))
            .andExpect(jsonPath("$.state").value("UNKNOWN"))
            .andExpect(jsonPath("$.halted").value(false));
    }

    @Test
    void returnsPersistedGuardStatus() throws Exception {
        TrafficProviderGuardStatus guardStatus = new TrafficProviderGuardStatus();
        guardStatus.setProviderName("tomtom");
        guardStatus.setState("HALTED");
        guardStatus.setHalted(true);
        guardStatus.setFailureCode("AUTH_FORBIDDEN");
        guardStatus.setMessage("Ingestion halted because TomTom rejected the configured API key.");
        guardStatus.setConsecutiveNullCycles(0);
        guardStatus.setLastCheckedAt(OffsetDateTime.of(2026, 4, 16, 1, 55, 0, 0, ZoneOffset.UTC));
        guardStatus.setLastFailureAt(OffsetDateTime.of(2026, 4, 16, 1, 55, 0, 0, ZoneOffset.UTC));
        guardStatus.setShutdownTriggeredAt(OffsetDateTime.of(2026, 4, 16, 1, 55, 5, 0, ZoneOffset.UTC));

        when(statusRepository.findById("tomtom")).thenReturn(Optional.of(guardStatus));

        mvc.perform(get("/api/system/provider-status"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("HALTED"))
            .andExpect(jsonPath("$.halted").value(true))
            .andExpect(jsonPath("$.failureCode").value("AUTH_FORBIDDEN"))
            .andExpect(jsonPath("$.message").value("Ingestion halted because TomTom rejected the configured API key."));
    }
}
