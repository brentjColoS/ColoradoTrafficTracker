package com.example.ingest_service;

import static com.example.ingest_service.IncidentEventNormalizer.*;
import static com.example.ingest_service.IncidentEventStore.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IncidentEventWriter {

    private final IncidentEventStore store;
    private final IncidentEventNormalizer normalizer;

    public IncidentEventWriter(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.store = new IncidentEventStore(jdbcTemplate);
        this.normalizer = new IncidentEventNormalizer(objectMapper);
    }

    @Transactional
    public void publish(Map<String, CorridorIncidentSnapshot> snapshots) {
        if (snapshots == null || snapshots.isEmpty()) return;

        Map<SourceKey, Instant> refreshes = new LinkedHashMap<>();
        for (CorridorIncidentSnapshot snapshot : snapshots.values()) {
            SourceKey source = IncidentEventNormalizer.source(snapshot);
            refreshes.merge(source, snapshot.fetchedAt(), IncidentEventWriter::later);
            publishCorridorSnapshot(snapshot, source);
        }

        for (Map.Entry<SourceKey, Instant> refresh : refreshes.entrySet()) {
            store.markMissingEventsInactive(refresh.getKey(), refresh.getValue());
        }
    }

    private void publishCorridorSnapshot(CorridorIncidentSnapshot snapshot, SourceKey source) {
        for (Event event : normalizer.normalize(snapshot, source)) {
            Instant observedAt = snapshot.fetchedAt();
            EventState previousEvent = store.findEventState(source, event.providerEventId());
            Long eventId = store.upsertEvent(source, event, observedAt);
            if (eventId == null) {
                throw new IllegalStateException("Incident event upsert did not return an id for " + event.providerEventId());
            }
            store.insertEventTransition(eventId, eventTransition(previousEvent, event.payloadHash()),
                previousEvent == null ? null : previousEvent.payloadHash(), observedAt, event);
            CorridorMatch match = event.corridorMatch();
            CorridorState previousCorridor = store.findCorridorState(eventId, snapshot.corridor());
            store.upsertCorridorMatch(eventId, snapshot.corridor(), match, observedAt);
            store.insertCorridorTransition(eventId, snapshot.corridor(),
                corridorTransition(previousCorridor, match.matchHash()), observedAt, match);
            store.insertObservation(eventId, observedAt, event);
        }
    }

    private static Instant later(Instant left, Instant right) {
        return left.isAfter(right) ? left : right;
    }

    private static String eventTransition(EventState previous, String payloadHash) {
        if (previous == null) return "FIRST_SEEN";
        if (!previous.active()) return "REACTIVATED";
        if (!payloadHash.equals(previous.payloadHash())) return "PAYLOAD_CHANGED";
        return null;
    }

    private static String corridorTransition(CorridorState previous, String matchHash) {
        if (previous == null) return "FIRST_MATCHED";
        if (!previous.active()) return "REMATCHED";
        if (
            previous.matchHash() != null
                && !matchHash.equals(previous.matchHash())
        ) {
            return "MATCH_CHANGED";
        }
        return null;
    }

}
