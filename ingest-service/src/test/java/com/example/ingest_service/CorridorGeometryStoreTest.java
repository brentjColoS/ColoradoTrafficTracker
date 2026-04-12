package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class CorridorGeometryStoreTest {
    @Mock
    private CorridorRefRepository corridorRefRepository;

    @InjectMocks
    private CorridorGeometryStore corridorGeometryStore;

    @Captor
    private ArgumentCaptor<CorridorRef> corridorRefCaptor;

    @Test
    void updateFromRoutingStoresLineGeometryMetadata() {
        CorridorRef ref = new CorridorRef();
        ref.setCode("I25");
        ref.setGeometryJson("{\"type\":\"LineString\",\"coordinates\":[[-105.0,40.0],[-104.0,39.0]]}");
        ref.setGeometrySource("bbox-derived");

        when(corridorRefRepository.findById("I25")).thenReturn(Optional.of(ref));

        corridorGeometryStore.updateFromRouting("I25", List.of(
            new double[]{39.9000, -105.1000},
            new double[]{39.7000, -104.9000}
        ));

        verify(corridorRefRepository).save(corridorRefCaptor.capture());
        CorridorRef saved = corridorRefCaptor.getValue();
        assertThat(saved.getGeometrySource()).isEqualTo("routing");
        assertThat(saved.getGeometryUpdatedAt()).isNotNull();
        assertThat(saved.getGeometryJson())
            .isEqualTo("{\"type\":\"LineString\",\"coordinates\":[[-105.100000,39.900000],[-104.900000,39.700000]]}");
    }

    @Test
    void updateFromRoutingSkipsShortPolylines() {
        corridorGeometryStore.updateFromRouting("I25", List.of(new double[]{39.9, -105.1}));

        verify(corridorRefRepository, never()).findById(eq("I25"));
        verify(corridorRefRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }
}
