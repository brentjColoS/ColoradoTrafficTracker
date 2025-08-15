package com.example.traffic_backend;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Flux;

import java.util.ArrayList;
import java.util.List;

@Component
public class TrafficPoller {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(TrafficPoller.class);

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
            try {
                pollCorridor(c).block();
            } catch (Exception e) {} // log in real app
        }
    }

    private Mono<Void> pollCorridor(TrafficProps.Corridor c) {
        String key = props.tomtomApiKey();
    
        // build the list of point calls
        List<double[]> points = samplePoints(c.bbox(), 5);
        List<Mono<JsonNode>> flowCalls = new ArrayList<>();
        for (double[] p : points) {
            flowCalls.add(
                http.get()
                    .uri(uri -> uri.path("/traffic/services/4/flowSegmentData/absolute/10/json")
                        .queryParam("point", p[0] + "," + p[1])  // lat,lon
                        .queryParam("key", key)
                        .build())
                    .retrieve()
                    .bodyToMono(JsonNode.class)
            );
        }
    
        // collect flow results into a List<JsonNode>
        Mono<List<JsonNode>> flowsMono = Flux.merge(flowCalls).collectList().onErrorReturn(List.of());
    
        // one incidents call for the bbox
        Mono<JsonNode> incidentsMono = http.get()
            .uri(uri -> uri.path("/traffic/services/5/incidentDetails")
                .queryParam("bbox", toIncidentsBbox(c.bbox()))
                .queryParam("timeValidityFilter", "present")
                .queryParam("key", key).build())
            .retrieve()
            .bodyToMono(JsonNode.class)
            .onErrorReturn(com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode());
    
        // zip the two Monos, aggregate, and save
        return Mono.zip(flowsMono, incidentsMono).map(tuple -> {
            List<JsonNode> flows = tuple.getT1();
            JsonNode inc = tuple.getT2();
    
            List<Double> currentSpeeds = new ArrayList<>();
            List<Double> freeflowSpeeds = new ArrayList<>();
            List<Double> confidences   = new ArrayList<>();
    
            for (JsonNode flowResp : flows) {
                JsonNode f = flowResp.path("flowSegmentData");
                if (f.isMissingNode()) continue;
                if (f.path("currentSpeed").isNumber())     currentSpeeds.add(f.get("currentSpeed").asDouble());
                if (f.path("freeFlowSpeed").isNumber())    freeflowSpeeds.add(f.get("freeFlowSpeed").asDouble());
                if (f.path("confidence").isNumber())       confidences.add(f.get("confidence").asDouble());
            }
    
            TrafficSample s = new TrafficSample();
            s.setCorridor(c.name());
            s.setAvgCurrentSpeed(avg(currentSpeeds));
            s.setAvgFreeflowSpeed(avg(freeflowSpeeds));
            s.setMinCurrentSpeed(min(currentSpeeds));
            s.setConfidence(avg(confidences));
            s.setIncidentsJson(inc.toString());

            log.info("Polled {} -> points={}, avgSpeed={}, minSpeed={}, incidents={}",
            c.name(), flows.size(), s.getAvgCurrentSpeed(), s.getMinCurrentSpeed(),
            (inc != null && inc.has("incidents")) ? inc.get("incidents").size() : 0);
            return repo.save(s);
        }).then();
    }
    

    private static Double avg(List<Double> vals) {
        if (vals.isEmpty()) return null;
        double sum = 0;
        for (double num : vals) sum += num;
        return sum / vals.size();
    }

    private static Double min(List<Double> vals) {
        if (vals.isEmpty()) return null;
        double min = Double.POSITIVE_INFINITY;
        for (double num : vals) if (num < min) min = num;
        return min;
    }

    // bbox format: [lat1, lon1], [lat2, lon2] NW to SE
    // Return N evenly spaced points along the diagonal

    /*
     * 
     * SAMPLE POINTS NEEDS TO BE REFACTORED TO SELECT EXACT POINTS ALONG CORRIDORS
     * 
     */

    private static List<double[]> samplePoints(String bbox, int n) {
        String[] parts = bbox.split(",");
        double lat1 = Double.parseDouble(parts[0]);
        double lon1 = Double.parseDouble(parts[1]);
        double lat2 = Double.parseDouble(parts[2]);
        double lon2 = Double.parseDouble(parts[3]);
        List<double[]> points = new ArrayList<>(n);
        
        for (int i = 0; i < n; i++) {
            double t = (n == 1) ? 0.5 : (double) i / (n - 1);
            double lat = lat1 + t * (lat2 - lat1);
            double lon = lon1 + t * (lon2 - lon1);
            points.add(new double[]{lat, lon});
        }
        return points;
    }

    // helper to convert lat lon to minlon minlat maxlon maxlat
    private static String toIncidentsBbox(String bbox) {
        String[] p = bbox.split(",");
        double lat1 = Double.parseDouble(p[0].trim()), lon1 = Double.parseDouble(p[1].trim());
        double lat2 = Double.parseDouble(p[2].trim()), lon2 = Double.parseDouble(p[3].trim());
        double minLon = Math.min(lon1, lon2), maxLon = Math.max(lon1, lon2);
        double minLat = Math.min(lat1, lat2), maxLat = Math.max(lat1, lat2);
        return minLon + "," + minLat + "," + maxLon + "," + maxLat;
    }
}
