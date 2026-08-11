package com.example.api_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
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
    private CurrentIncidentRepository incidentRepository;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @MockBean
    private DashboardProps dashboardProps;

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
            .andExpect(jsonPath("$.features[0].properties.mileMarkerRange").value("MM 200.0 to 250.0"))
            .andExpect(jsonPath("$.features[0].properties.speedLimitSource").value("CDOT HighwaySegments SPEEDLIM"))
            .andExpect(jsonPath("$.features[0].properties.speedLimitSegments[0].speedLimitMph").value(55))
            .andExpect(jsonPath("$.features[0].properties.speedLimitSegments[2].label").value("MM 225.552-271 | 75 mph"));
    }

    @Test
    void dashboardApiMapAliasReturnsGeoJsonWithLatestMetrics() throws Exception {
        CorridorRef corridor = new CorridorRef();
        corridor.setCode("I25");
        corridor.setDisplayName("Interstate 25");
        corridor.setGeometryJson("{\"type\":\"LineString\",\"coordinates\":[[-105.0,40.0],[-104.0,39.0]]}");

        when(corridorRefRepository.findAllByOrderByCodeAsc()).thenReturn(List.of(corridor));
        when(sampleRepository.findFirstByCorridorOrderByPolledAtDesc("I25")).thenReturn(Optional.empty());

        mvc.perform(get("/dashboard-api/traffic/map/corridors"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.type").value("FeatureCollection"))
            .andExpect(jsonPath("$.features[0].id").value("I25"));
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
        incident.setIconCategory(4);
        incident.setIncidentDescription("heavy rain");
        incident.setDelaySeconds(420);
        incident.setPolledAt(OffsetDateTime.of(2026, 4, 12, 8, 30, 0, 0, ZoneOffset.UTC));
        incident.setGeometryType("Point");
        incident.setGeometryJson("{\"type\":\"Point\",\"coordinates\":[-104.9903,39.7392]}");
        incident.setIsArchived(false);
        CorridorRef corridor = new CorridorRef();
        corridor.setCode("I25");
        corridor.setGeometryJson("{\"type\":\"LineString\",\"coordinates\":[[-105.0,40.0],[-105.0,39.0]]}");
        CurrentIncidentProjection current = current(incident);

        when(incidentRepository.findCurrentByCorridorSince(eq("I25"), any(), eq(2)))
            .thenReturn(List.of(current));
        when(corridorRefRepository.findAllById(any())).thenReturn(List.of(corridor));

        mvc.perform(get("/api/traffic/map/incidents")
                .param("corridor", "I25")
                .param("windowMinutes", "180")
                .param("limit", "2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.type").value("FeatureCollection"))
            .andExpect(jsonPath("$.features[0].id").value("101"))
            .andExpect(jsonPath("$.features[0].geometry.type").value("Point"))
            .andExpect(jsonPath("$.features[0].geometry.coordinates[0]").value(-105.0))
            .andExpect(jsonPath("$.features[0].geometry.coordinates[1]").value(39.7392))
            .andExpect(jsonPath("$.features[0].properties.referenceKey").value("I25|MM214.6|S"))
            .andExpect(jsonPath("$.features[0].properties.referenceLabel").value("I-25 southbound near MM 214.6"))
            .andExpect(jsonPath("$.features[0].properties.travelDirectionLabel").value("southbound"))
            .andExpect(jsonPath("$.features[0].properties.incidentTypeLabel").value("Rain"))
            .andExpect(jsonPath("$.features[0].properties.incidentDescription").value("Heavy rain"))
            .andExpect(jsonPath("$.features[0].properties.incidentDisplayLabel").value("Heavy rain at I-25 southbound near MM 214.6"))
            .andExpect(jsonPath("$.features[0].properties.displayGeometrySource").value("corridor_snapped"))
            .andExpect(jsonPath("$.features[0].properties.mapSnappedToCorridor").value(true))
            .andExpect(jsonPath("$.features[0].properties.isApproximateLocation").value(false))
            .andExpect(jsonPath("$.features[0].properties.isOffCorridor").value(false))
            .andExpect(jsonPath("$.features[0].properties.hasDelaySignal").value(true));

        verify(incidentRepository).findCurrentByCorridorSince(eq("I25"), any(), eq(2));
    }

    @Test
    void incidentsExposeCdotIdentityCategoryStatusAndFreshness() throws Exception {
        TrafficHistoryIncident incident = new TrafficHistoryIncident();
        incident.setHistoryId(404L);
        incident.setIncidentRefId(44L);
        incident.setSampleRefId(399L);
        incident.setCorridor("I70");
        incident.setRoadNumber("I-70");
        incident.setTravelDirection("E");
        incident.setClosestMileMarker(240.5);
        incident.setLocationLabel("I-70 eastbound near MM 240.5");
        incident.setIconCategory(9);
        incident.setIncidentDescription("bridge maintenance");
        incident.setIncidentProvider("cdot");
        incident.setIncidentProduct("incidents-and-planned-events");
        incident.setProviderEventId("OpenTMS-Event-404");
        incident.setNormalizedStatus("planned");
        incident.setNormalizedCategory("construction");
        incident.setSourceUpdatedAt(OffsetDateTime.parse("2026-07-31T17:45:00Z"));
        incident.setPolledAt(OffsetDateTime.parse("2026-07-31T18:00:00Z"));
        incident.setGeometryType("Point");
        incident.setGeometryJson("{\"type\":\"Point\",\"coordinates\":[-105.5,39.74]}");
        incident.setIsArchived(false);
        CurrentIncidentProjection current = current(incident);

        when(incidentRepository.findCurrentByCorridorSince(eq("I70"), any(), eq(1)))
            .thenReturn(List.of(current));

        mvc.perform(get("/api/traffic/map/incidents")
                .param("corridor", "I70")
                .param("limit", "1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.features[0].properties.incidentProvider").value("cdot"))
            .andExpect(jsonPath("$.features[0].properties.incidentProduct").value("incidents-and-planned-events"))
            .andExpect(jsonPath("$.features[0].properties.providerEventId").value("OpenTMS-Event-404"))
            .andExpect(jsonPath("$.features[0].properties.referenceKey").value("cdot|OpenTMS-Event-404"))
            .andExpect(jsonPath("$.features[0].properties.normalizedStatus").value("planned"))
            .andExpect(jsonPath("$.features[0].properties.normalizedCategory").value("construction"))
            .andExpect(jsonPath("$.features[0].properties.incidentTypeLabel").value("Road work"))
            .andExpect(jsonPath("$.features[0].properties.sourceUpdatedAt").value("2026-07-31T17:45:00Z"));
    }

    @Test
    void sourceMileMarkersPlaceCdotEventsOnTheMatchingCorridorLocation() throws Exception {
        TrafficHistoryIncident incident = new TrafficHistoryIncident();
        incident.setHistoryId(505L);
        incident.setCorridor("I70");
        incident.setClosestMileMarker(250.0);
        incident.setMileMarkerMethod("source_range_midpoint");
        incident.setIncidentProvider("cdot");
        incident.setProviderEventId("OpenTMS-Event-505");
        incident.setGeometryJson("{\"type\":\"Point\",\"coordinates\":[-104.0,40.0]}");

        CorridorRef corridor = new CorridorRef();
        corridor.setCode("I70");
        corridor.setGeometryJson("{\"type\":\"LineString\",\"coordinates\":[[-106.0,39.0],[-105.0,39.0]]}");
        corridor.setMileMarkerAnchorsJson("""
            [
              {"mileMarker":200.0,"latitude":39.0,"longitude":-106.0},
              {"mileMarker":300.0,"latitude":39.0,"longitude":-105.0}
            ]
            """);
        CurrentIncidentProjection current = current(incident);

        when(incidentRepository.findCurrentByCorridorSince(eq("I70"), any(), eq(1)))
            .thenReturn(List.of(current));
        when(corridorRefRepository.findAllById(any())).thenReturn(List.of(corridor));

        mvc.perform(get("/api/traffic/map/incidents")
                .param("corridor", "I70")
                .param("limit", "1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.features[0].geometry.coordinates[0]").value(-105.5))
            .andExpect(jsonPath("$.features[0].geometry.coordinates[1]").value(39.0))
            .andExpect(jsonPath("$.features[0].properties.displayGeometrySource").value("mile_marker_snapped"))
            .andExpect(jsonPath("$.features[0].properties.mapSnappedToCorridor").value(true))
            .andExpect(jsonPath("$.features[0].properties.providerCentroidLat").value(40.0))
            .andExpect(jsonPath("$.features[0].properties.providerCentroidLon").value(-104.0));
    }

    @Test
    void incidentsRejectsInvalidWindow() throws Exception {
        mvc.perform(get("/api/traffic/map/incidents").param("windowMinutes", "0"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void incidentsWithoutCorridorUseFallbackPointGeometryAndGeneratedReferenceLabel() throws Exception {
        TrafficHistoryIncident incident = new TrafficHistoryIncident();
        incident.setHistoryId(202L);
        incident.setIncidentRefId(22L);
        incident.setSampleRefId(199L);
        incident.setCorridor("I25");
        incident.setRoadNumber("I-25");
        incident.setTravelDirection(" n ");
        incident.setClosestMileMarker(210.2);
        incident.setLocationLabel(" ");
        incident.setCentroidLat(39.7392);
        incident.setCentroidLon(-104.9903);
        incident.setGeometryJson(null);
        incident.setIsArchived(false);
        incident.setPolledAt(OffsetDateTime.of(2026, 4, 12, 9, 0, 0, 0, ZoneOffset.UTC));
        CurrentIncidentProjection current = current(incident);

        when(incidentRepository.findCurrentSince(any(), eq(1)))
            .thenReturn(List.of(current));

        mvc.perform(get("/api/traffic/map/incidents")
                .param("windowMinutes", "60")
                .param("limit", "1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.features[0].id").value("202"))
            .andExpect(jsonPath("$.features[0].geometry.type").value("Point"))
            .andExpect(jsonPath("$.features[0].geometry.coordinates[0]").value(-104.9903))
            .andExpect(jsonPath("$.features[0].geometry.coordinates[1]").value(39.7392))
            .andExpect(jsonPath("$.features[0].properties.travelDirectionLabel").value("northbound"))
            .andExpect(jsonPath("$.features[0].properties.referenceLabel").value("I-25 northbound near MM 210.2"));
    }

    @Test
    void incidentsReferenceLabelFallsBackToCorridorWhenDirectionAndMileMarkerMissing() throws Exception {
        TrafficHistoryIncident incident = new TrafficHistoryIncident();
        incident.setHistoryId(303L);
        incident.setIncidentRefId(33L);
        incident.setSampleRefId(299L);
        incident.setCorridor("I70");
        incident.setRoadNumber(" ");
        incident.setTravelDirection(" ");
        incident.setLocationLabel(null);
        incident.setMileMarkerMethod("off_corridor");
        incident.setDelaySeconds(0);
        incident.setGeometryJson("{\"type\":\"Point\",\"coordinates\":[-105.0,39.7]}");
        incident.setIsArchived(false);
        CurrentIncidentProjection current = current(incident);

        when(incidentRepository.findCurrentByCorridorSince(eq("I70"), any(), eq(1)))
            .thenReturn(List.of(current));

        mvc.perform(get("/api/traffic/map/incidents")
                .param("corridor", " i70 ")
                .param("limit", "1"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.features[0].properties.referenceLabel").value("I70"))
            .andExpect(jsonPath("$.features[0].properties.isApproximateLocation").value(true))
            .andExpect(jsonPath("$.features[0].properties.isOffCorridor").value(true))
            .andExpect(jsonPath("$.features[0].properties.hasDelaySignal").value(false));
    }

    @Test
    void incidentsEnforceBoundaryAndInputValidation() throws Exception {
        when(incidentRepository.findCurrentSince(any(), eq(1000)))
            .thenReturn(List.of());

        mvc.perform(get("/api/traffic/map/incidents").param("corridor", " "))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/map/incidents").param("windowMinutes", "10081"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/map/incidents").param("limit", "1001"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/map/incidents")
                .param("windowMinutes", "10080")
                .param("limit", "1000"))
            .andExpect(status().isOk());
    }

    @Test
    void corridorsAllowMissingMileMarkersWithoutRangeText() throws Exception {
        CorridorRef corridor = new CorridorRef();
        corridor.setCode("US36");
        corridor.setDisplayName("US 36");
        corridor.setGeometryJson("{\"type\":\"LineString\",\"coordinates\":[[-105.1,40.0],[-104.8,39.9]]}");
        corridor.setStartMileMarker(null);
        corridor.setEndMileMarker(null);
        when(corridorRefRepository.findAllByOrderByCodeAsc()).thenReturn(List.of(corridor));
        when(sampleRepository.findFirstByCorridorOrderByPolledAtDesc("US36")).thenReturn(Optional.empty());

        mvc.perform(get("/api/traffic/map/corridors"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.features[0].id").value("US36"))
            .andExpect(jsonPath("$.features[0].properties.mileMarkerRange").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.features[0].properties.speedLimitSegments").isEmpty())
            .andExpect(jsonPath("$.features[0].properties.speedLimitSource").value(org.hamcrest.Matchers.nullValue()));
    }

    private static CurrentIncidentProjection current(TrafficHistoryIncident source) {
        CurrentIncidentProjection incident = mock(CurrentIncidentProjection.class);
        when(incident.getEventId()).thenReturn(source.getHistoryId());
        when(incident.getProvider()).thenReturn(source.getIncidentProvider());
        when(incident.getProduct()).thenReturn(source.getIncidentProduct());
        when(incident.getProviderEventId()).thenReturn(source.getProviderEventId());
        when(incident.getNormalizedStatus()).thenReturn(source.getNormalizedStatus());
        when(incident.getNormalizedCategory()).thenReturn(source.getNormalizedCategory());
        when(incident.getIncidentDescription()).thenReturn(source.getIncidentDescription());
        when(incident.getGeometryType()).thenReturn(source.getGeometryType());
        when(incident.getGeometryJson()).thenReturn(source.getGeometryJson());
        when(incident.getSourceUpdatedAt()).thenReturn(instant(source.getSourceUpdatedAt()));
        when(incident.getFirstSeenAt()).thenReturn(instant(source.getPolledAt()));
        when(incident.getLastSeenAt()).thenReturn(instant(source.getPolledAt()));
        when(incident.getRawEventJson()).thenReturn(rawEvent(source));
        when(incident.getCorridor()).thenReturn(source.getCorridor());
        when(incident.getRoadNumber()).thenReturn(source.getRoadNumber());
        when(incident.getTravelDirection()).thenReturn(source.getTravelDirection());
        when(incident.getClosestMileMarker()).thenReturn(source.getClosestMileMarker());
        when(incident.getMileMarkerMethod()).thenReturn(source.getMileMarkerMethod());
        when(incident.getMileMarkerConfidence()).thenReturn(source.getMileMarkerConfidence());
        when(incident.getDistanceToCorridorMeters()).thenReturn(source.getDistanceToCorridorMeters());
        when(incident.getLocationLabel()).thenReturn(source.getLocationLabel());
        when(incident.getCentroidLat()).thenReturn(source.getCentroidLat());
        when(incident.getCentroidLon()).thenReturn(source.getCentroidLon());
        return incident;
    }

    private static String rawEvent(TrafficHistoryIncident incident) {
        ObjectNode properties = JsonNodeFactory.instance.objectNode();
        if (incident.getIconCategory() != null) {
            properties.put("iconCategory", incident.getIconCategory());
        }
        if (incident.getDelaySeconds() != null) {
            properties.put("delay", incident.getDelaySeconds());
        }
        ObjectNode event = JsonNodeFactory.instance.objectNode();
        event.set("properties", properties);
        return event.toString();
    }

    private static Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }
}
