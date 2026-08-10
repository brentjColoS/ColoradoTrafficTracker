package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class TomTomResetProbeControllerTest {

    @Test
    void returnsBoundedCredentialFreeHistory() {
        TomTomResetProbeHistory history = mock(TomTomResetProbeHistory.class);
        TomTomResetProbeEvent event = new TomTomResetProbeEvent(
            7,
            "secondary",
            Instant.parse("2026-08-01T04:17:00Z"),
            TomTomResetProbeOutcome.AVAILABLE,
            200,
            null
        );
        when(history.recent(500)).thenReturn(List.of(event));

        List<TomTomResetProbeEvent> response =
            new TomTomResetProbeController(history).history(500);

        assertThat(response).containsExactly(event);
        assertThat(response.toString()).doesNotContain("apiKey");
        verify(history).recent(500);
    }
}
