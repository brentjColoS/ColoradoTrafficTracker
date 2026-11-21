package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class LatestTrafficSamplesTest {
    private final TrafficSampleRepository repository = mock(TrafficSampleRepository.class);
    private final TrafficSample sample = new TrafficSample();

    @Test void usableSampleDoesNotRequireARawFallbackRead() {
        when(repository.findLatestUsableByCorridor(eq("I25"), any())).thenReturn(List.of(sample));
        assertSame(sample, LatestTrafficSamples.find(repository, "I25", true).orElseThrow());
        verify(repository, never()).findFirstByCorridorOrderByPolledAtDesc(anyString());
    }

    @Test void missingUsableSampleFallsBackToTheLatestRawSample() {
        when(repository.findLatestUsableByCorridor(eq("I25"), any())).thenReturn(List.of());
        when(repository.findFirstByCorridorOrderByPolledAtDesc("I25")).thenReturn(Optional.of(sample));
        assertSame(sample, LatestTrafficSamples.find(repository, "I25", true).orElseThrow());
    }

    @Test void rawRequestsDoNotQueryUsableSamples() {
        when(repository.findFirstByCorridorOrderByPolledAtDesc("I25")).thenReturn(Optional.of(sample));
        assertSame(sample, LatestTrafficSamples.find(repository, "I25", false).orElseThrow());
        verify(repository, never()).findLatestUsableByCorridor(anyString(), any());
    }

    @Test void absentRowsRemainUnavailableIncludingANullUsableResult() {
        when(repository.findLatestUsableByCorridor(eq("I25"), any())).thenReturn(null);
        when(repository.findFirstByCorridorOrderByPolledAtDesc("I25")).thenReturn(Optional.empty());
        assertTrue(LatestTrafficSamples.find(repository, "I25", true).isEmpty());
    }
}
