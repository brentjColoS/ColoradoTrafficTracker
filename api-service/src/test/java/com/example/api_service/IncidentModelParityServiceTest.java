package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.example.api_service.dto.IncidentModelParityDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class IncidentModelParityServiceTest {

    @Test
    void reportsParityWhenTheLatestSampleAndDurableRowsMatch() {
        TrafficSampleRepository samples = mock(TrafficSampleRepository.class);
        CurrentIncidentRepository current = mock(CurrentIncidentRepository.class);
        String incident = incident("event-42", "Crash at MM 235");
        TrafficSample sample = sample("I25", "{\"incidents\":[" + incident + "]}");
        CurrentIncidentProjection currentIncident = current("I25", "event-42", incident);
        when(samples.findDistinctCorridors()).thenReturn(List.of("I25"));
        when(samples.findFirstByCorridorOrderByPolledAtDesc("I25"))
            .thenReturn(Optional.of(sample));
        when(current.findAllCurrent()).thenReturn(List.of(currentIncident));

        IncidentModelParityDto report = new IncidentModelParityService(
            samples,
            current,
            new ObjectMapper()
        ).compare();

        assertThat(report.inParity()).isTrue();
        assertThat(report.compatibilityIncidentCount()).isEqualTo(1);
        assertThat(report.durableIncidentCount()).isEqualTo(1);
        assertThat(report.matchingIdentityCount()).isEqualTo(1);
        assertThat(report.mismatchCount()).isZero();
        assertThat(report.corridors().get(0).payloadMismatchIdentities()).isEmpty();
    }

    @Test
    void identifiesRowsPresentOnOnlyOneSide() {
        TrafficSampleRepository samples = mock(TrafficSampleRepository.class);
        CurrentIncidentRepository current = mock(CurrentIncidentRepository.class);
        TrafficSample sample = sample(
            "I70",
            "{\"incidents\":[" + incident("compatibility-event", "Road work") + "]}"
        );
        CurrentIncidentProjection currentIncident = current(
            "I70",
            "durable-event",
            incident("durable-event", "Crash")
        );
        when(samples.findDistinctCorridors()).thenReturn(List.of("I70"));
        when(samples.findFirstByCorridorOrderByPolledAtDesc("I70"))
            .thenReturn(Optional.of(sample));
        when(current.findAllCurrent()).thenReturn(List.of(currentIncident));

        IncidentModelParityDto report = new IncidentModelParityService(
            samples,
            current,
            new ObjectMapper()
        ).compare();

        assertThat(report.inParity()).isFalse();
        assertThat(report.mismatchCount()).isEqualTo(2);
        assertThat(report.corridors().get(0).compatibilityOnlyIdentities())
            .containsExactly("cdot|compatibility-event");
        assertThat(report.corridors().get(0).durableOnlyIdentities())
            .containsExactly("cdot|durable-event");
    }

    @Test
    void makesAnUnreadableCompatibilitySnapshotVisible() {
        TrafficSampleRepository samples = mock(TrafficSampleRepository.class);
        CurrentIncidentRepository current = mock(CurrentIncidentRepository.class);
        when(samples.findDistinctCorridors()).thenReturn(List.of("I25"));
        when(samples.findFirstByCorridorOrderByPolledAtDesc("I25"))
            .thenReturn(Optional.of(sample("I25", "not-json")));
        when(current.findAllCurrent()).thenReturn(List.of());

        IncidentModelParityDto report = new IncidentModelParityService(
            samples,
            current,
            new ObjectMapper()
        ).compare();

        assertThat(report.inParity()).isFalse();
        assertThat(report.mismatchCount()).isEqualTo(1);
        assertThat(report.corridors().get(0).compatibilitySnapshotReadable()).isFalse();
        assertThat(report.corridors().get(0).compatibilitySnapshotError())
            .contains("not valid JSON");
    }

    @Test
    void doesNotReportParityBeforeThereIsAnythingToCompare() {
        TrafficSampleRepository samples = mock(TrafficSampleRepository.class);
        CurrentIncidentRepository current = mock(CurrentIncidentRepository.class);
        when(samples.findDistinctCorridors()).thenReturn(List.of());
        when(current.findAllCurrent()).thenReturn(List.of());

        IncidentModelParityDto report = new IncidentModelParityService(
            samples,
            current,
            new ObjectMapper()
        ).compare();

        assertThat(report.comparisonReady()).isFalse();
        assertThat(report.inParity()).isFalse();
    }

    private static TrafficSample sample(String corridor, String incidentsJson) {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(corridor);
        sample.setIncidentProvider("cdot");
        sample.setIncidentProduct("incidents-and-planned-events");
        sample.setIncidentsJson(incidentsJson);
        sample.setIncidentFetchedAt(OffsetDateTime.of(2026, 8, 11, 20, 0, 0, 0, ZoneOffset.UTC));
        sample.setPolledAt(OffsetDateTime.of(2026, 8, 11, 20, 1, 0, 0, ZoneOffset.UTC));
        return sample;
    }

    private static CurrentIncidentProjection current(
        String corridor,
        String providerEventId,
        String rawEventJson
    ) {
        CurrentIncidentProjection incident = mock(CurrentIncidentProjection.class);
        when(incident.getCorridor()).thenReturn(corridor);
        when(incident.getProvider()).thenReturn("cdot");
        when(incident.getProviderEventId()).thenReturn(providerEventId);
        when(incident.getRawEventJson()).thenReturn(rawEventJson);
        when(incident.getLastSeenAt()).thenReturn(
            OffsetDateTime.of(2026, 8, 11, 20, 0, 0, 0, ZoneOffset.UTC)
        );
        return incident;
    }

    private static String incident(String providerEventId, String description) {
        return """
            {
              "type":"Feature",
              "properties":{
                "provider":"cdot",
                "providerEventId":"%s",
                "description":"%s"
              },
              "geometry":{"type":"Point","coordinates":[-105.0,39.7]}
            }
            """.formatted(providerEventId, description).strip();
    }
}
