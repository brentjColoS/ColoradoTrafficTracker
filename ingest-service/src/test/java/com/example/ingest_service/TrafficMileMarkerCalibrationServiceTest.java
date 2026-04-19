package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TrafficMileMarkerCalibrationServiceTest {

    @Mock
    private RoutesClient routesClient;

    @Mock
    private CorridorMetadataSyncService corridorMetadataSyncService;

    @Mock
    private CorridorRefRepository corridorRefRepository;

    @Mock
    private TrafficIncidentRepository trafficIncidentRepository;

    @Test
    void recalibratesRecentIncidentsUsingConfiguredCorridorRange() {
        TrafficProps.Corridor corridor = new TrafficProps.Corridor(
            "I25",
            "I-25",
            "I-25",
            "N",
            "S",
            271.0,
            208.0,
            null,
            "39.58,-105.05,40.60,-104.90",
            null
        );
        CorridorRef ref = new CorridorRef();
        ref.setCode("I25");
        ref.setGeometryJson("""
            {"type":"LineString","coordinates":[[-105.0000,40.0000],[-105.0000,39.5000]]}
            """);

        TrafficIncident incident = new TrafficIncident();
        incident.setId(101L);
        incident.setCorridor("I25");
        incident.setGeometryJson("""
            {"type":"LineString","coordinates":[[-105.0000,39.7400],[-105.0000,39.7300]]}
            """);
        incident.setPolledAt(OffsetDateTime.now(ZoneOffset.UTC).minusHours(1));

        when(routesClient.fetchCorridors()).thenReturn(reactor.core.publisher.Mono.just(List.of(corridor)));
        when(corridorRefRepository.findAllById(List.of("I25"))).thenReturn(List.of(ref));
        when(trafficIncidentRepository.findByPolledAtGreaterThanEqualOrderByPolledAtAsc(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any()
        )).thenReturn(new org.springframework.data.domain.PageImpl<>(List.of(incident)));

        TrafficMileMarkerCalibrationService service = new TrafficMileMarkerCalibrationService(
            routesClient,
            corridorMetadataSyncService,
            corridorRefRepository,
            trafficIncidentRepository,
            new TrafficMileMarkerCalibrationProps(true, true, 168, 100),
            new ObjectMapper()
        );

        TrafficMileMarkerCalibrationService.CalibrationReport report = service.recalibrateRecentIncidents();

        assertThat(report.scannedIncidentCount()).isEqualTo(1);
        assertThat(report.updatedIncidentCount()).isEqualTo(1);
        assertThat(report.resolvedIncidentCount()).isEqualTo(1);
        assertThat(incident.getClosestMileMarker()).isBetween(235.0, 242.0);
        assertThat(incident.getMileMarkerMethod()).isEqualTo("range_interpolated");
        verify(corridorMetadataSyncService).sync(List.of(corridor));
        verify(trafficIncidentRepository).saveAll(List.of(incident));
    }

    @Test
    void startupRunnerSkipsWhenDisabled() throws Exception {
        TrafficMileMarkerCalibrationService calibrationService = mock(TrafficMileMarkerCalibrationService.class);
        TrafficMileMarkerCalibrationStartup startup = new TrafficMileMarkerCalibrationStartup(
            calibrationService,
            new TrafficMileMarkerCalibrationProps(false, true, 168, 250)
        );

        startup.run(null);

        verify(calibrationService, org.mockito.Mockito.never()).recalibrateRecentIncidents();
    }

    @Test
    void startupRunnerExecutesWhenEnabled() throws Exception {
        TrafficMileMarkerCalibrationService calibrationService = mock(TrafficMileMarkerCalibrationService.class);
        TrafficMileMarkerCalibrationStartup startup = new TrafficMileMarkerCalibrationStartup(
            calibrationService,
            new TrafficMileMarkerCalibrationProps(true, true, 168, 250)
        );

        startup.run(null);

        verify(calibrationService).recalibrateRecentIncidents();
    }
}
