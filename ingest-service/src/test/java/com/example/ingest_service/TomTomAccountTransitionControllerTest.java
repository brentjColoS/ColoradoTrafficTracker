package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class TomTomAccountTransitionControllerTest {

    @Test
    void returnsCredentialFreeTransitionHistory() {
        TomTomAccountTransitionHistory history = mock(TomTomAccountTransitionHistory.class);
        TomTomAccountTransitionEvent event = new TomTomAccountTransitionEvent(
            4,
            Instant.parse("2026-08-01T00:00:05Z"),
            TomTomAccountTransitionType.MONTH_BOUNDARY,
            "tomtom",
            "traffic-flow-incidents-vector-tiles",
            LocalDate.parse("2026-08-01"),
            LocalDate.parse("2026-09-01"),
            "secondary",
            "primary",
            8,
            162_120L,
            8
        );
        when(history.recent(90)).thenReturn(List.of(event));

        List<TomTomAccountTransitionEvent> response =
            new TomTomAccountTransitionController(history).history(90);

        assertThat(response).containsExactly(event);
        assertThat(response.toString()).doesNotContain("key").doesNotContain("secret");
        verify(history).recent(90);
    }
}
