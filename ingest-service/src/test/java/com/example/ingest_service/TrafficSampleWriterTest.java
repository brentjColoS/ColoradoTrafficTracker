package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
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
    private SimpleMeterRegistry meterRegistry;

    @BeforeEach
    void setUp() {
        meterRegistry = new SimpleMeterRegistry();
        writer = new TrafficSampleWriter(sampleRepo, incidentRepo, new ObjectMapper(), meterRegistry);
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
                    "roadNumbers": ["I-25", "US-36"],
                    "travelDirection": "S",
                    "closestMileMarker": 214.6,
                    "mileMarkerMethod": "range_interpolated",
                    "mileMarkerConfidence": 0.84,
                    "distanceToCorridorMeters": 23.5,
                    "locationLabel": "I-25 southbound near MM 214.6",
                    "centroidLat": 39.75,
                    "centroidLon": -104.85
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

        TrafficSample saved = writer.saveSampleWithIncidents(sample);

        assertThat(saved).isSameAs(sample);

        verify(incidentRepo).saveAll(
            argThat((List<TrafficIncident> incidents) ->
                incidents.size() == 2
                    && incidents.get(0).getSample() == sample
                    && incidents.get(1).getSample() == sample
                    && "I25".equals(incidents.get(0).getCorridor())
                    && "I25".equals(incidents.get(1).getCorridor())
                    && "I-25".equals(incidents.get(0).getRoadNumber())
                    && "US-36".equals(incidents.get(1).getRoadNumber())
                    && Integer.valueOf(4).equals(incidents.get(0).getIconCategory())
                    && Integer.valueOf(120).equals(incidents.get(0).getDelaySeconds())
                    && "LineString".equals(incidents.get(0).getGeometryType())
                    && incidents.get(0).getGeometryJson() != null
                    && "S".equals(incidents.get(0).getTravelDirection())
                    && Double.valueOf(214.6).equals(incidents.get(0).getClosestMileMarker())
                    && "range_interpolated".equals(incidents.get(0).getMileMarkerMethod())
                    && Double.valueOf(0.84).equals(incidents.get(0).getMileMarkerConfidence())
                    && Double.valueOf(23.5).equals(incidents.get(0).getDistanceToCorridorMeters())
                    && "I-25 southbound near MM 214.6".equals(incidents.get(0).getLocationLabel())
                    && Double.valueOf(39.75).equals(incidents.get(0).getCentroidLat())
                    && Double.valueOf(-104.85).equals(incidents.get(0).getCentroidLon())
                    && OffsetDateTime.parse("2026-04-03T12:00:00Z").equals(incidents.get(0).getPolledAt())
            )
        );
        assertThat(meterRegistry.get("traffic.ingest.samples.persisted.total").counter().count()).isEqualTo(1.0);
        assertThat(meterRegistry.get("traffic.ingest.incidents.normalized.total").counter().count()).isEqualTo(2.0);
    }

    @Test
    void saveSampleWithIncidentsSkipsOnInvalidJson() {
        TrafficSample sample = new TrafficSample();
        sample.setId(55L);
        sample.setCorridor("I70");
        sample.setIncidentsJson("{invalid json}");
        when(sampleRepo.save(any(TrafficSample.class))).thenReturn(sample);

        TrafficSample saved = writer.saveSampleWithIncidents(sample);

        assertThat(saved).isSameAs(sample);
        verify(incidentRepo, never()).saveAll(any());
        assertThat(meterRegistry.get("traffic.ingest.samples.persisted.total").counter().count()).isEqualTo(1.0);
        assertThat(meterRegistry.get("traffic.ingest.incidents.normalized.total").counter().count()).isEqualTo(0.0);
    }

    @Test
    void saveSampleWithIncidentsCreatesIncidentWhenRoadNumbersMissing() {
        TrafficSample sample = new TrafficSample();
        sample.setId(43L);
        sample.setCorridor("I70");
        sample.setPolledAt(OffsetDateTime.parse("2026-04-03T13:00:00Z"));
        sample.setIncidentsJson(
            """
            {
              "incidents": [
                {
                  "properties": {
                    "iconCategory": 6,
                    "delay": 45
                  },
                  "geometry": {
                    "type": "Point",
                    "coordinates": [-104.9, 39.7]
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
                incidents.size() == 1
                    && incidents.get(0).getRoadNumber() == null
                    && "Point".equals(incidents.get(0).getGeometryType())
                    && OffsetDateTime.parse("2026-04-03T13:00:00Z").equals(incidents.get(0).getPolledAt())
            )
        );
        assertThat(meterRegistry.get("traffic.ingest.incidents.normalized.total").counter().count()).isEqualTo(1.0);
    }
}
