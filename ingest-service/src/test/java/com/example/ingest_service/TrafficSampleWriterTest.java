package com.example.ingest_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TrafficSampleWriterTest {

    @Mock
    private TrafficSampleRepository sampleRepo;

    @Mock
    private TrafficIncidentRepository incidentRepo;

    private TrafficSampleWriter writer;

    @BeforeEach
    void setUp() {
        writer = new TrafficSampleWriter(sampleRepo, incidentRepo, new ObjectMapper());
    }

    @Test
    void saveSampleWithIncidentsPersistsNormalizedRows() {
        TrafficSample sample = new TrafficSample();
        sample.setId(42L);
        sample.setCorridor("I25");
        sample.setPolledAt(OffsetDateTime.parse("2026-04-03T12:00:00Z"));
        sample.setIncidentsJson(
            """
            {
              "incidents": [
                {
                  "properties": {
                    "iconCategory": 4,
                    "delay": 120,
                    "roadNumbers": ["I-25", "US-36"]
                  },
                  "geometry": {
                    "type": "LineString",
                    "coordinates": [[-104.9, 39.7], [-104.8, 39.8]]
                  }
                }
              ]
            }
            """
        );

        when(sampleRepo.save(any(TrafficSample.class))).thenReturn(sample);

        writer.saveSampleWithIncidents(sample);

        verify(incidentRepo).saveAll(
            argThat((List<TrafficIncident> incidents) ->
                incidents.size() == 2
                    && incidents.stream().allMatch(i -> "I25".equals(i.getCorridor()))
                    && incidents.stream().allMatch(i -> Integer.valueOf(4).equals(i.getIconCategory()))
                    && incidents.stream().allMatch(i -> Integer.valueOf(120).equals(i.getDelaySeconds()))
            )
        );
    }

    @Test
    void saveSampleWithIncidentsSkipsOnInvalidJson() {
        TrafficSample sample = new TrafficSample();
        sample.setId(55L);
        sample.setCorridor("I70");
        sample.setIncidentsJson("{invalid json}");
        when(sampleRepo.save(any(TrafficSample.class))).thenReturn(sample);

        writer.saveSampleWithIncidents(sample);

        verify(incidentRepo, never()).saveAll(any());
    }
}
