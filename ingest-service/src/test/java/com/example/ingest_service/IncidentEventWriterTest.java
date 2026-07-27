package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
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

        verify(jdbcTemplate).queryForObject(anyString(), eq(Long.class), any(Object[].class));
        ArgumentCaptor<String> updates = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate, times(4)).update(updates.capture(), any(Object[].class));
        assertThat(updates.getAllValues())
            .anyMatch(sql -> sql.contains("traffic_incident_event_corridor"))
            .anyMatch(sql -> sql.contains("traffic_incident_event_observation"))
            .anyMatch(sql -> sql.contains("last_seen_at <"));
    }

    @Test
    void anEmptySuccessfulSnapshotOnlyClosesMissingEvents() {
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        IncidentEventWriter writer = new IncidentEventWriter(jdbcTemplate, new ObjectMapper());

        writer.publish(Map.of("I25", snapshot("{\"incidents\":[]}")));

        verify(jdbcTemplate, never())
            .queryForObject(anyString(), eq(Long.class), any(Object[].class));
        verify(jdbcTemplate, times(2)).update(anyString(), any(Object[].class));
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
}
