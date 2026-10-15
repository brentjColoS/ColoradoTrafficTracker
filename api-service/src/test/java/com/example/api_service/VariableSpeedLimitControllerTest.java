package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

class VariableSpeedLimitControllerTest {
    final Instant now=Instant.parse("2026-10-14T23:00:00Z");
    final ObjectMapper mapper=new ObjectMapper().findAndRegisterModules();
    final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    final Clock clock=Clock.fixed(now,ZoneOffset.UTC);

    VariableSpeedSign sign(String status, Instant fetched) {
        var device=I70VariableSpeedSigns.device("OpenTMS-Sign475239");
        return new VariableSpeedSign(device.id(),device.mileMarker(),device.direction(),device.longitude(),device.latitude(),
            device.location(),65,45,status,"on","operational",now.minusSeconds(90_000),null,fetched,fetched);
    }

    void row(VariableSpeedSign sign) throws Exception {
        ResultSet result=mock(ResultSet.class);
        when(result.getString("sign_id")).thenReturn(sign.id());
        when(result.getString("payload_json")).thenReturn(mapper.writeValueAsString(sign));
        doAnswer(invocation -> {invocation.getArgument(1,RowCallbackHandler.class).processRow(result);return null;})
            .when(jdbc).query(anyString(),any(RowCallbackHandler.class),any(Object[].class));
    }

    @Test void rejectsOtherCorridorsWithoutReadingTheDatabase() {
        assertThat(new VariableSpeedLimitController(jdbc,mapper,clock).current("I25").getStatusCode().value()).isEqualTo(400);
        verifyNoInteractions(jdbc);
    }

    @Test void returnsCatalogUnknownsWhenIngestionHasNotStarted() {
        var snapshot=new VariableSpeedLimitController(null,mapper,clock).current("I70").getBody();
        assertThat(snapshot.status()).isEqualTo("UNAVAILABLE");
        assertThat(snapshot.signs()).hasSize(42).allMatch(value -> value.reportedLimitMph()==null);
        assertThat(snapshot.belowRegularSignCount()).isZero();
    }

    @Test void missingTableOrReadPermissionsDoNotHideTheTrafficDashboard() {
        doThrow(new DataAccessResourceFailureException("fixture database unavailable"))
            .when(jdbc).query(anyString(),any(RowCallbackHandler.class),any(Object[].class));
        var snapshot=new VariableSpeedLimitController(jdbc,mapper,clock).current("I70").getBody();
        assertThat(snapshot.status()).isEqualTo("UNAVAILABLE");
        assertThat(snapshot.detail()).contains("read permissions");
        assertThat(snapshot.signs()).hasSize(42);
    }

    @Test void reportsOnlyFreshConfirmedReductionsAndPreservesSourceAndReadTimes() throws Exception {
        row(sign("AVAILABLE",now));
        var snapshot=new VariableSpeedLimitController(jdbc,mapper,clock).current("I70").getBody();
        assertThat(snapshot.availableSignCount()).isEqualTo(1);
        assertThat(snapshot.belowRegularSignCount()).isEqualTo(1);
        assertThat(snapshot.signs()).anySatisfy(value -> {
            assertThat(value.sourceUpdatedAt()).isEqualTo(now.minusSeconds(90_000));
            assertThat(value.fetchedAt()).isEqualTo(now);
        });
    }

    @Test void aFailedReadOrOldReadCannotConfirmAChangedLimit() throws Exception {
        for (var state:java.util.List.of(sign("FETCH_FAILED",now),sign("AVAILABLE",now.minusSeconds(3601)),sign("AVAILABLE",null))) {
            row(state);
            var snapshot=new VariableSpeedLimitController(jdbc,mapper,clock).current("I70").getBody();
            assertThat(snapshot.belowRegularSignCount()).isZero();
            assertThat(snapshot.availableSignCount()).isZero();
        }
    }
}
