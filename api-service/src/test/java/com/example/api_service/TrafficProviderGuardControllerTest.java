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
            .andExpect(jsonPath("$.halted").value(false))
            .andExpect(jsonPath("$.freshnessState").value("UNKNOWN"))
            .andExpect(jsonPath("$.stale").value(false));
    }

    @Test
    void returnsPersistedGuardStatus() throws Exception {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficProviderGuardStatus guardStatus = new TrafficProviderGuardStatus();
        guardStatus.setProviderName("tomtom");
        guardStatus.setState("HALTED");
        guardStatus.setHalted(true);
        guardStatus.setFailureCode("AUTH_FORBIDDEN");
        guardStatus.setMessage("Ingestion halted because TomTom rejected the configured API key.");
        guardStatus.setConsecutiveNullCycles(0);
        guardStatus.setLastCheckedAt(now.minusMinutes(1));
        guardStatus.setLastFailureAt(now.minusMinutes(1));
        guardStatus.setShutdownTriggeredAt(now.minusSeconds(30));

        when(statusRepository.findById("tomtom")).thenReturn(Optional.of(guardStatus));

        mvc.perform(get("/api/system/provider-status"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("HALTED"))
            .andExpect(jsonPath("$.halted").value(true))
            .andExpect(jsonPath("$.failureCode").value("AUTH_FORBIDDEN"))
            .andExpect(jsonPath("$.message").value("Ingestion halted because TomTom rejected the configured API key."))
            .andExpect(jsonPath("$.freshnessState").value("FRESH"))
            .andExpect(jsonPath("$.stale").value(false));
    }

    @Test
    void marksProviderStatusAsStaleWhenLastCheckIsOld() throws Exception {
        TrafficProviderGuardStatus guardStatus = new TrafficProviderGuardStatus();
        guardStatus.setProviderName("tomtom");
        guardStatus.setState("HEALTHY");
        guardStatus.setHalted(false);
        guardStatus.setMessage("Provider traffic data is returning usable corridor speeds.");
        guardStatus.setLastCheckedAt(OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(45));

        when(statusRepository.findById("tomtom")).thenReturn(Optional.of(guardStatus));

        mvc.perform(get("/dashboard-api/system/provider-status"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.state").value("HEALTHY"))
            .andExpect(jsonPath("$.freshnessState").value("STALE"))
            .andExpect(jsonPath("$.stale").value(true))
            .andExpect(jsonPath("$.statusAgeMinutes").isNumber());
    }
}
