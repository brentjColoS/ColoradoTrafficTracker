package com.example.api_service;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.Locale;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/map", "/dashboard-api/traffic/map"})
class DirectionalCorridorGeometryController {
    private static final MediaType GEO_JSON = MediaType.parseMediaType("application/geo+json");
    private static final CacheControl CACHE_CONTROL = CacheControl.maxAge(Duration.ofDays(1)).cachePublic();

    private final DirectionalCorridorGeometryClient geometryClient;

    DirectionalCorridorGeometryController(DirectionalCorridorGeometryClient geometryClient) {
        this.geometryClient = geometryClient;
    }

    @GetMapping(value = "/corridors/directions", produces = "application/geo+json")
    @Cacheable(
        cacheNames = "apiCorridors",
        key = "'directional-corridor|' + #corridor",
        unless = "#result == null || #result.statusCodeValue != 200"
    )
    ResponseEntity<JsonNode> directions(@RequestParam("corridor") String corridor) {
        String normalized = normalizeCorridor(corridor);
        if (!"I25".equals(normalized) && !"I70".equals(normalized)) {
            return ResponseEntity.badRequest().build();
        }
        return geometryClient.fetch(normalized)
            .map(geometry -> ResponseEntity.ok()
                .contentType(GEO_JSON)
                .cacheControl(CACHE_CONTROL)
                .body(geometry))
            .orElseGet(() -> ResponseEntity.status(503).build());
    }

    private static String normalizeCorridor(String corridor) {
        return corridor == null
            ? ""
            : corridor.trim().toUpperCase(Locale.ROOT).replace("-", "");
    }
}
