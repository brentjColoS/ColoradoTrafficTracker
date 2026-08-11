package com.example.api_service;

import com.example.api_service.dto.IncidentCorridorParityDto;
import com.example.api_service.dto.IncidentModelParityDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class IncidentModelParityService {

    private final TrafficSampleRepository sampleRepository;
    private final CurrentIncidentRepository currentIncidentRepository;
    private final ObjectMapper objectMapper;

    @Autowired
    public IncidentModelParityService(
        TrafficSampleRepository sampleRepository,
        Optional<CurrentIncidentRepository> currentIncidentRepository,
        ObjectMapper objectMapper
    ) {
        this.sampleRepository = sampleRepository;
        this.currentIncidentRepository = currentIncidentRepository.orElse(null);
        this.objectMapper = objectMapper;
    }

    IncidentModelParityService(
        TrafficSampleRepository sampleRepository,
        CurrentIncidentRepository currentIncidentRepository,
        ObjectMapper objectMapper
    ) {
        this(sampleRepository, Optional.ofNullable(currentIncidentRepository), objectMapper);
    }

    public IncidentModelParityDto compare() {
        if (currentIncidentRepository == null) {
            return new IncidentModelParityDto(
                OffsetDateTime.now(ZoneOffset.UTC),
                false,
                false,
                "The durable incident repository is not available",
                0,
                0,
                0,
                0,
                0,
                List.of()
            );
        }
        List<CurrentIncidentProjection> current = currentIncidentRepository.findAllCurrent();
        if (current == null) current = List.of();

        Map<String, List<CurrentIncidentProjection>> currentByCorridor = new LinkedHashMap<>();
        for (CurrentIncidentProjection incident : current) {
            if (incident == null || incident.getCorridor() == null) continue;
            currentByCorridor.computeIfAbsent(incident.getCorridor(), ignored -> new ArrayList<>())
                .add(incident);
        }

        Set<String> corridors = new TreeSet<>();
        List<String> sampledCorridors = sampleRepository.findDistinctCorridors();
        if (sampledCorridors != null) {
            sampledCorridors.stream()
                .filter(value -> value != null && !value.isBlank())
                .forEach(corridors::add);
        }
        corridors.addAll(currentByCorridor.keySet());

        List<IncidentCorridorParityDto> comparisons = corridors.stream()
            .map(corridor -> compareCorridor(
                corridor,
                sampleRepository.findFirstByCorridorOrderByPolledAtDesc(corridor).orElse(null),
                currentByCorridor.getOrDefault(corridor, List.of())
            ))
            .toList();

        int compatibilityCount = comparisons.stream()
            .mapToInt(IncidentCorridorParityDto::compatibilityIncidentCount)
            .sum();
        int durableCount = comparisons.stream()
            .mapToInt(IncidentCorridorParityDto::durableIncidentCount)
            .sum();
        int matchingCount = comparisons.stream()
            .mapToInt(IncidentCorridorParityDto::matchingIdentityCount)
            .sum();
        int mismatchCount = comparisons.stream()
            .mapToInt(comparison ->
                comparison.compatibilityOnlyIdentities().size()
                    + comparison.durableOnlyIdentities().size()
                    + comparison.payloadMismatchIdentities().size()
                    + comparison.unkeyedCompatibilityCount()
                    + (comparison.compatibilitySnapshotReadable() ? 0 : 1)
            )
            .sum();

        return new IncidentModelParityDto(
            OffsetDateTime.now(ZoneOffset.UTC),
            !comparisons.isEmpty(),
            !comparisons.isEmpty()
                && comparisons.stream().allMatch(IncidentCorridorParityDto::inParity),
            comparisons.isEmpty() ? "No incident corridors are available to compare" : null,
            comparisons.size(),
            compatibilityCount,
            durableCount,
            matchingCount,
            mismatchCount,
            comparisons
        );
    }

    private IncidentCorridorParityDto compareCorridor(
        String corridor,
        TrafficSample sample,
        List<CurrentIncidentProjection> durableIncidents
    ) {
        CompatibilitySnapshot compatibility = compatibilitySnapshot(sample);
        Map<String, JsonNode> durable = new LinkedHashMap<>();
        OffsetDateTime durableLastSeenAt = null;
        for (CurrentIncidentProjection incident : durableIncidents) {
            String key = identity(incident.getProvider(), incident.getProviderEventId());
            if (key != null) {
                durable.put(key, parsePayload(incident.getRawEventJson()));
            }
            if (
                incident.getLastSeenAt() != null
                    && (durableLastSeenAt == null
                        || incident.getLastSeenAt().isAfter(durableLastSeenAt))
            ) {
                durableLastSeenAt = incident.getLastSeenAt();
            }
        }

        Set<String> compatibilityOnly = new TreeSet<>(compatibility.incidents().keySet());
        compatibilityOnly.removeAll(durable.keySet());
        Set<String> durableOnly = new TreeSet<>(durable.keySet());
        durableOnly.removeAll(compatibility.incidents().keySet());

        Set<String> matching = new TreeSet<>(compatibility.incidents().keySet());
        matching.retainAll(durable.keySet());
        List<String> payloadMismatches = matching.stream()
            .filter(key -> !compatibility.incidents().get(key).equals(durable.get(key)))
            .toList();
        boolean inParity = compatibility.readable()
            && compatibility.unkeyedCount() == 0
            && compatibilityOnly.isEmpty()
            && durableOnly.isEmpty()
            && payloadMismatches.isEmpty();

        return new IncidentCorridorParityDto(
            corridor,
            inParity,
            compatibility.readable(),
            compatibility.error(),
            sample == null ? null : sample.getPolledAt(),
            sample == null ? null : sample.getIncidentFetchedAt(),
            durableLastSeenAt,
            compatibility.incidents().size(),
            durable.size(),
            matching.size(),
            compatibility.unkeyedCount(),
            List.copyOf(compatibilityOnly),
            List.copyOf(durableOnly),
            payloadMismatches
        );
    }

    private CompatibilitySnapshot compatibilitySnapshot(TrafficSample sample) {
        if (sample == null) {
            return new CompatibilitySnapshot(Map.of(), 0, false, "No current traffic sample exists");
        }
        if (sample.getIncidentsJson() == null || sample.getIncidentsJson().isBlank()) {
            return new CompatibilitySnapshot(Map.of(), 0, false, "The latest sample has no incident payload");
        }

        try {
            JsonNode incidents = objectMapper.readTree(sample.getIncidentsJson()).path("incidents");
            if (!incidents.isArray()) {
                return new CompatibilitySnapshot(Map.of(), 0, false, "The latest sample has no incidents array");
            }
            Map<String, JsonNode> keyed = new LinkedHashMap<>();
            int unkeyed = 0;
            for (JsonNode incident : incidents) {
                JsonNode properties = incident.path("properties");
                String key = identity(
                    text(properties, "provider", sample.getIncidentProvider()),
                    text(properties, "providerEventId", null)
                );
                if (key == null) {
                    unkeyed++;
                } else {
                    keyed.put(key, incident);
                }
            }
            return new CompatibilitySnapshot(Map.copyOf(keyed), unkeyed, true, null);
        } catch (Exception e) {
            return new CompatibilitySnapshot(
                Map.of(),
                0,
                false,
                "The latest sample incident payload is not valid JSON"
            );
        }
    }

    private JsonNode parsePayload(String rawEventJson) {
        if (rawEventJson == null || rawEventJson.isBlank()) {
            return objectMapper.getNodeFactory().nullNode();
        }
        try {
            return objectMapper.readTree(rawEventJson);
        } catch (Exception e) {
            return objectMapper.getNodeFactory().nullNode();
        }
    }

    private static String identity(String provider, String providerEventId) {
        if (providerEventId == null || providerEventId.isBlank()) return null;
        String normalizedProvider = provider == null || provider.isBlank()
            ? "unknown"
            : provider.trim().toLowerCase(Locale.ROOT);
        return normalizedProvider + "|" + providerEventId.trim();
    }

    private static String text(JsonNode node, String field, String fallback) {
        JsonNode value = node.path(field);
        return value.isTextual() && !value.asText().isBlank()
            ? value.asText().trim()
            : fallback;
    }

    private record CompatibilitySnapshot(
        Map<String, JsonNode> incidents,
        int unkeyedCount,
        boolean readable,
        String error
    ) {}
}
