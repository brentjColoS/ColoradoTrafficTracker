package com.example.api_service;

import com.example.api_service.dto.OperationalCheckDto;
import com.example.api_service.dto.OperationalStatusDto;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataAccessException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

@Service
public class OperationalStatusService {

    private static final String HEALTHY = "HEALTHY";
    private static final String DEGRADED = "DEGRADED";
    private static final String OUT_OF_SERVICE = "OUT_OF_SERVICE";
    private static final List<String> DEFAULT_CORRIDORS = List.of("I25", "I70");

    private final TrafficSampleRepository sampleRepository;
    private final ObjectProvider<TrafficProviderGuardStatusRepository> guardRepositoryProvider;
    private final OperationalStatusProps props;

    public OperationalStatusService(
        TrafficSampleRepository sampleRepository,
        ObjectProvider<TrafficProviderGuardStatusRepository> guardRepositoryProvider,
        OperationalStatusProps props
    ) {
        this.sampleRepository = sampleRepository;
        this.guardRepositoryProvider = guardRepositoryProvider;
        this.props = props;
    }

    public OperationalStatusDto assess(OffsetDateTime now) {
        List<OperationalCheckDto> checks = new ArrayList<>();
        List<TrafficSample> latestSamples = new ArrayList<>();
        int staleFlowCount = 0;

        try {
            for (String corridor : corridors()) {
                TrafficSample latest = sampleRepository
                    .findLatestUsableByCorridor(corridor, PageRequest.of(0, 1))
                    .stream()
                    .findFirst()
                    .orElse(null);
                latestSamples.add(latest);
                OperationalCheckDto check = flowCheck(corridor, latest, now);
                checks.add(check);
                if (!HEALTHY.equals(check.status())) {
                    staleFlowCount++;
                }
            }
        } catch (DataAccessException error) {
            return databaseUnavailable(now, error);
        }

        checks.add(incidentCheck(latestSamples, now));
        try {
            checks.add(providerCheck(now));
        } catch (DataAccessException error) {
            return databaseUnavailable(now, error);
        }

        String overall;
        String summary;
        if (staleFlowCount == latestSamples.size()) {
            overall = OUT_OF_SERVICE;
            summary = "No monitored corridor has a recent usable flow sample.";
        } else if (checks.stream().anyMatch(check -> DEGRADED.equals(check.status()))) {
            overall = DEGRADED;
            summary = "The site can still serve traffic data, but one or more checks need attention.";
        } else {
            overall = HEALTHY;
            summary = "Traffic flow and incident feeds are within their freshness thresholds.";
        }

        return new OperationalStatusDto(overall, now, summary, List.copyOf(checks));
    }

    private OperationalCheckDto flowCheck(String corridor, TrafficSample latest, OffsetDateTime now) {
        int threshold = positive(props.flowStaleAfterMinutes(), 60);
        if (latest == null || latest.getPolledAt() == null) {
            return new OperationalCheckDto(
                "flow:" + corridor,
                DEGRADED,
                "FLOW_SAMPLE_MISSING",
                "No usable flow sample has been recorded for " + corridor + ".",
                null,
                null,
                threshold,
                "Check TomTom account availability and the ingest-service logs for this corridor."
            );
        }

        int age = ageMinutes(latest.getPolledAt(), now);
        if (age > threshold) {
            return new OperationalCheckDto(
                "flow:" + corridor,
                DEGRADED,
                "FLOW_SAMPLE_STALE",
                "The latest usable " + corridor + " flow sample is " + age + " minutes old.",
                latest.getPolledAt(),
                age,
                threshold,
                "Check the ingest scheduler, TomTom availability, and recent provider errors."
            );
        }

        return new OperationalCheckDto(
            "flow:" + corridor,
            HEALTHY,
            "FLOW_SAMPLE_FRESH",
            "The latest usable " + corridor + " flow sample is within the expected live window.",
            latest.getPolledAt(),
            age,
            threshold,
            null
        );
    }

    private OperationalCheckDto incidentCheck(List<TrafficSample> latestSamples, OffsetDateTime now) {
        int threshold = positive(props.incidentStaleAfterMinutes(), 60);
        boolean missingFetch = latestSamples.stream()
            .anyMatch(sample -> sample == null || sample.getIncidentFetchedAt() == null);
        OffsetDateTime oldestFetch = latestSamples.stream()
            .filter(sample -> sample != null && sample.getIncidentFetchedAt() != null)
            .map(TrafficSample::getIncidentFetchedAt)
            .min(OffsetDateTime::compareTo)
            .orElse(null);

        if (missingFetch || oldestFetch == null) {
            return new OperationalCheckDto(
                "incidents:cdot",
                DEGRADED,
                "CDOT_SNAPSHOT_MISSING",
                "No CDOT incident fetch time is available on the latest corridor samples.",
                null,
                null,
                threshold,
                "Check the CDOT poller configuration and its most recent response."
            );
        }

        int age = ageMinutes(oldestFetch, now);
        if (age > threshold) {
            return new OperationalCheckDto(
                "incidents:cdot",
                DEGRADED,
                "CDOT_SNAPSHOT_STALE",
                "The oldest CDOT snapshot attached to a current corridor sample is " + age + " minutes old.",
                oldestFetch,
                age,
                threshold,
                "Check CDOT connectivity and the incident poller logs; the last complete snapshot remains in use."
            );
        }

        return new OperationalCheckDto(
            "incidents:cdot",
            HEALTHY,
            "CDOT_SNAPSHOT_FRESH",
            "CDOT incident snapshots are within the expected live window.",
            oldestFetch,
            age,
            threshold,
            null
        );
    }

    private OperationalCheckDto providerCheck(OffsetDateTime now) {
        int threshold = positive(props.providerStaleAfterMinutes(), 60);
        TrafficProviderGuardStatusRepository repository = guardRepositoryProvider.getIfAvailable();
        TrafficProviderGuardStatus guard = Optional.ofNullable(repository)
            .flatMap(value -> value.findById("tomtom"))
            .orElse(null);

        if (guard == null || guard.getLastCheckedAt() == null) {
            return new OperationalCheckDto(
                "provider:tomtom",
                DEGRADED,
                "TOMTOM_STATUS_UNKNOWN",
                "No current TomTom provider status has been recorded.",
                null,
                null,
                threshold,
                "Check ingest-service startup and its provider validation result."
            );
        }

        int age = ageMinutes(guard.getLastCheckedAt(), now);
        if (age > threshold) {
            return new OperationalCheckDto(
                "provider:tomtom",
                DEGRADED,
                "TOMTOM_STATUS_STALE",
                "The TomTom provider guard has not reported for " + age + " minutes.",
                guard.getLastCheckedAt(),
                age,
                threshold,
                "Check whether ingest-service is running and able to update its provider status."
            );
        }

        String failureCode = normalized(guard.getFailureCode());
        if ("STALE_PAYLOAD_WARNING".equals(failureCode)) {
            return new OperationalCheckDto(
                "provider:tomtom",
                HEALTHY,
                "TOMTOM_VALUES_UNCHANGED",
                "TomTom values are repeating, but fresh usable samples are still being ingested. Repetition is not treated as a service failure.",
                guard.getLastCheckedAt(),
                age,
                threshold,
                null
            );
        }
        if ("ACCOUNT_CREDITS_EXHAUSTED".equals(failureCode)) {
            return new OperationalCheckDto(
                "provider:tomtom",
                HEALTHY,
                "TOMTOM_ACCOUNT_ROLLOVER",
                "One TomTom account reached its limit and ingestion is continuing with another configured account.",
                guard.getLastCheckedAt(),
                age,
                threshold,
                null
            );
        }

        if (guard.isHalted() || "HALTED".equals(normalized(guard.getState()))) {
            return new OperationalCheckDto(
                "provider:tomtom",
                DEGRADED,
                failureCode.isBlank() ? "TOMTOM_INGEST_HALTED" : failureCode,
                messageOrDefault(guard.getMessage(), "TomTom flow ingestion is halted."),
                guard.getLastCheckedAt(),
                age,
                threshold,
                "Correct the reported provider problem; OUT_OF_SERVICE is reserved for loss of fresh flow on every corridor."
            );
        }

        String state = normalized(guard.getState());
        if ("DEGRADED".equals(state) || "RECOVERING".equals(state) || !failureCode.isBlank()) {
            return new OperationalCheckDto(
                "provider:tomtom",
                DEGRADED,
                failureCode.isBlank() ? "TOMTOM_PROVIDER_DEGRADED" : failureCode,
                messageOrDefault(guard.getMessage(), "TomTom ingestion is recovering from a provider problem."),
                guard.getLastCheckedAt(),
                age,
                threshold,
                "Review the reported provider reason and confirm that new corridor samples continue to arrive."
            );
        }

        return new OperationalCheckDto(
            "provider:tomtom",
            HEALTHY,
            "TOMTOM_PROVIDER_AVAILABLE",
            messageOrDefault(guard.getMessage(), "TomTom is returning usable traffic data."),
            guard.getLastCheckedAt(),
            age,
            threshold,
            null
        );
    }

    private OperationalStatusDto databaseUnavailable(OffsetDateTime now, DataAccessException error) {
        String message = "The traffic database could not be read: " + error.getClass().getSimpleName() + ".";
        OperationalCheckDto check = new OperationalCheckDto(
            "database",
            OUT_OF_SERVICE,
            "DATABASE_UNAVAILABLE",
            message,
            null,
            null,
            null,
            "Check PostgreSQL container health, disk availability, and database connection errors."
        );
        return new OperationalStatusDto(
            OUT_OF_SERVICE,
            now,
            "Traffic data cannot be served because the database is unavailable.",
            List.of(check)
        );
    }

    private List<String> corridors() {
        if (props.corridors() == null || props.corridors().isEmpty()) {
            return DEFAULT_CORRIDORS;
        }
        List<String> configured = props.corridors().stream()
            .filter(value -> value != null && !value.isBlank())
            .map(value -> value.trim().toUpperCase(Locale.ROOT))
            .distinct()
            .toList();
        return configured.isEmpty() ? DEFAULT_CORRIDORS : configured;
    }

    private static int positive(int configured, int fallback) {
        return configured > 0 ? configured : fallback;
    }

    private static int ageMinutes(OffsetDateTime observedAt, OffsetDateTime now) {
        return (int) Math.max(0, Duration.between(observedAt, now).toMinutes());
    }

    private static String normalized(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static String messageOrDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
