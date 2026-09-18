package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;

class CurrentIncidentRepositoryTest {

    @Test
    void recentReadKeepsEndedEventsButRetainsTrackedLocationBounds() throws Exception {
        Query query = CurrentIncidentRepository.class.getMethod(
            "findRecentByCorridorSince", String.class, java.time.OffsetDateTime.class, int.class
        ).getAnnotation(Query.class);
        assertThat(query.value())
            .contains("(e.active and c.active) as active")
            .contains("(e.active = true or e.last_seen_at >= :since)")
            .contains("(c.active = true or c.last_matched_at >= :since)")
            .contains("c.closest_mile_marker between")
            .contains("<> 'off_corridor'")
            .contains("c.corridor = :corridor")
            .contains("limit :limit");
    }

    @Test
    void currentReadRequiresBothTheEventAndCorridorMatchToBeActive() throws Exception {
        Method method = CurrentIncidentRepository.class.getMethod("findAllCurrent");
        Query query = method.getAnnotation(Query.class);

        assertThat(query).isNotNull();
        assertThat(query.nativeQuery()).isTrue();
        assertThat(query.value())
            .contains("e.active = true")
            .contains("c.active = true")
            .contains("e.provider_event_id as providerEventId")
            .contains("c.closest_mile_marker as closestMileMarker");
    }

    @Test
    void timestampColumnsUseTheNativePostgresProjectionType() throws Exception {
        assertThat(CurrentIncidentProjection.class.getMethod("getSourceStartedAt").getReturnType())
            .isEqualTo(Instant.class);
        assertThat(CurrentIncidentProjection.class.getMethod("getSourceEndedAt").getReturnType())
            .isEqualTo(Instant.class);
        assertThat(CurrentIncidentProjection.class.getMethod("getSourceUpdatedAt").getReturnType())
            .isEqualTo(Instant.class);
        assertThat(CurrentIncidentProjection.class.getMethod("getFirstSeenAt").getReturnType())
            .isEqualTo(Instant.class);
        assertThat(CurrentIncidentProjection.class.getMethod("getLastSeenAt").getReturnType())
            .isEqualTo(Instant.class);
    }

    @Test
    void mapReadsStayWithinTrackedMileMarkers() throws Exception {
        Method method = CurrentIncidentRepository.class.getMethod(
            "findCurrentByCorridorSince",
            String.class,
            java.time.OffsetDateTime.class,
            int.class
        );
        Query query = method.getAnnotation(Query.class);

        assertThat(query).isNotNull();
        assertThat(query.nativeQuery()).isTrue();
        assertThat(query.value())
            .contains("e.active = true")
            .contains("c.active = true")
            .contains("join corridor_ref tracked")
            .contains("c.closest_mile_marker is not null")
            .contains("<> 'off_corridor'")
            .contains("c.closest_mile_marker between")
            .contains("c.corridor = :corridor")
            .contains("e.last_seen_at >= :since")
            .contains("limit :limit");
    }

    @Test
    void durableTimelineUsesLifecycleTimesRatherThanCurrentFlags() throws Exception {
        Method method = CurrentIncidentRepository.class.getMethod(
            "findDurableTimelineByCorridorBetween",
            String.class,
            java.time.OffsetDateTime.class,
            java.time.OffsetDateTime.class,
            java.time.OffsetDateTime.class,
            int.class
        );
        Query query = method.getAnnotation(Query.class);

        assertThat(query).isNotNull();
        assertThat(query.nativeQuery()).isTrue();
        assertThat(query.value())
            .contains("greatest(coalesce(e.source_started_at, e.first_seen_at), c.first_matched_at) <= :until")
            .contains("least(coalesce(e.source_ended_at, e.last_seen_at), c.last_matched_at) >= :since")
            .contains("least(coalesce(e.source_ended_at, e.last_seen_at), c.last_matched_at) >= :activeSince")
            .contains("least(coalesce(e.source_ended_at, e.last_seen_at), c.last_matched_at, :until) as lastSeenAt")
            .contains("e.provider_event_id as providerEventId")
            .contains("c.closest_mile_marker between")
            .doesNotContain("e.active = true")
            .doesNotContain("c.active = true");
    }

    @Test
    void durableEraCheckIsBoundedByTheReplayInstant() throws Exception {
        Method method = CurrentIncidentRepository.class.getMethod(
            "hasDurableEventsAtOrBefore", java.time.OffsetDateTime.class
        );
        Query query = method.getAnnotation(Query.class);

        assertThat(query).isNotNull();
        assertThat(query.value())
            .contains("traffic_incident_event")
            .contains("first_seen_at <= :until");
    }
}
