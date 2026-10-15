package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import reactor.core.publisher.Mono;

class CdotVariableSpeedPollerTest {
    final Instant now = Instant.parse("2026-10-14T23:00:00Z");
    final Clock clock = Clock.fixed(now,ZoneOffset.UTC);
    final VariableSpeedSignStore store = mock(VariableSpeedSignStore.class);
    final CdotVariableSpeedClient client = mock(CdotVariableSpeedClient.class);
    final TrafficSchedulerLease lease = mock(TrafficSchedulerLease.class);

    CdotVariableSpeedPoller poller(boolean enabled, int interval, String key) {
        return new CdotVariableSpeedPoller(new CdotVariableSpeedProps(enabled,interval),new CdotProps(key,"https://data.cotrip.org"),client,store,lease,clock);
    }

    @Test void disabledOrUnconfiguredPollingCannotCreateRequestsOrDatabaseLeases() {
        poller(false,30,"fixture-key").poll(); poller(true,30,"").poll();
        verifyNoInteractions(client,store,lease);
    }

    @Test void usesTheSharedLeaseAndNeverExceedsOneRequestPerThirtySeconds() {
        poller(true,1,"fixture-key").poll();
        verify(lease).tryRun(eq("cdot-i70-variable-speed-signs"),eq(Duration.ofSeconds(30)),eq(Duration.ofMinutes(2)),any());
        verifyNoInteractions(client,store);
    }

    @Test void checksOnlyTheOldestCatalogDeviceAndRetainsUnconfirmedValuesAfterFailure() {
        var first = I70VariableSpeedSigns.devices().getFirst();
        VariableSpeedSign previous = new VariableSpeedSign(first.id(),first.mileMarker(),first.direction(),first.longitude(),first.latitude(),
            first.location(),first.regularLimitMph(),45,"AVAILABLE","on","operational",now.minusSeconds(120),null,now.minusSeconds(60),now.minusSeconds(60));
        java.util.Map<String,VariableSpeedSign> current = new java.util.HashMap<>();
        for (var device:I70VariableSpeedSigns.devices()) current.put(device.id(),VariableSpeedSign.unobserved(device).failed(now));
        current.put(first.id(),previous);
        when(store.current()).thenReturn(current);
        when(client.fetch("fixture-key",first,now)).thenReturn(Mono.error(new IllegalStateException("Scoped read failed")));
        poller(true,30,"fixture-key").pollOnce();
        ArgumentCaptor<VariableSpeedSign> saved = ArgumentCaptor.forClass(VariableSpeedSign.class);
        verify(store).save(saved.capture());
        assertThat(saved.getValue().status()).isEqualTo("FETCH_FAILED");
        assertThat(saved.getValue().reportedLimitMph()).isEqualTo(45);
        assertThat(saved.getValue().fetchedAt()).isEqualTo(previous.fetchedAt());
        assertThat(saved.getValue().lastAttemptAt()).isEqualTo(now);
        assertThat(saved.getValue().belowRegularLimit()).isFalse();
        verify(client,times(1)).fetch(anyString(),any(),any());
    }

    @Test void anEmptyStoreStartsWithOneKnownDeviceAndSavesTheScopedResponse() {
        var first=I70VariableSpeedSigns.devices().getFirst();
        VariableSpeedSign response=VariableSpeedSign.unobserved(first).failed(now);
        when(store.current()).thenReturn(Map.of());
        when(client.fetch("fixture-key",first,now)).thenReturn(Mono.just(response));
        poller(true,30,"fixture-key").pollOnce();
        verify(store).save(response);verify(client,times(1)).fetch(anyString(),any(),any());
        assertThat(I70VariableSpeedSigns.devices()).hasSize(42);
        assertThat(I70VariableSpeedSigns.devices()).allMatch(device -> device.mileMarker()>=206&&device.mileMarker()<=274);
    }
}
