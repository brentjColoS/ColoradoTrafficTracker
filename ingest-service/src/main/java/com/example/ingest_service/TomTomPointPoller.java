package com.example.ingest_service;

import static com.example.ingest_service.CorridorGeometrySupport.minDistanceMetersToPolyline;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

final class TomTomPointPoller {
    private static final Logger log = LoggerFactory.getLogger(TomTomPointPoller.class);
    private final WebClient http;
    private final TrafficPullProps pullProps;
    private final TrafficSampleWriter sampleWriter;
    private final CorridorGeometryResolver geometryResolver;
    private final TomTomRequestGovernor requestGovernor;
    private final TrafficProviderGuardService providerGuardService;
    private record CorridorGeometry(List<double[]> poly, List<double[]> samples) {}
    private final Map<String, CorridorGeometry> routeCache = new ConcurrentHashMap<>();

    TomTomPointPoller(WebClient http, TrafficPullProps pullProps, TrafficSampleWriter sampleWriter,
        CorridorGeometryStore geometryStore, TrafficProviderGuardService guard, TomTomRequestGovernor governor) {
        this.http = http;
        this.pullProps = pullProps;
        this.sampleWriter = sampleWriter;
        this.geometryResolver = new CorridorGeometryResolver(http, geometryStore, guard, governor);
        this.providerGuardService = guard;
        this.requestGovernor = governor;
    }

    Mono<ProviderCycleSnapshot> poll(TrafficProps.Corridor corridor) {
        Mono<CorridorGeometry> geomMono = geomForCorridor(corridor, 5);
        Mono<JsonNode> incidentsMono = incidents(corridor.bbox());

        return geomMono.flatMap(geom -> {
            Mono<List<JsonNode>> flowsMono = flowsForPoints(geom.samples());

            return Mono.zip(flowsMono, incidentsMono).map(tuple -> {
                List<JsonNode> flows = tuple.getT1();
                JsonNode inc = tuple.getT2();

                List<Double> currentSpeeds = new ArrayList<>();
                List<Double> freeflowSpeeds = new ArrayList<>();
                List<Double> confidences    = new ArrayList<>();

                for (JsonNode flowResp : flows) {
                    JsonNode flow = flowResp.path("flowSegmentData");
                    if (flow.isMissingNode()) continue;

                    // keep "freeway-grade" only as FRC0/FRC1
                    String frc = flow.path("frc").asText("");
                    if (!"FRC0".equals(frc) && !"FRC1".equals(frc)) continue;
                    if (flow.path("currentSpeed").isNumber()) currentSpeeds.add(flow.get("currentSpeed").asDouble());
                    if (flow.path("freeFlowSpeed").isNumber()) freeflowSpeeds.add(flow.get("freeFlowSpeed").asDouble());
                    if (flow.path("confidence").isNumber()) confidences.add(flow.get("confidence").asDouble());
                }

                TrafficStats stats = TrafficStats.fromSpeeds(currentSpeeds);
                TrafficSample s = new TrafficSample();
                s.setCorridor(corridor.name());
                s.setSourceMode("point");
                s.setAvgCurrentSpeed(stats.avgSpeed());
                s.setAvgFreeflowSpeed(TrafficStats.average(freeflowSpeeds));
                s.setMinCurrentSpeed(stats.minSpeed());
                s.setConfidence(TrafficStats.average(confidences));
                s.setSpeedSampleCount(stats.sampleCount());
                s.setSpeedStddev(stats.stddev());
                s.setP10Speed(stats.p10Speed());
                s.setP50Speed(stats.p50Speed());
                s.setP90Speed(stats.p90Speed());

                // Filter incidents to the corridor by road number AND proximity to the route
                Set<String> chosenCorridor = corridorFilter(corridor.name());
                ArrayNode outArray = JsonNodeFactory.instance.arrayNode();
                JsonNode incidentArray = inc.path("incidents");
                if (incidentArray.isArray()) {
                    for (JsonNode one : incidentArray) {
                        if (!incidentMatchesCorridor(one, chosenCorridor)) continue;
                        if (geom.poly().isEmpty()
                            || incidentWithinBuffer(one, geom.poly(), 300.0)) {    // 300 m buffer
                            if (one instanceof ObjectNode incidentNode) {
                                outArray.add(IncidentLocationEnricher.enrichIncident(incidentNode, corridor, geom.poly()));
                            } else {
                                outArray.add(one);
                            }
                        }
                    }
                }
                s.setIncidentCount(outArray.size());
                s.setFlowProvider("tomtom");
                s.setFlowProduct("traffic-flow-segment-data");
                s.setFlowRequestedCadenceSeconds(pullProps.flow().pollSeconds());
                s.setIncidentProvider("tomtom");
                s.setIncidentProduct("traffic-incident-details");
                s.setIncidentFetchedAt(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC));
                s.setIncidentRequestedCadenceSeconds(pullProps.flow().pollSeconds());

                sampleWriter.saveSample(s);
                return new ProviderCycleSnapshot(corridor.name(), currentSpeeds, TrafficSampleSignature.from(s));
            });
        });
    }

    private Mono<JsonNode> flowCall(double lat, double lon) {
        return requestGovernor.flowSegment(account ->
            http.get()
                .uri(u -> u.path("/traffic/services/4/flowSegmentData/absolute/12/json")
                    .queryParam("point", lat + "," + lon) // Flow wants lat,lon
                    .queryParam("unit", "mph")
                    .queryParam("key", account.apiKey()).build())
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .header("Tracking-ID", java.util.UUID.randomUUID().toString())
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(6))
            )
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.tripAuthorizationFailure(
                        "traffic/services/4/flowSegmentData",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString()
                    );
                } else {
                    providerGuardService.recordRecoverableProviderFailure(
                        "traffic/services/4/flowSegmentData",
                        e
                    );
                }
                log.debug("Flow call failed for {},{}: {}", lat, lon, e.toString());
                return Mono.empty(); // skip this point
            });
    }

    private Mono<List<JsonNode>> flowsForPoints(List<double[]> points) {
        return Flux.fromIterable(points)
                   .concatMap(p -> flowCall(p[0], p[1]))
                   .collectList();
    }

    private Mono<JsonNode> incidents(String bbox) {
        String fields = "{incidents{properties{roadNumbers,iconCategory,delay,events{description,code,iconCategory}},geometry{type,coordinates}}}";
        String encFields = java.net.URLEncoder.encode(fields, java.nio.charset.StandardCharsets.UTF_8);
        String encBbox   = java.net.URLEncoder.encode(toIncidentsBbox(bbox), java.nio.charset.StandardCharsets.UTF_8);

        return requestGovernor.incidentDetails(account -> {
            String encKey = java.net.URLEncoder.encode(
                account.apiKey(),
                java.nio.charset.StandardCharsets.UTF_8
            );
            String uri = "/traffic/services/5/incidentDetails"
                + "?bbox=" + encBbox
                + "&timeValidityFilter=present"
                + "&fields=" + encFields
                + "&key=" + encKey;
            return http.get()
                .uri(uri)
                .retrieve()
                .bodyToMono(JsonNode.class)
                .timeout(Duration.ofSeconds(8));
        })
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.tripAuthorizationFailure(
                        "traffic/services/5/incidentDetails",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString()
                    );
                } else {
                    providerGuardService.recordRecoverableProviderFailure(
                        "traffic/services/5/incidentDetails",
                        e
                    );
                }
                return Mono.just(JsonNodeFactory.instance.objectNode());
            });
    }

    private Mono<CorridorGeometry> geomForCorridor(TrafficProps.Corridor corridor, int n) {
        CorridorGeometry cached = routeCache.get(corridor.name());
        if (cached != null) return Mono.just(cached);

        return geometryResolver.resolve(corridor)
            .map(resolved -> {
                List<double[]> samples = sampleAlongPolylineInterior(resolved.polyline(), n);
                if (samples.isEmpty() && resolved.fromRouting()) samples = samplePoints(corridor.bbox(), n);
                CorridorGeometry geometry = new CorridorGeometry(resolved.polyline(), samples);
                routeCache.put(corridor.name(), geometry);
                return geometry;
            })
            .switchIfEmpty(Mono.fromSupplier(() ->
                new CorridorGeometry(List.of(), samplePoints(corridor.bbox(), n))));
    }

    private static List<double[]> sampleAlongPolylineInterior(List<double[]> poly, int numPointsRequested) {
        List<double[]> out = new ArrayList<>();
        if (poly == null || poly.size() < 2 || numPointsRequested <= 0) return out;

        int vertices = poly.size();
        // Collect cumulative distances in an array
        double[] cumDist = new double[vertices];
        cumDist[0] = 0;
        for (int i = 1; i < vertices; i++) {
            cumDist[i] = cumDist[i - 1] + haversineDistance(poly.get(i - 1)[0], poly.get(i - 1)[1], poly.get(i)[0], poly.get(i)[1]);
        }
        double total = cumDist[vertices-1];
        if (total == 0) return out;

        // place samples at (i / (n + 1)) of the total length, i = 1...n (excludes 0 and 1)
        for (int i = 1; i <= numPointsRequested; i++) {
            double target = i * (total / (numPointsRequested + 1));
            int j = 0;
            while (j < vertices - 1 && cumDist[j + 1] < target) j++;
            double segment = cumDist[j + 1] - cumDist[j];
            double t = segment == 0 ? 0 : (target - cumDist[j]) / segment;
            double lat = poly.get(j)[0] + t * (poly.get(j + 1)[0] - poly.get(j)[0]);
            double lon = poly.get(j)[1] + t * (poly.get(j + 1)[1] - poly.get(j)[1]);
            out.add(new double[]{lat, lon});
        }
        return out;
    }

    private static double haversineDistance(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371.0088;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat/2)*Math.sin(dLat/2)
                 + Math.cos(Math.toRadians(lat1))*Math.cos(Math.toRadians(lat2))
                 * Math.sin(dLon/2)*Math.sin(dLon/2);
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    private static List<double[]> samplePoints(String bbox, int n) {
        String[] parts = bbox.split(",");
        double lat1 = Double.parseDouble(parts[0].trim());
        double lon1 = Double.parseDouble(parts[1].trim());
        double lat2 = Double.parseDouble(parts[2].trim());
        double lon2 = Double.parseDouble(parts[3].trim());
        List<double[]> points = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            double t = (n == 1) ? 0.5 : (double) i / (n - 1);
            double lat = lat1 + t * (lat2 - lat1);
            double lon = lon1 + t * (lon2 - lon1);
            points.add(new double[]{lat, lon});
        }
        return points;
    }

    private static String toIncidentsBbox(String bbox) {
        String[] p = bbox.split(",");
        double lat1 = Double.parseDouble(p[0].trim()), lon1 = Double.parseDouble(p[1].trim());
        double lat2 = Double.parseDouble(p[2].trim()), lon2 = Double.parseDouble(p[3].trim());
        double minLon = Math.min(lon1, lon2), maxLon = Math.max(lon1, lon2);
        double minLat = Math.min(lat1, lat2), maxLat = Math.max(lat1, lat2);
        return minLon + "," + minLat + "," + maxLon + "," + maxLat;
    }

    private static String normalizeRoad(String s) {
        return s.replaceAll("[^A-Za-z0-9]", "").toUpperCase();
    }

    private static Set<String> corridorFilter(String corridorName) {
        String c = normalizeRoad(corridorName);
        if (c.equals("I25")) return Set.of("I25");
        if (c.equals("I70")) return Set.of("I70");
        return Set.of(c);
    }

    private static boolean incidentMatchesCorridor(JsonNode incident, Set<String> chosenCorridor) {
        JsonNode arr = incident.path("properties").path("roadNumbers");
        if (!arr.isArray()) return false;
        for (JsonNode node : arr) {
            if (chosenCorridor.contains(normalizeRoad(node.asText()))) return true;
        }
        return false;
    }

    private static boolean incidentWithinBuffer(JsonNode incident, List<double[]> poly, double bufferMeters) {
        JsonNode geom = incident.path("geometry");
        String type = geom.path("type").asText("");
        JsonNode coords = geom.path("coordinates");

        if ("Point".equals(type) && coords.isArray() && coords.size() >= 2) {
            double lon = coords.get(0).asDouble();
            double lat = coords.get(1).asDouble();
            return minDistanceMetersToPolyline(lat, lon, poly) <= bufferMeters;
        }
        if ("LineString".equals(type) && coords.isArray()) {
            for (JsonNode p : coords) {
                if (p.isArray() && p.size() >= 2) {
                    double lon = p.get(0).asDouble();
                    double lat = p.get(1).asDouble();
                    if (minDistanceMetersToPolyline(lat, lon, poly) <= bufferMeters) return true;
                }
            }
        }
        if ("MultiLineString".equals(type) && coords.isArray()) {
            for (JsonNode line : coords) {
                if (!line.isArray()) continue;
                for (JsonNode p : line) {
                    if (p.isArray() && p.size() >= 2) {
                        double lon = p.get(0).asDouble();
                        double lat = p.get(1).asDouble();
                        if (minDistanceMetersToPolyline(lat, lon, poly) <= bufferMeters) return true;
                    }
                }
            }
        }
        return false;
    }
}
