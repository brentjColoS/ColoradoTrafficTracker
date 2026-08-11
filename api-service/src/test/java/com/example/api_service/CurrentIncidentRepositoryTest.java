package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;

class CurrentIncidentRepositoryTest {

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
}
