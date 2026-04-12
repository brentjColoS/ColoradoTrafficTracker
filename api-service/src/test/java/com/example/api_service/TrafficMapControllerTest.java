package com.example.api_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficMapController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficMapControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private CorridorRefRepository corridorRefRepository;

    @MockBean
    private TrafficSampleRepository sampleRepository;

    @MockBean
    private TrafficHistoryIncidentRepository incidentRepository;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @Test
    void corridorsReturnsGeoJsonWithLatestMetrics() throws Exception {
        CorridorRef corridor = new CorridorRef();
        corridor.setCode("I25");
        corridor.setDisplayName("Interstate 25");
        corridor.setRoadNumber("I-25");
        corridor.setPrimaryDirection("N");
        corridor.setSecondaryDirection("S");
        corridor.setStartMileMarker(200.0);
        corridor.setEndMileMarker(250.0);
        corridor.setBbox("40.0,-105.0,39.0,-104.0");
        corridor.setCenterLat(39.5);
        corridor.setCenterLon(-104.5);
        corridor.setGeometrySource("routing");
        corridor.setGeometryJson("{\"type\":\"LineString\",\"coordinates\":[[-105.0,40.0],[-104.0,39.0]]}");

        TrafficSample latest = new TrafficSample();
        latest.setId(9L);
        latest.setCorridor("I25");
        latest.setAvgCurrentSpeed(47.5);
        latest.setIncidentCount(2);
        latest.setPolledAt(OffsetDateTime.of(2026, 4, 12, 8, 30, 0, 0, ZoneOffset.UTC));

        when(corridorRefRepository.findAllByOrderByCodeAsc()).thenReturn(List.of(corridor));
        when(sampleRepository.findFirstByCorridorOrderByPolledAtDesc("I25")).thenReturn(Optional.of(latest));

        mvc.perform(get("/api/traffic/map/corridors"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.type").value("FeatureCollection"))
            .andExpect(jsonPath("$.features[0].id").value("I25"))
            .andExpect(jsonPath("$.features[0].geometry.type").value("LineString"))
            .andExpect(jsonPath("$.features[0].properties.geometrySource").value("routing"))
            .andExpect(jsonPath("$.features[0].properties.latestAvgCurrentSpeed").value(47.5))
            .andExpect(jsonPath("$.features[0].properties.mileMarkerRange").value("MM 200.0 to 250.0"));
    }

    @Test
    void incidentsReturnsReferenceFriendlyGeoJson() throws Exception {
        TrafficHistoryIncident incident = new TrafficHistoryIncident();
        incident.setHistoryId(101L);
        incident.setIncidentRefId(11L);
        incident.setSampleRefId(99L);
        incident.setCorridor("I25");
        incident.setRoadNumber("I-25");
        incident.setTravelDirection("S");
        incident.setClosestMileMarker(214.6);
        incident.setLocationLabel("I-25 southbound near MM 214.6");
        incident.setDelaySeconds(420);
        incident.setPolledAt(OffsetDateTime.of(2026, 4, 12, 8, 30, 0, 0, ZoneOffset.UTC));
        incident.setGeometryJson("{\"type\":\"Point\",\"coordinates\":[-104.9903,39.7392]}");
        incident.setIsArchived(false);

        when(incidentRepository.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I25"), any(), eq(PageRequest.of(0, 2))))
            .thenReturn(new PageImpl<>(List.of(incident)));

        mvc.perform(get("/api/traffic/map/incidents")
                .param("corridor", "I25")
                .param("windowMinutes", "180")
                .param("limit", "2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.type").value("FeatureCollection"))
            .andExpect(jsonPath("$.features[0].id").value("101"))
            .andExpect(jsonPath("$.features[0].geometry.type").value("Point"))
            .andExpect(jsonPath("$.features[0].properties.referenceKey").value("I25|MM214.6|S"))
            .andExpect(jsonPath("$.features[0].properties.referenceLabel").value("I-25 southbound near MM 214.6"))
            .andExpect(jsonPath("$.features[0].properties.travelDirectionLabel").value("southbound"));
    }

    @Test
    void incidentsRejectsInvalidWindow() throws Exception {
        mvc.perform(get("/api/traffic/map/incidents").param("windowMinutes", "0"))
            .andExpect(status().isBadRequest());
    }
}
