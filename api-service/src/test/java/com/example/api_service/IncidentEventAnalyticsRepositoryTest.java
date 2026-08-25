package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;

class IncidentEventAnalyticsRepositoryTest {

    @Test
    void eventWindowsUseLifecycleOverlapInsteadOfSampleCopies() throws Exception {
        Method method = IncidentEventAnalyticsRepository.class.getMethod(
            "countEventsOverlapping",
            String.class,
            OffsetDateTime.class,
            OffsetDateTime.class
        );
        Query query = method.getAnnotation(Query.class);

        assertThat(query).isNotNull();
        assertThat(query.nativeQuery()).isTrue();
        assertThat(query.value())
            .contains("traffic_incident_event e")
            .contains("traffic_incident_event_corridor c")
            .contains("e.first_seen_at < :until")
            .contains("e.active = true or e.last_seen_at >= :from")
            .doesNotContain("traffic_incident_all");
    }

    @Test
    void hotspotsCountDurableStatesWithinTrackedMileMarkers() throws Exception {
        Method method = IncidentEventAnalyticsRepository.class.getMethod(
            "findHotspotsByCorridor",
            String.class,
            OffsetDateTime.class,
            int.class
        );
        Query query = method.getAnnotation(Query.class);

        assertThat(query).isNotNull();
        assertThat(query.nativeQuery()).isTrue();
        assertThat(query.value())
            .contains("traffic_incident_event_transition")
            .contains("sum(event_rows.observation_count)")
            .contains("join corridor_ref tracked")
            .contains("c.closest_mile_marker between")
            .contains("c.corridor = :corridor")
            .doesNotContain("traffic_incident_all");
    }
}
