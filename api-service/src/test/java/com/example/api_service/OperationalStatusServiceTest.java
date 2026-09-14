package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.example.api_service.dto.OperationalStatusDto;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.domain.PageRequest;

@ExtendWith(MockitoExtension.class)
class OperationalStatusServiceTest {

    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-08-31T18:00:00Z");

    @Mock
    private TrafficSampleRepository sampleRepository;

    @Mock
    private TrafficProviderGuardStatusRepository guardRepository;

    @Mock
    private ObjectProvider<TrafficProviderGuardStatusRepository> guardRepositoryProvider;

    private OperationalStatusService service;

    @BeforeEach
    void setUp() {
        service = new OperationalStatusService(
            sampleRepository,
            guardRepositoryProvider,
            new OperationalStatusProps(List.of("I25", "I70"), 60, 60, 60)
        );
        lenient().when(guardRepositoryProvider.getIfAvailable()).thenReturn(guardRepository);
    }

    @Test
    void reportsHealthyWhenBothFeedsAreFresh() {
        freshCorridors();
        when(guardRepository.findById("tomtom")).thenReturn(Optional.of(guard("HEALTHY", null, false)));

        OperationalStatusDto status = service.assess(NOW);

        assertThat(status.status()).isEqualTo("HEALTHY");
        assertThat(status.checks()).hasSize(4);
        assertThat(status.checks()).allMatch(check -> check.status().equals("HEALTHY"));
    }

    @Test
    void oneStaleCorridorIsDegradedButNotOutOfService() {
        when(sampleRepository.findLatestUsableByCorridor(eq("I25"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(sample("I25", NOW.minusMinutes(61), NOW.minusMinutes(10))));
        when(sampleRepository.findLatestUsableByCorridor(eq("I70"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(sample("I70", NOW.minusMinutes(2), NOW.minusMinutes(10))));
        when(guardRepository.findById("tomtom")).thenReturn(Optional.of(guard("HEALTHY", null, false)));

        OperationalStatusDto status = service.assess(NOW);

        assertThat(status.status()).isEqualTo("DEGRADED");
        assertThat(status.checks())
            .filteredOn(check -> check.component().equals("flow:I25"))
            .singleElement()
            .extracting(check -> check.code())
            .isEqualTo("FLOW_SAMPLE_STALE");
    }

    @Test
    void everyStaleCorridorMeansTheFlowIngestIsOutOfService() {
        when(sampleRepository.findLatestUsableByCorridor(eq("I25"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(sample("I25", NOW.minusMinutes(70), NOW.minusMinutes(10))));
        when(sampleRepository.findLatestUsableByCorridor(eq("I70"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(sample("I70", NOW.minusMinutes(80), NOW.minusMinutes(10))));
        when(guardRepository.findById("tomtom")).thenReturn(Optional.of(guard("HALTED", "AUTH_FORBIDDEN", true)));

        OperationalStatusDto status = service.assess(NOW);

        assertThat(status.status()).isEqualTo("OUT_OF_SERVICE");
        assertThat(status.summary()).contains("No monitored corridor");
    }

    @Test
    void repeatedProviderValuesDoNotCreateAFalseI70Outage() {
        freshCorridors();
        when(guardRepository.findById("tomtom"))
            .thenReturn(Optional.of(guard("DEGRADED", "STALE_PAYLOAD_WARNING", false)));

        OperationalStatusDto status = service.assess(NOW);

        assertThat(status.status()).isEqualTo("HEALTHY");
        assertThat(status.checks())
            .filteredOn(check -> check.component().equals("provider:tomtom"))
            .singleElement()
            .satisfies(check -> {
                assertThat(check.status()).isEqualTo("HEALTHY");
                assertThat(check.code()).isEqualTo("TOMTOM_VALUES_UNCHANGED");
                assertThat(check.message()).contains("not treated as a service failure");
            });
    }

    @Test
    void expectedAccountRolloverIsInformationalWhileFlowContinues() {
        freshCorridors();
        when(guardRepository.findById("tomtom"))
            .thenReturn(Optional.of(guard("DEGRADED", "ACCOUNT_CREDITS_EXHAUSTED", false)));

        OperationalStatusDto status = service.assess(NOW);

        assertThat(status.status()).isEqualTo("HEALTHY");
        assertThat(status.checks())
            .filteredOn(check -> check.component().equals("provider:tomtom"))
            .singleElement()
            .extracting(check -> check.code())
            .isEqualTo("TOMTOM_ACCOUNT_ROLLOVER");
    }

    @Test
    void cdotFreshnessUsesFetchTimeNotTheSourceEventTimestamp() {
        TrafficSample i25 = sample("I25", NOW.minusMinutes(2), NOW.minusMinutes(61));
        i25.setIncidentSourceUpdatedAt(NOW.minusMinutes(1));
        TrafficSample i70 = sample("I70", NOW.minusMinutes(2), NOW.minusMinutes(5));
        i70.setIncidentSourceUpdatedAt(NOW.minusMinutes(1));
        when(sampleRepository.findLatestUsableByCorridor(eq("I25"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(i25));
        when(sampleRepository.findLatestUsableByCorridor(eq("I70"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(i70));
        when(guardRepository.findById("tomtom")).thenReturn(Optional.of(guard("HEALTHY", null, false)));

        OperationalStatusDto status = service.assess(NOW);

        assertThat(status.status()).isEqualTo("DEGRADED");
        assertThat(status.checks())
            .filteredOn(check -> check.component().equals("incidents:cdot"))
            .singleElement()
            .satisfies(check -> {
                assertThat(check.code()).isEqualTo("CDOT_SNAPSHOT_STALE");
                assertThat(check.ageMinutes()).isEqualTo(61);
            });
    }

    @Test
    void databaseFailureReturnsAnExplainedOutOfServiceStatus() {
        when(sampleRepository.findLatestUsableByCorridor(eq("I25"), eq(PageRequest.of(0, 1))))
            .thenThrow(new DataAccessResourceFailureException("connection refused"));

        OperationalStatusDto status = service.assess(NOW);

        assertThat(status.status()).isEqualTo("OUT_OF_SERVICE");
        assertThat(status.checks()).singleElement().satisfies(check -> {
            assertThat(check.code()).isEqualTo("DATABASE_UNAVAILABLE");
            assertThat(check.message()).contains("DataAccessResourceFailureException");
            assertThat(check.suggestedAction()).contains("PostgreSQL");
        });
    }

    private void freshCorridors() {
        when(sampleRepository.findLatestUsableByCorridor(eq("I25"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(sample("I25", NOW.minusMinutes(2), NOW.minusMinutes(10))));
        when(sampleRepository.findLatestUsableByCorridor(eq("I70"), eq(PageRequest.of(0, 1))))
            .thenReturn(List.of(sample("I70", NOW.minusMinutes(3), NOW.minusMinutes(10))));
    }

    private static TrafficSample sample(
        String corridor,
        OffsetDateTime polledAt,
        OffsetDateTime incidentFetchedAt
    ) {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(corridor);
        sample.setAvgCurrentSpeed(55.0);
        sample.setPolledAt(polledAt);
        sample.setIncidentFetchedAt(incidentFetchedAt);
        return sample;
    }

    private static TrafficProviderGuardStatus guard(String state, String failureCode, boolean halted) {
        TrafficProviderGuardStatus guard = new TrafficProviderGuardStatus();
        guard.setProviderName("tomtom");
        guard.setState(state);
        guard.setFailureCode(failureCode);
        guard.setHalted(halted);
        guard.setLastCheckedAt(NOW.minusMinutes(1));
        guard.setMessage("Provider status detail.");
        return guard;
    }
}
