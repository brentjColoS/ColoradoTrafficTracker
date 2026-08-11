package com.example.api_service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.api_service.dto.IncidentModelParityDto;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class IncidentModelParityControllerTest {

    @Test
    void exposesTheCurrentComparison() throws Exception {
        IncidentModelParityService service = mock(IncidentModelParityService.class);
        when(service.compare()).thenReturn(new IncidentModelParityDto(
            OffsetDateTime.of(2026, 8, 11, 20, 0, 0, 0, ZoneOffset.UTC),
            true,
            true,
            null,
            2,
            3,
            3,
            3,
            0,
            List.of()
        ));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(
            new IncidentModelParityController(service)
        ).build();

        mvc.perform(get("/api/traffic/incidents/parity"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.inParity").value(true))
            .andExpect(jsonPath("$.corridorCount").value(2))
            .andExpect(jsonPath("$.mismatchCount").value(0));
    }
}
