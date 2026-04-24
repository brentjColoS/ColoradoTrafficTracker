package com.example.ingest_service;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeoutException;

@Component
public class FlowSegmentSampler {

    private static final Logger log = LoggerFactory.getLogger(FlowSegmentSampler.class);

    private final WebClient http;
    private final CorridorGeometryStore corridorGeometryStore;
    private final TrafficProviderGuardService providerGuardService;
    private final Map<String, CorridorGeometry> routeCache = new ConcurrentHashMap<>();

    private static record CorridorGeometry(List<double[]> polyline, List<double[]> samplePoints) {}

    public record FlowSample(
        List<double[]> polyline,
        List<double[]> samplePoints,
        List<Double> currentSpeeds,
        List<Double> freeflowSpeeds,
        List<Double> confidences
    ) {
        public FlowSample {
            polyline = polyline == null ? List.of() : List.copyOf(polyline);
            samplePoints = samplePoints == null ? List.of() : List.copyOf(samplePoints);
            currentSpeeds = currentSpeeds == null ? List.of() : List.copyOf(currentSpeeds);
            freeflowSpeeds = freeflowSpeeds == null ? List.of() : List.copyOf(freeflowSpeeds);
            confidences = confidences == null ? List.of() : List.copyOf(confidences);
        }

        public TrafficStats stats() {
            return TrafficStats.fromSpeeds(currentSpeeds);
        }

        public Double avgFreeflowSpeed() {
            return avg(freeflowSpeeds);
        }

        public Double avgConfidence() {
            return avg(confidences);
        }

        public boolean hasUsableSpeedData() {
            return !currentSpeeds.isEmpty();
        }

        public int requestedPointCount() {
            return samplePoints.size();
        }

        public int usablePointCount() {
            return currentSpeeds.size();
        }

        public double coverageRatio() {
            if (requestedPointCount() <= 0) return 0.0;
            return usablePointCount() / (double) requestedPointCount();
        }
    }

    public FlowSegmentSampler(
        @Qualifier("tomtomWebClient") WebClient http,
        CorridorGeometryStore corridorGeometryStore,
        TrafficProviderGuardService providerGuardService
    ) {
        this.http = http;
        this.corridorGeometryStore = corridorGeometryStore;
        this.providerGuardService = providerGuardService;
    }

    public Mono<FlowSample> sampleCorridor(TrafficProps.Corridor corridor, String key, int samplePointCount) {
        int points = Math.max(1, samplePointCount);
        return geomForCorridor(corridor, key, points)
            .flatMap(geom -> flowsForPoints(geom.samplePoints(), key)
                .map(flows -> flowSampleFromResponses(geom, flows)));
    }

    private FlowSample flowSampleFromResponses(CorridorGeometry geom, List<JsonNode> responses) {
        List<Double> currentSpeeds = new ArrayList<>();
        List<Double> freeflowSpeeds = new ArrayList<>();
        List<Double> confidences = new ArrayList<>();

        for (JsonNode flowResp : responses) {
            JsonNode flow = flowResp.path("flowSegmentData");
            if (flow.isMissingNode()) continue;

            String frc = flow.path("frc").asText("");
            if (!"FRC0".equals(frc) && !"FRC1".equals(frc)) continue;
            if (flow.path("currentSpeed").isNumber()) currentSpeeds.add(flow.get("currentSpeed").asDouble());
            if (flow.path("freeFlowSpeed").isNumber()) freeflowSpeeds.add(flow.get("freeFlowSpeed").asDouble());
            if (flow.path("confidence").isNumber()) confidences.add(flow.get("confidence").asDouble());
        }

        return new FlowSample(
            geom.polyline(),
            geom.samplePoints(),
            currentSpeeds,
            freeflowSpeeds,
            confidences
        );
    }

    private Mono<JsonNode> flowCall(double lat, double lon, String key) {
        return http.get()
            .uri(u -> u.path("/traffic/services/4/flowSegmentData/absolute/12/json")
                .queryParam("point", lat + "," + lon)
                .queryParam("unit", "mph")
                .queryParam("key", key)
                .build())
            .header("Cache-Control", "no-cache")
            .header("Pragma", "no-cache")
            .header("Tracking-ID", UUID.randomUUID().toString())
            .retrieve()
            .bodyToMono(JsonNode.class)
            .timeout(Duration.ofSeconds(6))
            .retryWhen(
                Retry.backoff(2, Duration.ofMillis(200))
                    .filter(ex -> {
                        if (ex instanceof WebClientResponseException w) {
                            return w.getStatusCode().is5xxServerError();
                        }
                        return (ex instanceof TimeoutException) || (ex instanceof IOException);
                    })
            )
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.recordOptionalAuthorizationFailure(
                        "traffic/services/4/flowSegmentData",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString(),
                        "Route-point validation is unavailable because TomTom rejected the optional flow-segment endpoint; ingest remains enabled with tile-only speeds."
                    );
                }
                log.debug("Flow call failed for {},{}: {}", lat, lon, e.toString());
                return Mono.empty();
            });
    }

    private Mono<List<JsonNode>> flowsForPoints(List<double[]> points, String key) {
        return Flux.fromIterable(points)
            .concatMap(point -> flowCall(point[0], point[1], key))
            .collectList();
    }

    private Mono<CorridorGeometry> geomForCorridor(TrafficProps.Corridor corridor, String key, int samplePointCount) {
        CorridorGeometry cached = routeCache.get(corridor.name());
        if (cached != null && cached.samplePoints().size() == samplePointCount) {
            return Mono.just(cached);
        }

        List<double[]> configuredPolyline = CorridorGeometrySupport.pointsFromGeoJson(corridor.geometryJson());
        if (!configuredPolyline.isEmpty()) {
            CorridorGeometry geom = new CorridorGeometry(
                configuredPolyline,
                sampleAlongPolylineInterior(configuredPolyline, samplePointCount)
            );
            routeCache.put(corridor.name(), geom);
            return Mono.just(geom);
        }

        double[] bb = normalizeBbox(corridor.bbox());
        double minLat = bb[0], minLon = bb[1], maxLat = bb[2], maxLon = bb[3];

        double startLat = maxLat, startLon = minLon;
        double endLat = minLat, endLon = maxLon;

        String routePath = "/routing/1/calculateRoute/"
            + String.format(Locale.ROOT, "%.6f,%.6f:%.6f,%.6f", startLat, startLon, endLat, endLon)
            + "/json";

        return http.get()
            .uri(u -> u.path(routePath)
                .queryParam("traffic", "true")
                .queryParam("avoid", "unpavedRoads")
                .queryParam("key", key)
                .build())
            .retrieve()
            .bodyToMono(JsonNode.class)
            .map(json -> {
                List<double[]> polyline = new ArrayList<>();
                JsonNode points = json.path("routes").path(0).path("legs").path(0).path("points");
                if (points.isArray()) {
                    for (JsonNode point : points) {
                        polyline.add(new double[]{
                            point.path("latitude").asDouble(),
                            point.path("longitude").asDouble()
                        });
                    }
                }

                List<double[]> samplePoints = sampleAlongPolylineInterior(polyline, samplePointCount);
                if (samplePoints.isEmpty()) samplePoints = samplePoints(corridor.bbox(), samplePointCount);
                corridorGeometryStore.updateFromRouting(corridor.name(), polyline);
                CorridorGeometry geom = new CorridorGeometry(polyline, samplePoints);
                routeCache.put(corridor.name(), geom);
                return geom;
            })
            .timeout(Duration.ofSeconds(8))
            .retryWhen(
                Retry.backoff(2, Duration.ofMillis(300))
                    .filter(ex -> {
                        if (ex instanceof WebClientResponseException w) {
                            return w.getStatusCode().is5xxServerError();
                        }
                        return (ex instanceof TimeoutException) || (ex instanceof IOException);
                    })
            )
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.recordOptionalAuthorizationFailure(
                        "routing/1/calculateRoute",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString(),
                        "Optional corridor routing validation is unavailable because TomTom rejected the route endpoint; ingest remains enabled with configured corridor geometry."
                    );
                }
                log.debug("Routing polyline failed for {}: {} - falling back to bbox diagonal", corridor.name(), e.toString());
                return Mono.just(new CorridorGeometry(List.of(), samplePoints(corridor.bbox(), samplePointCount)));
            });
    }

    private static double[] normalizeBbox(String bbox) {
        String[] parts = bbox.split(",");
        if (parts.length != 4) throw new IllegalArgumentException("bbox must be 'lat1,lon1,lat2,lon2'");
        double a = Double.parseDouble(parts[0].trim());
        double b = Double.parseDouble(parts[1].trim());
        double c = Double.parseDouble(parts[2].trim());
        double d = Double.parseDouble(parts[3].trim());
        if (Math.abs(a) > 90 || Math.abs(b) <= 90) { double t = a; a = b; b = t; }
        if (Math.abs(c) > 90 || Math.abs(d) <= 90) { double t = c; c = d; d = t; }
        double minLat = Math.min(a, c), maxLat = Math.max(a, c);
        double minLon = Math.min(b, d), maxLon = Math.max(b, d);
        double eps = 1e-6;
        if (Math.abs(maxLat - minLat) < eps) { maxLat += eps; minLat -= eps; }
        if (Math.abs(maxLon - minLon) < eps) { maxLon += eps; minLon -= eps; }
        return new double[]{minLat, minLon, maxLat, maxLon};
    }

    private static List<double[]> sampleAlongPolylineInterior(List<double[]> polyline, int samplePointCount) {
        List<double[]> out = new ArrayList<>();
        if (polyline == null || polyline.size() < 2 || samplePointCount <= 0) return out;

        int vertices = polyline.size();
        double[] cumulativeDistance = new double[vertices];
        cumulativeDistance[0] = 0;
        for (int i = 1; i < vertices; i++) {
            cumulativeDistance[i] = cumulativeDistance[i - 1] + haversineDistance(
                polyline.get(i - 1)[0],
                polyline.get(i - 1)[1],
                polyline.get(i)[0],
                polyline.get(i)[1]
            );
        }
        double totalDistanceKm = cumulativeDistance[vertices - 1];
        if (totalDistanceKm == 0) return out;

        for (int i = 1; i <= samplePointCount; i++) {
            double targetDistance = i * (totalDistanceKm / (samplePointCount + 1));
            int segmentIndex = 0;
            while (segmentIndex < vertices - 1 && cumulativeDistance[segmentIndex + 1] < targetDistance) {
                segmentIndex++;
            }
            double segmentLength = cumulativeDistance[segmentIndex + 1] - cumulativeDistance[segmentIndex];
            double t = segmentLength == 0 ? 0 : (targetDistance - cumulativeDistance[segmentIndex]) / segmentLength;
            double lat = polyline.get(segmentIndex)[0] + t * (polyline.get(segmentIndex + 1)[0] - polyline.get(segmentIndex)[0]);
            double lon = polyline.get(segmentIndex)[1] + t * (polyline.get(segmentIndex + 1)[1] - polyline.get(segmentIndex)[1]);
            out.add(new double[]{lat, lon});
        }
        return out;
    }

    private static double haversineDistance(double lat1, double lon1, double lat2, double lon2) {
        double earthRadiusKm = 6371.0088;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
    }

    private static List<double[]> samplePoints(String bbox, int samplePointCount) {
        String[] parts = bbox.split(",");
        double lat1 = Double.parseDouble(parts[0].trim());
        double lon1 = Double.parseDouble(parts[1].trim());
        double lat2 = Double.parseDouble(parts[2].trim());
        double lon2 = Double.parseDouble(parts[3].trim());
        List<double[]> points = new ArrayList<>(samplePointCount);
        for (int i = 0; i < samplePointCount; i++) {
            double t = samplePointCount == 1 ? 0.5 : (double) i / (samplePointCount - 1);
            double lat = lat1 + t * (lat2 - lat1);
            double lon = lon1 + t * (lon2 - lon1);
            points.add(new double[]{lat, lon});
        }
        return points;
    }

    private static Double avg(List<Double> values) {
        if (values == null || values.isEmpty()) return null;
        double sum = 0.0;
        for (double value : values) sum += value;
        return sum / values.size();
    }
}
