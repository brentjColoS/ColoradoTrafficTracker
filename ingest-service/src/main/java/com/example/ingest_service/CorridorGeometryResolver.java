package com.example.ingest_service;

import static com.example.ingest_service.CorridorGeometrySupport.normalizeBbox;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

final class CorridorGeometryResolver {
    private static final Logger log = LoggerFactory.getLogger(CorridorGeometryResolver.class);
    private final WebClient http;
    private final CorridorGeometryStore corridorGeometryStore;
    private final TrafficProviderGuardService providerGuardService;
    private final TomTomRequestGovernor requestGovernor;
    private final Map<String, CorridorGeometry> routeCache = new ConcurrentHashMap<>();

    CorridorGeometryResolver(WebClient http, CorridorGeometryStore corridorGeometryStore,
        TrafficProviderGuardService providerGuardService, TomTomRequestGovernor requestGovernor) {
        this.http = http;
        this.corridorGeometryStore = corridorGeometryStore;
        this.providerGuardService = providerGuardService;
        this.requestGovernor = requestGovernor;
    }

    Mono<CorridorGeometry> resolve(TrafficProps.Corridor corridor) {
        CorridorGeometry cached = routeCache.get(corridor.name());
        if (cached != null) return Mono.just(cached);

        List<double[]> configuredPolyline = CorridorGeometrySupport.pointsFromGeoJson(corridor.geometryJson());
        if (!configuredPolyline.isEmpty()) {
            CorridorGeometry geom = new CorridorGeometry(configuredPolyline);
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

        return requestGovernor.routing(account ->
            http.get()
                .uri(u -> u.path(routePath)
                    .queryParam("traffic", "true")
                    .queryParam("avoid", "unpavedRoads")
                    .queryParam("key", account.apiKey())
                    .build())
                .retrieve()
                .bodyToMono(JsonNode.class)
            )
            .map(json -> {
                List<double[]> polyline = new ArrayList<>();
                var points = json.path("routes").path(0).path("legs").path(0).path("points");
                if (points.isArray()) {
                    points.forEach(p -> polyline.add(new double[]{
                        p.path("latitude").asDouble(),
                        p.path("longitude").asDouble()
                    }));
                }
                corridorGeometryStore.updateFromRouting(corridor.name(), polyline);
                CorridorGeometry geom = new CorridorGeometry(polyline, true);
                routeCache.put(corridor.name(), geom);
                return geom;
            })
            .timeout(Duration.ofSeconds(8))
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w && providerGuardService.isAuthorizationFailure(w)) {
                    providerGuardService.tripAuthorizationFailure(
                        "routing/1/calculateRoute",
                        w.getStatusCode().value(),
                        w.getResponseBodyAsString()
                    );
                } else {
                    providerGuardService.recordRecoverableProviderFailure(
                        "routing/1/calculateRoute",
                        e
                    );
                }
                log.debug("Routing polyline failed for {}: {}", corridor.name(), e.toString());
                return Mono.empty();
            });
    }

}
