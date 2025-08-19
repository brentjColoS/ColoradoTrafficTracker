package com.example.traffic_backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@Component
public class TrafficPoller {

    private static final Logger log = LoggerFactory.getLogger(TrafficPoller.class);

    private final WebClient http;
    private final TrafficProps props;
    private final TrafficSampleRepository repo;

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

        // Sample a few points diagonally across the box
        List<double[]> points = samplePoints(c.bbox(), 5);

        // Use concatMap flow calls with timeout + retry for consecutive run
        Mono<List<JsonNode>> flowsMono = flowsForPoints(points, key);

        // Incidents with lon,lat bbox order + timeout + retry; never fail the batch
        Mono<JsonNode> incidentsMono = incidents(c.bbox(), key);

        // Zip results, combine, persist
        return Mono.zip(flowsMono, incidentsMono).map(tuple -> {
            List<JsonNode> flows = tuple.getT1();
            JsonNode inc = tuple.getT2();

            List<Double> currentSpeeds = new ArrayList<>();
            List<Double> freeflowSpeeds = new ArrayList<>();
            List<Double> confidences = new ArrayList<>();

            for (JsonNode flowResp : flows) {
                JsonNode f = flowResp.path("flowSegmentData");
                if (f.isMissingNode()) continue;
                String frc = f.path("frc").asText("");
                if("FRC0".equals(frc)) continue;
                if (f.path("currentSpeed").isNumber()) currentSpeeds.add(f.get("currentSpeed").asDouble());
                if (f.path("freeFlowSpeed").isNumber()) freeflowSpeeds.add(f.get("freeFlowSpeed").asDouble());
                if (f.path("confidence").isNumber()) confidences.add(f.get("confidence").asDouble());
            }

            TrafficSample s = new TrafficSample();
            s.setCorridor(c.name());
            s.setAvgCurrentSpeed(avg(currentSpeeds));
            s.setAvgFreeflowSpeed(avg(freeflowSpeeds));
            s.setMinCurrentSpeed(min(currentSpeeds));
            s.setConfidence(avg(confidences));

            var wanted = corridorFilter(c.name());
            var factory = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance;

            com.fasterxml.jackson.databind.node.ArrayNode filtered = factory.arrayNode();
            JsonNode incArr = inc.path("incidents");
            if (incArr.isArray()) {
                for (JsonNode one : incArr) {
                    if (incidentMatchesCorridor(one, wanted)) filtered.add(one);
                }
            }
            com.fasterxml.jackson.databind.node.ObjectNode out = factory.objectNode();
            out.set("incidents", filtered);
            s.setIncidentsJson(out.toString()); 

            log.info("Polled {} -> points={}, avgSpeed={}, minSpeed={}, incidents={}",
                c.name(), flows.size(), s.getAvgCurrentSpeed(), s.getMinCurrentSpeed(),
                (inc != null && inc.has("incidents")) ? inc.get("incidents").size() : 0);

            return repo.save(s);
        }).then();
    }

    /* ~~~~~~~~~~ HTTP helpers ~~~~~~~~~~ */

    // Single Flow call with safeties for timeout & retry | errors are logged and skipped
    private Mono<JsonNode> flowCall(double lat, double lon, String key) {
        return http.get()
            .uri(u -> u.path("/traffic/services/4/flowSegmentData/absolute/10/json")
                .queryParam("point", lat + "," + lon)  // lat,lon
                .queryParam("key", key).build())
            .retrieve()
            .bodyToMono(JsonNode.class)
            .timeout(Duration.ofSeconds(6))
            .retryWhen(Retry.backoff(2, Duration.ofMillis(200))
                            .filter(ex -> !(ex instanceof IllegalArgumentException)))
            .onErrorResume(e -> {
                log.warn("Flow call failed for {},{}: {}", lat, lon, e.toString());
                return Mono.empty();
            });
    }

    // Sequential (concatMap) to avoid bursty fan-out; switch to flatMap(..., concurrency) if desired
    private Mono<List<JsonNode>> flowsForPoints(List<double[]> points, String key) {
        return Flux.fromIterable(points)
                   .concatMap(p -> flowCall(p[0], p[1], key))
                   .collectList();
        // concatMap operates on a sequential order (think TCP) but flatMap can operate with more threads in paralell:
        // return Flux.fromIterable(points).flatMap(p -> flowCall(p[0], p[1], key), 2).collectList();
    }

    // Incidents v5 API expects bbox in (min,max lon,lat order)
    private Mono<JsonNode> incidents(String bbox, String key) {
        return http.get()
            .uri(u -> u.path("/traffic/services/5/incidentDetails")
                .queryParam("bbox", toIncidentsBbox(bbox))
                .queryParam("timeValidityFilter", "present")
                .queryParam("fields", "{incidents{properties{roadNumbers,iconCategory,delay},geometry{type,coordinate}}}")
                .queryParam("key", key).build())
            .retrieve()
            .bodyToMono(JsonNode.class)
            .timeout(Duration.ofSeconds(8))
            .retryWhen(Retry.backoff(2, Duration.ofMillis(300)))
            .onErrorReturn(JsonNodeFactory.instance.objectNode());
    }

    /* ---------- math | bbox | corridor filter helpers ---------- */

    private static Double avg(List<Double> vals) {
        if (vals.isEmpty()) return null;
        double sum = 0;
        for (double v : vals) sum += v;
        return sum / vals.size();
    }

    private static Double min(List<Double> vals) {
        if (vals.isEmpty()) return null;
        double m = Double.POSITIVE_INFINITY;
        for (double v : vals) if (v < m) m = v;
        return m;
    }

    // bbox format in YAML: "lat1,lon1,lat2,lon2" (NW to SE approx).
    // Return N evenly spaced points along the diagonal (quick heuristic).
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

    private static String normalizeRoad(String s) {
        return s.replaceAll("[^A-Za-z0-9]", "").toUpperCase();
    }

    private static java.util.Set<String> corridorFilter(String corridorName) {
        String c = normalizeRoad(corridorName);
        if (c.equals("I25")) return java.util.Set.of("I25");
        if (c.equals("I70")) return java.util.Set.of("I70");

        return java.util.Set.of(c);
    }

    private static boolean incidentMatchesCorridor(JsonNode incident, java.util.Set<String> wanted) {
        JsonNode arr = incident.path("properties").path("roadNumbers");
        if (!arr.isArray()) return false;
        for (JsonNode node : arr) {
            if (wanted.contains(normalizeRoad(node.asText()))) return true;
        }
        return false;
    }
}
