package com.example.traffic_backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.io.IOException;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeoutException;

@Component
public class TrafficPoller {

    private static final Logger log = LoggerFactory.getLogger(TrafficPoller.class);

    private final WebClient http;
    private final TrafficProps props;
    private final TrafficSampleRepository repo;

    // corridor base = full route polyline + sampled points along that line
    private static record corridorGeometry(List<double[]> poly, List<double[]> samples) {}
    private final Map<String, corridorGeometry> routeCache = new ConcurrentHashMap<>();

    public TrafficPoller(WebClient http, TrafficProps props, TrafficSampleRepository repo) {
        this.http = http;
        this.props = props;
        this.repo = repo;
    }

    @Scheduled(initialDelay = 5000, fixedDelayString = "#{${traffic.pollSeconds} * 1000}")
    public void pollAll() {
        for (var c : props.corridors()) {
            pollCorridor(c)
                .doOnError(e -> log.error("Poll failed for {}: {}", c.name(), e.toString()))
                .onErrorResume(e -> Mono.empty())
                .block();
        }
    }

    private Mono<Void> pollCorridor(TrafficProps.Corridor c) {
        String key = props.tomtomApiKey();

        Mono<corridorGeometry> geomMono = geomForCorridor(c, key, 50);
        Mono<JsonNode> incidentsMono = incidents(c.bbox(), key);

        return geomMono.flatMap(geom -> {
            Mono<List<JsonNode>> flowsMono = flowsForPoints(geom.samples(), key);

            return Mono.zip(flowsMono, incidentsMono).map(tuple -> {
                List<JsonNode> flows = tuple.getT1();
                JsonNode inc = tuple.getT2();

                List<Double> currentSpeeds = new ArrayList<>();
                List<Double> freeflowSpeeds = new ArrayList<>();
                List<Double> confidences    = new ArrayList<>();

                for (JsonNode flowResp : flows) {
                    JsonNode flow = flowResp.path("flowSegmentData");
                    if (flow.isMissingNode()) continue;

                    // keep "freeway-grade" only
                    String frc = flow.path("frc").asText("");
                    if (!"FRC0".equals(frc) && !"FRC1".equals(frc)) continue;

                    if (flow.path("currentSpeed").isNumber()) currentSpeeds.add(flow.get("currentSpeed").asDouble());
                    if (flow.path("freeFlowSpeed").isNumber()) freeflowSpeeds.add(flow.get("freeFlowSpeed").asDouble());
                    if (flow.path("confidence").isNumber()) confidences.add(flow.get("confidence").asDouble());
                }

                TrafficSample s = new TrafficSample();
                s.setCorridor(c.name());
                s.setAvgCurrentSpeed(avg(currentSpeeds));
                s.setAvgFreeflowSpeed(avg(freeflowSpeeds));
                s.setMinCurrentSpeed(min(currentSpeeds));
                s.setConfidence(avg(confidences));

                // Filter incidents to the corridor by road number AND proximity to the route
                var chosenCorridor = corridorFilter(c.name());
                var outArray = JsonNodeFactory.instance.arrayNode();
                JsonNode incidentArray = inc.path("incidents");
                if (incidentArray.isArray()) {
                    for (JsonNode one : incidentArray) {
                        if (!incidentMatchesCorridor(one, chosenCorridor)) continue;
                        if (geom.poly().isEmpty()
                            || incidentWithinBuffer(one, geom.poly(), 300.0)) {    // 300 m buffer
                            outArray.add(one);
                        }
                    }
                }
                var outObj = JsonNodeFactory.instance.objectNode();
                outObj.set("incidents", outArray);
                s.setIncidentsJson(outObj.toString());

                log.info("Polled {} -> points={}, avgSpeed={}, minSpeed={}, incidents={}",
                    c.name(), flows.size(), s.getAvgCurrentSpeed(), s.getMinCurrentSpeed(), outArray.size());

                return repo.save(s);
            }).then();
        });
    }

    /* ~~~~~~~~~~ HTTP helpers ~~~~~~~~~~ */

    // Flow call with timeout; retry only timeouts/5xx; skip 4xx
    private Mono<JsonNode> flowCall(double lat, double lon, String key) {
        return http.get()
            .uri(u -> u.path("/traffic/services/4/flowSegmentData/absolute/10/json")
                .queryParam("point", lat + "," + lon) // Flow wants lat,lon
                .queryParam("unit", "mph")
                .queryParam("key", key).build())
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
                log.warn("Flow call failed for {},{}: {}", lat, lon, e.toString());
                return Mono.empty(); // skip this point
            });
    }

    // Sequential to avoid burst; switch to flatMap(..., 2) if you want some parallelism
    private Mono<List<JsonNode>> flowsForPoints(List<double[]> points, String key) {
        return Flux.fromIterable(points)
                   .concatMap(p -> flowCall(p[0], p[1], key))
                   .collectList();
    }

    // Incidents v5: encode "fields" to avoid { } template expansion; bbox must be lon,lat order
    private Mono<JsonNode> incidents(String bbox, String key) {
        String fields = "{incidents{properties{roadNumbers,iconCategory,delay},geometry{type,coordinates}}}";
        String encFields = java.net.URLEncoder.encode(fields, java.nio.charset.StandardCharsets.UTF_8);
        String encBbox   = java.net.URLEncoder.encode(toIncidentsBbox(bbox), java.nio.charset.StandardCharsets.UTF_8);
        String encKey    = java.net.URLEncoder.encode(key, java.nio.charset.StandardCharsets.UTF_8);

        String uri = "/traffic/services/5/incidentDetails"
                   + "?bbox=" + encBbox
                   + "&timeValidityFilter=present"
                   + "&fields=" + encFields
                   + "&key=" + encKey;

        return http.get()
            .uri(uri)
            .retrieve()
            .bodyToMono(JsonNode.class)
            .timeout(Duration.ofSeconds(8))
            .retryWhen(Retry.backoff(2, Duration.ofMillis(300)))
            .onErrorReturn(JsonNodeFactory.instance.objectNode());
    }

    /* ---------- Routing-based sampling & geometry ---------- */

    // Get/calc route geometry + N sample points; cache by corridor name
    private Mono<corridorGeometry> geomForCorridor(TrafficProps.Corridor c, String key, int n) {
        corridorGeometry cached = routeCache.get(c.name());
        if (cached != null) return Mono.just(cached);

        double[] bb = normalizeBbox(c.bbox());
        double minLat = bb[0], minLon = bb[1], maxLat = bb[2], maxLon = bb[3];

        // Rough endpoints: NW → SE across bbox
        double startLat = maxLat, startLon = minLon;
        double endLat   = minLat, endLon   = maxLon;

        String routePath = "/routing/1/calculateRoute/"
            + String.format(java.util.Locale.ROOT, "%.6f,%.6f:%.6f,%.6f", startLat, startLon, endLat, endLon)
            + "/json";

        return http.get()
            .uri(u -> u.path(routePath)
                .queryParam("traffic", "true")
                .queryParam("avoid", "unpavedRoads")
                .queryParam("key", key).build())
            .retrieve()
            .bodyToMono(JsonNode.class)
            .map(json -> {
                List<double[]> poly = new ArrayList<>();
                JsonNode pts = json.path("routes").path(0).path("legs").path(0).path("points");
                if (pts.isArray()) {
                    for (JsonNode p : pts) {
                        poly.add(new double[]{ p.path("latitude").asDouble(),
                                               p.path("longitude").asDouble() });
                    }
                }
                List<double[]> samples = sampleAlongPolylineInterior(poly, n);
                if (samples.isEmpty()) samples = samplePoints(c.bbox(), n); // fallback
                corridorGeometry geom = new corridorGeometry(poly, samples);
                routeCache.put(c.name(), geom);
                return geom;
            })
            .timeout(Duration.ofSeconds(8))
            .retryWhen(Retry.backoff(2, Duration.ofMillis(300)))
            .onErrorResume(e -> {
                log.warn("Routing polyline failed for {}: {} — falling back to bbox diagonal", c.name(), e.toString());
                return Mono.just(new corridorGeometry(List.of(), samplePoints(c.bbox(), n)));
            });
    }

    // Normalize "lat1,lon1,lat2,lon2" -> [minLat,minLon,maxLat,maxLon]
    private static double[] normalizeBbox(String bbox) {
        String[] p = bbox.split(",");
        if (p.length != 4) throw new IllegalArgumentException("bbox must be 'lat1,lon1,lat2,lon2'");
        double a = Double.parseDouble(p[0].trim());
        double b = Double.parseDouble(p[1].trim());
        double c = Double.parseDouble(p[2].trim());
        double d = Double.parseDouble(p[3].trim());
        if (Math.abs(a) > 90 || Math.abs(b) <= 90) { double t=a; a=b; b=t; }
        if (Math.abs(c) > 90 || Math.abs(d) <= 90) { double t=c; c=d; d=t; }
        double minLat = Math.min(a, c), maxLat = Math.max(a, c);
        double minLon = Math.min(b, d), maxLon = Math.max(b, d);
        double eps = 1e-6;
        if (Math.abs(maxLat - minLat) < eps) { maxLat += eps; minLat -= eps; }
        if (Math.abs(maxLon - minLon) < eps) { maxLon += eps; minLon -= eps; }
        return new double[]{minLat, minLon, maxLat, maxLon};
    }

    // Evenly sample N interior points along the polyline (exclude endpoints)
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

    // Haversine distance use km to match mapping standards/API standards
    private static double haversineDistance(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371.0088;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat/2)*Math.sin(dLat/2)
                 + Math.cos(Math.toRadians(lat1))*Math.cos(Math.toRadians(lat2))
                 * Math.sin(dLon/2)*Math.sin(dLon/2);
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    // Fallback diagonal sampling (Flow wants lat,lon)
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

    // Convert "lat1,lon1,lat2,lon2" -> "minLon,minLat,maxLon,maxLat" for Incidents API
    private static String toIncidentsBbox(String bbox) {
        String[] p = bbox.split(",");
        double lat1 = Double.parseDouble(p[0].trim()), lon1 = Double.parseDouble(p[1].trim());
        double lat2 = Double.parseDouble(p[2].trim()), lon2 = Double.parseDouble(p[3].trim());
        double minLon = Math.min(lon1, lon2), maxLon = Math.max(lon1, lon2);
        double minLat = Math.min(lat1, lat2), maxLat = Math.max(lat1, lat2);
        return minLon + "," + minLat + "," + maxLon + "," + maxLat;
    }

    /* ---------- incident filtering helpers ---------- */

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

    // --- proximity to route polyline (meters), lightweight planar approximation ---

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

    private static double minDistanceMetersToPolyline(double lat, double lon, List<double[]> poly) {
        if (poly.size() < 2) return Double.POSITIVE_INFINITY;
        double min = Double.POSITIVE_INFINITY;
        for (int i = 0; i < poly.size() - 1; i++) {
            double[] A = poly.get(i), B = poly.get(i + 1);
            min = Math.min(min, distancePointToSegmentMeters(lat, lon, A[0], A[1], B[0], B[1]));
        }
        return min;
    }

    private static double distancePointToSegmentMeters(double plat, double plon, double alat, double alon, double blat, double blon) {
        double lat0 = Math.toRadians(plat);
        // 1 degree latitude generally constant 111,320 meters
        double mLat = 111320.0;
        // 1 degree longitude shrinks by cos(lat)
        double mLon = 111320.0 * Math.cos(lat0);

        // Convert to 2D plane relative to P(0,0)
        double ax = (alon - plon) * mLon, ay = (alat - plat) * mLat;
        double bx = (blon - plon) * mLon, by = (blat - plat) * mLat; 

        // Define segment vector and it's square
        double vectorx = bx - ax, vectory = by - ay;
        double len2 = vectorx * vectorx + vectory * vectory;
        // Check same point edge case
        if (len2 == 0) return Math.hypot(ax, ay);
        // Unclamped projection parameter t then becomes the closest point to the infinite line through AB
        double t = -(ax * vectorx + ay * vectory) / len2;
        // Clamp parameter to [0,1] to get closest point inside of A(0)B(1)
        t = Math.max(0, Math.min(1, t));
        // Compute closest point and euclidean distance
        double px = ax + t * vectorx, py = ay + t * vectory;
        return Math.hypot(px, py);
    }

    /* ---------- basic reducers ---------- */

    private static Double avg(List<Double> vals) {
        if (vals.isEmpty()) return null;
        double sum = 0;
        for (double val : vals) sum += val;
        return sum / vals.size();
    }

    private static Double min(List<Double> vals) {
        if (vals.isEmpty()) return null;
        double minimum = Double.POSITIVE_INFINITY;
        for (double val : vals) if (val < minimum) minimum = val;
        return minimum;
    }
}
