package com.example.api_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.api_service.dto.OperationalCheckDto;
import com.example.api_service.dto.OperationalStatusDto;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(OperationalStatusController.class)
@AutoConfigureMockMvc(addFilters = false)
class OperationalStatusControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private OperationalStatusService statusService;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @MockBean
    private DashboardProps dashboardProps;

    @Test
    void exposesChecksOnTheDashboardStatusRoute() throws Exception {
        OffsetDateTime checkedAt = OffsetDateTime.parse("2026-08-31T18:00:00Z");
        when(statusService.assess(any())).thenReturn(new OperationalStatusDto(
            "DEGRADED",
            checkedAt,
            "One check needs attention.",
            List.of(new OperationalCheckDto(
                "flow:I70",
                "DEGRADED",
                "FLOW_SAMPLE_STALE",
                "The latest usable I70 flow sample is 61 minutes old.",
                checkedAt.minusMinutes(61),
                61,
                60,
                "Check the ingest scheduler."
            ))
        ));

        mvc.perform(get("/dashboard-api/system/operational-status"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DEGRADED"))
            .andExpect(jsonPath("$.checks[0].component").value("flow:I70"))
            .andExpect(jsonPath("$.checks[0].code").value("FLOW_SAMPLE_STALE"))
            .andExpect(jsonPath("$.checks[0].thresholdMinutes").value(60))
            .andExpect(jsonPath("$.checks[0].suggestedAction").value("Check the ingest scheduler."));
    }
}
