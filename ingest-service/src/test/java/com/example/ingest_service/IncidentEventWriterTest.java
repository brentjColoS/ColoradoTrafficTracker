package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

class IncidentEventWriterTest {

    @Test
    void upsertsStableIdentityCorridorAssignmentAndChangeObservation() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
            .thenReturn(42L);
        IncidentEventWriter writer = new IncidentEventWriter(jdbcTemplate, new ObjectMapper());

        writer.publish(Map.of(
            "I25",
            snapshot(
                """
                    {
                      "incidents": [{
                        "properties": {
                          "providerEventId": "OpenTMS-Incident-42",
                          "sourceStatus": "report",
                          "normalizedStatus": "active",
                          "sourceCategory": "Crash",
                          "normalizedCategory": "crash",
                          "description": "Crash between exits",
                          "lastUpdated": "2026-07-27T17:58:00Z",
                          "roadNumbers": ["I-25"],
                          "travelDirection": "south",
                          "closestMileMarker": 235.4
                        },
                        "geometry": {
                          "type": "Point",
                          "coordinates": [-104.99, 39.74]
                        }
                      }]
                    }
                    """
            )
        ));

        ArgumentCaptor<Object[]> eventArguments = ArgumentCaptor.forClass(Object[].class);
        verify(jdbcTemplate).queryForObject(anyString(), eq(Long.class), eventArguments.capture());
        ArgumentCaptor<String> updates = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> updateArguments = ArgumentCaptor.forClass(Object[].class);
        verify(jdbcTemplate, times(6)).update(updates.capture(), updateArguments.capture());
        assertThat(updates.getAllValues())
            .anyMatch(sql -> sql.contains("traffic_incident_event_corridor"))
            .anyMatch(sql -> sql.contains("traffic_incident_event_observation"))
            .anyMatch(sql -> sql.contains("traffic_incident_event_transition"))
            .anyMatch(sql -> sql.contains("traffic_incident_event_corridor_transition"))
            .anyMatch(sql -> sql.contains("'INACTIVE'"))
            .anyMatch(sql -> sql.contains("'UNMATCHED'"));
        assertThat(eventArguments.getValue())
            .noneMatch(Instant.class::isInstance)
            .anyMatch(OffsetDateTime.class::isInstance);
        assertThat(updateArguments.getAllValues())
            .flatExtracting(Arrays::asList)
            .noneMatch(Instant.class::isInstance)
            .anyMatch(OffsetDateTime.class::isInstance);
    }

    @Test
    void anEmptySuccessfulSnapshotOnlyClosesMissingEvents() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        IncidentEventWriter writer = new IncidentEventWriter(jdbcTemplate, new ObjectMapper());

        writer.publish(Map.of("I25", snapshot("{\"incidents\":[]}")));

        verify(jdbcTemplate, never())
            .queryForObject(anyString(), eq(Long.class), any(Object[].class));
        verify(jdbcTemplate, times(2)).update(anyString(), any(Object[].class));
        assertUpdateRecorded(jdbcTemplate, "'UNMATCHED'", null);
        assertUpdateRecorded(jdbcTemplate, "'INACTIVE'", null);
    }

    @Test
    void recordsReactivationAndCorridorRematch() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForList(
            argThat(sql -> sql != null && sql.contains("from traffic_incident_event\n")),
            any(Object[].class)
        )).thenReturn(List.of(Map.of(
            "id", 42L,
            "active", false,
            "latest_payload_hash", "previous-payload"
        )));
        when(jdbcTemplate.queryForList(
            argThat(sql -> sql != null && sql.contains("from traffic_incident_event_corridor")),
            any(Object[].class)
        )).thenReturn(List.of(Map.of(
            "active", false,
            "latest_match_hash", "previous-match"
        )));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
            .thenReturn(42L);
        IncidentEventWriter writer = new IncidentEventWriter(jdbcTemplate, new ObjectMapper());

        writer.publish(Map.of("I25", snapshot(eventJson())));

        assertUpdateRecorded(
            jdbcTemplate,
            "insert into traffic_incident_event_transition",
            "REACTIVATED"
        );
        assertUpdateRecorded(
            jdbcTemplate,
            "insert into traffic_incident_event_corridor_transition",
            "REMATCHED"
        );
    }

    @Test
    void recordsAChangedPayloadEvenWhenItsObservationMayAlreadyExist() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        when(jdbcTemplate.queryForList(
            argThat(sql -> sql != null && sql.contains("from traffic_incident_event\n")),
            any(Object[].class)
        )).thenReturn(List.of(Map.of(
            "id", 42L,
            "active", true,
            "latest_payload_hash", "a-different-payload"
        )));
        when(jdbcTemplate.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
            .thenReturn(42L);
        IncidentEventWriter writer = new IncidentEventWriter(jdbcTemplate, new ObjectMapper());

        writer.publish(Map.of("I25", snapshot(eventJson())));

        assertUpdateRecorded(
            jdbcTemplate,
            "insert into traffic_incident_event_transition",
            "PAYLOAD_CHANGED"
        );
        assertUpdateRecorded(
            jdbcTemplate,
            "on conflict (event_id, payload_hash) do nothing",
            null
        );
    }

    @Test
    void rejectsMalformedSnapshotsBeforeChangingCurrentState() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        IncidentEventWriter writer = new IncidentEventWriter(jdbcTemplate, new ObjectMapper());

        assertThatThrownBy(() -> writer.publish(Map.of("I25", snapshot("{}"))))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("incidents array");
        verify(jdbcTemplate, never()).update(anyString(), any(Object[].class));
    }

    private static CorridorIncidentSnapshot snapshot(String json) {
        return new CorridorIncidentSnapshot(
            "I25",
            "cdot",
            "incidents-and-planned-events",
            Instant.parse("2026-07-27T18:00:00Z"),
            Instant.parse("2026-07-27T17:58:00Z"),
            json,
            json.contains("providerEventId") ? 1 : 0
        );
    }

    private static String eventJson() {
        return """
            {
              "incidents": [{
                "properties": {
                  "providerEventId": "OpenTMS-Incident-42",
                  "sourceStatus": "report",
                  "normalizedStatus": "active",
                  "description": "Crash between exits",
                  "lastUpdated": "2026-07-27T17:58:00Z",
                  "roadNumbers": ["I-25"],
                  "closestMileMarker": 235.4
                },
                "geometry": {
                  "type": "Point",
                  "coordinates": [-104.99, 39.74]
                }
              }]
            }
            """;
    }

    private static void assertUpdateRecorded(
        JdbcTemplate jdbcTemplate,
        String sqlFragment,
        String argument
    ) {
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
        verify(jdbcTemplate, atLeastOnce()).update(sql.capture(), arguments.capture());

        boolean matched = false;
        for (int i = 0; i < sql.getAllValues().size(); i++) {
            if (!sql.getAllValues().get(i).contains(sqlFragment)) continue;
            if (
                argument == null
                    || Arrays.asList(arguments.getAllValues().get(i)).contains(argument)
            ) {
                matched = true;
                break;
            }
        }
        assertThat(matched).isTrue();
    }
}
