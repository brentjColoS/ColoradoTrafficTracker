package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowMapper;

class VariableSpeedHistoryControllerTest {
    private final Instant now = Instant.parse("2026-11-18T12:00:00Z");
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final VariableSpeedHistoryController controller = new VariableSpeedHistoryController(
        jdbc, new ObjectMapper().findAndRegisterModules(), Clock.fixed(now, ZoneOffset.UTC));

    @Test void validatesBeforeReadingAndHasNoProviderDependency() {
        assertEquals(400, controller.history("I25", 24, now).getStatusCode().value());
        for (int hours : new int[]{0, -1, 721, Integer.MAX_VALUE}) {
            assertEquals(400, controller.history("I70", hours, now).getStatusCode().value());
        }
        assertEquals(400, controller.history("I70", 24, now.plusSeconds(61)).getStatusCode().value());
        assertEquals(400, controller.history("I70", 720, Instant.MIN).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }

    @Test void missingHistoryDoesNotPretendLimitsWereNormal() {
        var missing = new VariableSpeedHistoryController(null, new ObjectMapper(), Clock.fixed(now, ZoneOffset.UTC));
        assertEquals(503, missing.history("I70", 24, now).getStatusCode().value());
    }

    @Test void neverReturnsAnIncompleteHistoryPrefix() {
        doReturn(java.util.Collections.nCopies(VariableSpeedHistoryController.MAX_ROWS + 1, null))
            .when(jdbc).query(any(PreparedStatementCreator.class), any(RowMapper.class));
        assertEquals(422, controller.history("I70", 720, now).getStatusCode().value());
    }

    @Test void bindsHttpParametersWithoutCompilerParameterMetadata() throws Exception {
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        var get = org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
            "/dashboard-api/traffic/map/variable-speed-limits/history");
        mvc.perform(get.param("corridor", "I70").param("windowHours", "6").param("asOf", now.toString()))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
    }
}
