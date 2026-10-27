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

    VariableSpeedSign observed(I70VariableSpeedSigns.Device device, Instant fetchedAt) {
        return new VariableSpeedSign(device.id(),device.mileMarker(),device.direction(),device.longitude(),device.latitude(),
            device.location(),device.regularLimitMph(),65,"AVAILABLE","on","operational",fetchedAt,null,fetchedAt,fetchedAt);
    }

    @Test void disabledOrUnconfiguredPollingCannotCreateRequestsOrDatabaseLeases() {
        poller(false,30,"fixture-key").poll(); poller(true,30,"").poll();
        verifyNoInteractions(client,store,lease);
    }

    @Test void spacesTheCatalogAcrossTheRefreshIntervalWithAnHourlyPerSignFloor() {
        poller(true,1,"fixture-key").poll();
        verify(lease).tryRun(eq("cdot-i70-variable-speed-signs"),eq(Duration.ofSeconds(86)),eq(Duration.ofMinutes(2)),any());
        poller(true,21600,"fixture-key").poll();
        verify(lease).tryRun(eq("cdot-i70-variable-speed-signs"),eq(Duration.ofSeconds(515)),eq(Duration.ofMinutes(2)),any());
        verifyNoInteractions(client,store);
        for (int setting:new int[]{-1,0,30,3599,3600}) {
            assertThat(new CdotVariableSpeedProps(true,setting).boundedRefreshSeconds()).isEqualTo(3600);
        }
        assertThat(new CdotVariableSpeedProps(true,43200).boundedRefreshSeconds()).isEqualTo(43200);
    }

    @Test void checksOnlyTheOldestCatalogDeviceAndRetainsUnconfirmedValuesAfterFailure() {
        var first = I70VariableSpeedSigns.devices().getFirst();
        VariableSpeedSign previous = new VariableSpeedSign(first.id(),first.mileMarker(),first.direction(),first.longitude(),first.latitude(),
            first.location(),first.regularLimitMph(),45,"AVAILABLE","on","operational",now.minusSeconds(21600),null,now.minusSeconds(21600),now.minusSeconds(21600));
        java.util.Map<String,VariableSpeedSign> current = new java.util.HashMap<>();
        for (var device:I70VariableSpeedSigns.devices()) current.put(device.id(),VariableSpeedSign.unobserved(device).failed(now));
        current.put(first.id(),previous);
        when(store.current()).thenReturn(current);
        when(client.fetch("fixture-key",first,now)).thenReturn(Mono.error(new IllegalStateException("Scoped read failed")));
        poller(true,21600,"fixture-key").pollOnce();
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
        VariableSpeedSign response=observed(first,now);
        when(store.current()).thenReturn(Map.of());
        when(client.fetch("fixture-key",first,now)).thenReturn(Mono.just(response));
        poller(true,30,"fixture-key").pollOnce();
        verify(store).save(response);verify(client,times(1)).fetch(anyString(),any(),any());
        assertThat(I70VariableSpeedSigns.devices()).hasSize(42);
        assertThat(I70VariableSpeedSigns.devices()).allMatch(device -> device.mileMarker()>=206&&device.mileMarker()<=274);
    }

    @Test void aFailedReadWaitsSixHoursEvenAcrossRestart() {
        var first=I70VariableSpeedSigns.devices().getFirst();
        var states=new java.util.HashMap<String,VariableSpeedSign>();
        for(var device:I70VariableSpeedSigns.devices()) states.put(device.id(),VariableSpeedSign.unobserved(device).failed(now));
        states.put(first.id(),VariableSpeedSign.unobserved(first).failed(now.minusSeconds(21600)));
        when(store.current()).thenReturn(states);
        doAnswer(call -> {VariableSpeedSign sign=call.getArgument(0);states.put(sign.id(),sign);return null;}).when(store).save(any());
        var attemptClock=mock(Clock.class);
        when(attemptClock.instant()).thenReturn(now,now.plusSeconds(30),now.plusSeconds(3600),now.plusSeconds(21599),now.plusSeconds(21600));
        when(client.fetch(eq("fixture-key"),any(),any())).thenReturn(Mono.error(
            CdotVariableSpeedClient.readFailure(new java.util.concurrent.TimeoutException("fixture-secret"))));
        var poller=new CdotVariableSpeedPoller(new CdotVariableSpeedProps(true,21600),new CdotProps("fixture-key","https://data.cotrip.org"),client,store,lease,attemptClock);
        poller.pollOnce();
        poller.pollOnce();
        var restarted=new CdotVariableSpeedPoller(new CdotVariableSpeedProps(true,21600),new CdotProps("fixture-key","https://data.cotrip.org"),client,store,lease,attemptClock);
        restarted.pollOnce();restarted.pollOnce();
        verify(client,times(1)).fetch(anyString(),any(),any());
        assertThat(states.get(first.id()).status()).isEqualTo("FETCH_FAILED");
        restarted.pollOnce();
        verify(client).fetch("fixture-key",first,now.plusSeconds(21600));
        verify(client,times(2)).fetch(anyString(),any(),any());
    }

    @Test void aCompleteStaggeredSweepDoesNotReadAnySignAgainBeforeSixHours() {
        var first=I70VariableSpeedSigns.devices().getFirst();
        var states=new java.util.HashMap<String,VariableSpeedSign>();
        when(store.current()).thenReturn(states);
        doAnswer(call -> {VariableSpeedSign sign=call.getArgument(0);states.put(sign.id(),sign);return null;}).when(store).save(any());
        when(client.fetch(anyString(),any(),any())).thenAnswer(call -> {
            I70VariableSpeedSigns.Device device=call.getArgument(1);
            return Mono.just(observed(device,call.getArgument(2)));
        });
        var attemptClock=mock(Clock.class);
        var poller=new CdotVariableSpeedPoller(new CdotVariableSpeedProps(true,21600),new CdotProps("fixture-key","https://data.cotrip.org"),client,store,lease,attemptClock);
        for(int i=0;i<42;i++) {
            when(attemptClock.instant()).thenReturn(now.plusSeconds(515L*i));
            poller.pollOnce();
        }
        assertThat(states).hasSize(42);
        verify(client,times(42)).fetch(anyString(),any(),any());
        when(attemptClock.instant()).thenReturn(now.plusSeconds(21599));poller.pollOnce();
        verify(client,times(42)).fetch(anyString(),any(),any());
        when(attemptClock.instant()).thenReturn(now.plusSeconds(21600));poller.pollOnce();
        verify(client).fetch("fixture-key",first,now.plusSeconds(21600));
        verify(client,times(43)).fetch(anyString(),any(),any());
    }

    @Test void evenAnUndersizedConfigurationCannotRereadASignWithinAnHour() {
        var first=I70VariableSpeedSigns.devices().getFirst();
        var current=new java.util.HashMap<String,VariableSpeedSign>();
        for(var device:I70VariableSpeedSigns.devices()) current.put(device.id(),VariableSpeedSign.unobserved(device).failed(now));
        when(store.current()).thenReturn(current);
        var attemptClock=mock(Clock.class);
        when(attemptClock.instant()).thenReturn(now.plusSeconds(3599),now.plusSeconds(3600));
        when(client.fetch(anyString(),any(),any())).thenReturn(Mono.just(VariableSpeedSign.unobserved(first).failed(now.plusSeconds(3600))));
        var poller=new CdotVariableSpeedPoller(new CdotVariableSpeedProps(true,30),new CdotProps("fixture-key","https://data.cotrip.org"),client,store,lease,attemptClock);
        poller.pollOnce();verifyNoInteractions(client);
        poller.pollOnce();verify(client,times(1)).fetch("fixture-key",first,now.plusSeconds(3600));
    }

    @Test void multipleOverdueSignsAreSelectedByAgeRatherThanCatalogOrder() {
        var oldest=I70VariableSpeedSigns.devices().getLast();
        var current=new java.util.HashMap<String,VariableSpeedSign>();
        for(var device:I70VariableSpeedSigns.devices()) current.put(device.id(),observed(device,now.minusSeconds(21600)));
        current.put(oldest.id(),observed(oldest,now.minusSeconds(43200)));
        when(store.current()).thenReturn(current);
        when(client.fetch("fixture-key",oldest,now)).thenReturn(Mono.just(observed(oldest,now)));
        poller(true,21600,"fixture-key").pollOnce();
        verify(client,times(1)).fetch("fixture-key",oldest,now);
        verify(store).save(observed(oldest,now));
    }
}
