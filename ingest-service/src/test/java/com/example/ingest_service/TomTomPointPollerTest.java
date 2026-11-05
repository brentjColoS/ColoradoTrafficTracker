package com.example.ingest_service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

class TomTomPointPollerTest {
    @Test
    void pointModeKeepsStoppedFreewaySpeedsAndFiltersIncidentRoadAndProximity() {
        var calls = new AtomicInteger();
        var client = WebClient.builder().exchangeFunction(request -> {
            boolean flow = request.url().getPath().contains("flowSegmentData");
            String body;
            if (flow) {
                int number = calls.incrementAndGet();
                assertThat(request.url().getQuery()).contains("unit=mph");
                assertThat(request.headers().getFirst("Tracking-ID")).isNotBlank();
                body = "{\"flowSegmentData\":{\"frc\":\"" + (number == 5 ? "FRC2" : "FRC0")
                    + "\",\"currentSpeed\":0,\"freeFlowSpeed\":60,\"confidence\":0.9}}";
            } else {
                body = "{\"incidents\":[" + incident("I-70", -105) + "," + incident("I-25", -105)
                    + "," + incident("I-70", -100) + "]}";
            }
            return Mono.just(ClientResponse.create(HttpStatus.OK).header("Content-Type", "application/json").body(body).build());
        }).build();
        var writer = mock(TrafficSampleWriter.class);
        var guard = mock(TrafficProviderGuardService.class);
        var poller = poller(client, writer, guard);

        var result = poller.poll(corridor()).block();

        assertThat(calls).hasValue(5);
        assertThat(result.sampledSpeeds()).containsExactly(0.0, 0.0, 0.0, 0.0);
        var sample = org.mockito.ArgumentCaptor.forClass(TrafficSample.class);
        verify(writer).saveSample(sample.capture());
        assertThat(sample.getValue().getSourceMode()).isEqualTo("point");
        assertThat(sample.getValue().getAvgCurrentSpeed()).isZero();
        assertThat(sample.getValue().getAvgFreeflowSpeed()).isEqualTo(60.0);
        assertThat(sample.getValue().getConfidence()).isEqualTo(0.9);
        assertThat(sample.getValue().getIncidentCount()).isEqualTo(1);
        assertThat(sample.getValue().getFlowProduct()).isEqualTo("traffic-flow-segment-data");
        assertThat(sample.getValue().getIncidentProduct()).isEqualTo("traffic-incident-details");
    }

    @Test
    void recoverablePointFailuresKeepTheExistingEmptySampleAndGuardReporting() {
        var client = WebClient.builder().exchangeFunction(request -> Mono.just(
            ClientResponse.create(HttpStatus.SERVICE_UNAVAILABLE).build())).build();
        var writer = mock(TrafficSampleWriter.class);
        var guard = mock(TrafficProviderGuardService.class);

        var result = poller(client, writer, guard).poll(corridor()).block();

        assertThat(result.sampledSpeeds()).isEmpty();
        var sample = org.mockito.ArgumentCaptor.forClass(TrafficSample.class);
        verify(writer).saveSample(sample.capture());
        assertThat(sample.getValue().getAvgCurrentSpeed()).isNull();
        assertThat(sample.getValue().getIncidentCount()).isZero();
        verify(guard, atLeastOnce()).recordRecoverableProviderFailure(eq("traffic/services/4/flowSegmentData"), any(Throwable.class));
        verify(guard).recordRecoverableProviderFailure(eq("traffic/services/5/incidentDetails"), any(Throwable.class));
    }

    @Test
    void partialAndNonNumericFlowFieldsDoNotBecomeFalseZeroSpeeds() {
        var responses = List.of("{}",
            "{\"flowSegmentData\":{\"frc\":\"FRC0\",\"currentSpeed\":\"45\",\"confidence\":\"0.9\"}}",
            "{\"flowSegmentData\":{\"frc\":\"FRC1\",\"currentSpeed\":45,\"freeFlowSpeed\":60,\"confidence\":0.8}}",
            "{\"flowSegmentData\":{\"frc\":\"FRC2\",\"currentSpeed\":90}}", "{}");
        var calls = new AtomicInteger();
        var client = WebClient.builder().exchangeFunction(request -> response(
            request.url().getPath().contains("flowSegmentData") ? responses.get(calls.getAndIncrement()) : "{}")) .build();
        var writer = mock(TrafficSampleWriter.class);
        var result = poller(client, writer, mock(TrafficProviderGuardService.class)).poll(corridor()).block();
        assertThat(result.sampledSpeeds()).containsExactly(45.0);
        var sample = org.mockito.ArgumentCaptor.forClass(TrafficSample.class);
        verify(writer).saveSample(sample.capture());
        assertThat(sample.getValue().getSpeedSampleCount()).isEqualTo(1);
        assertThat(sample.getValue().getAvgFreeflowSpeed()).isEqualTo(60.0);
        assertThat(sample.getValue().getConfidence()).isEqualTo(0.8);
        assertThat(sample.getValue().getIncidentCount()).isZero();
    }

    @Test
    void malformedFlowAndIncidentJsonAreReportedWithoutInventingUsableData() {
        var client = WebClient.builder().exchangeFunction(request -> response("{invalid")).build();
        var guard = mock(TrafficProviderGuardService.class);
        var result = poller(client, mock(TrafficSampleWriter.class), guard).poll(corridor()).block();
        assertThat(result.sampledSpeeds()).isEmpty();
        verify(guard, times(5)).recordRecoverableProviderFailure(eq("traffic/services/4/flowSegmentData"), any(Throwable.class));
        verify(guard).recordRecoverableProviderFailure(eq("traffic/services/5/incidentDetails"), any(Throwable.class));
        verify(guard, never()).tripAuthorizationFailure(anyString(), anyInt(), anyString());
    }

    @Test
    void authorizationFailuresUseTheGuardInsteadOfRecoverableFailureReporting() {
        var client = WebClient.builder().exchangeFunction(request -> Mono.just(
            ClientResponse.create(HttpStatus.FORBIDDEN).body("forbidden").build())).build();
        var guard = mock(TrafficProviderGuardService.class);
        when(guard.isAuthorizationFailure(any())).thenReturn(true);
        var result = poller(client, mock(TrafficSampleWriter.class), guard).poll(corridor()).block();
        assertThat(result.sampledSpeeds()).isEmpty();
        verify(guard, times(5)).tripAuthorizationFailure("traffic/services/4/flowSegmentData", 403, "forbidden");
        verify(guard).tripAuthorizationFailure("traffic/services/5/incidentDetails", 403, "forbidden");
        verify(guard, never()).recordRecoverableProviderFailure(anyString(), any(Throwable.class));
    }

    @Test
    void failedRoutingUsesBboxSamplesAndRetriesBeforeCachingSuccessfulGeometry() {
        var routingCalls = new AtomicInteger();
        var points = new java.util.ArrayList<String>();
        var client = WebClient.builder().exchangeFunction(request -> {
            if (request.url().getPath().contains("calculateRoute")) {
                if (routingCalls.incrementAndGet() == 1) return Mono.just(
                    ClientResponse.create(HttpStatus.SERVICE_UNAVAILABLE).build());
                return response("{\"routes\":[{\"legs\":[{\"points\":[{\"latitude\":39.70,\"longitude\":-105},{\"latitude\":39.72,\"longitude\":-105}]}]}]}");
            }
            if (request.url().getPath().contains("flowSegmentData")) points.add(request.url().getQuery());
            return response("{}");
        }).build();
        var governor = mock(TomTomRequestGovernor.class);
        when(governor.flowSegment(any())).thenAnswer(call -> invoke(call.getArgument(0)));
        when(governor.incidentDetails(any())).thenAnswer(call -> invoke(call.getArgument(0)));
        when(governor.routing(any())).thenAnswer(call -> invoke(call.getArgument(0)));
        var store = mock(CorridorGeometryStore.class);
        var poller = new TomTomPointPoller(client, new TrafficPullProps(null, null, null),
            mock(TrafficSampleWriter.class), store, mock(TrafficProviderGuardService.class), governor);
        var c = corridor();
        var withoutGeometry = new TrafficProps.Corridor(c.name(), c.displayName(), c.roadNumber(),
            c.primaryDirection(), c.secondaryDirection(), c.startMileMarker(), c.endMileMarker(),
            c.mileMarkerAnchors(), c.bbox(), null, null, c.maxSnapDistanceMeters());
        poller.poll(withoutGeometry).block();
        assertThat(points).hasSize(5);
        assertThat(points.get(0)).contains("point=39.7,-105.0");
        assertThat(points.get(4)).contains("point=39.72,-105.0");
        points.clear();
        poller.poll(withoutGeometry).block();
        assertThat(points).hasSize(5);
        assertThat(points.get(0)).doesNotContain("point=39.7,-105.0");
        poller.poll(withoutGeometry).block();
        assertThat(routingCalls).hasValue(2);
        verify(store).updateFromRouting(eq("I70"), argThat(poly -> poly.size() == 2));
    }

    @Test
    void lineAndMultilineIncidentsRequireAtLeastOneVertexNearTheCorridor() {
        String roads = "\"properties\":{\"roadNumbers\":[\" i-70 \"]}";
        String line = "{\"type\":\"LineString\",\"coordinates\":[[-100,39.71],[-105,39.71]]}";
        String multi = "{\"type\":\"MultiLineString\",\"coordinates\":[[[-100,39.71]],[[-105,39.71]]]}";
        String invalid = "{\"type\":\"Polygon\",\"coordinates\":[]}";
        var client = WebClient.builder().exchangeFunction(request -> response(
            request.url().getPath().contains("incidentDetails")
                ? "{\"incidents\":[{" + roads + ",\"geometry\":" + line + "},{" + roads
                    + ",\"geometry\":" + multi + "},{" + roads + ",\"geometry\":" + invalid + "}]}" : "{}")) .build();
        var writer = mock(TrafficSampleWriter.class);
        poller(client, writer, mock(TrafficProviderGuardService.class)).poll(corridor()).block();
        var sample = org.mockito.ArgumentCaptor.forClass(TrafficSample.class);
        verify(writer).saveSample(sample.capture());
        assertThat(sample.getValue().getIncidentCount()).isEqualTo(2);
    }

    private static Mono<ClientResponse> response(String json) {
        return Mono.just(ClientResponse.create(HttpStatus.OK).header("Content-Type", "application/json").body(json).build());
    }

    private static TomTomPointPoller poller(WebClient client, TrafficSampleWriter writer, TrafficProviderGuardService guard) {
        var governor = mock(TomTomRequestGovernor.class);
        when(governor.flowSegment(any())).thenAnswer(call -> invoke(call.getArgument(0)));
        when(governor.incidentDetails(any())).thenAnswer(call -> invoke(call.getArgument(0)));
        return new TomTomPointPoller(client, new TrafficPullProps(null, null, null), writer,
            mock(CorridorGeometryStore.class), guard, governor);
    }

    private static Mono<JsonNode> invoke(Function<TomTomAccount, Mono<JsonNode>> request) {
        return request.apply(new TomTomAccount("primary", "fixture"));
    }

    private static TrafficProps.Corridor corridor() {
        return new TrafficProps.Corridor("I70", "I70", "I-70", "E", "W", 260.0, 261.0, List.of(),
            "39.70,-105,39.72,-105", "{\"type\":\"LineString\",\"coordinates\":[[-105,39.70],[-105,39.72]]}", null, 550.0);
    }

    private static String incident(String road, double lon) {
        return "{\"properties\":{\"roadNumbers\":[\""+road+"\"]},\"geometry\":{\"type\":\"Point\",\"coordinates\":["+lon+",39.71]}}";
    }
}
