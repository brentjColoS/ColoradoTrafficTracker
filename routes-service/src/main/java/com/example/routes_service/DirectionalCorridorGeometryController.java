package com.example.routes_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.core.io.ResourceLoader;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.NOT_FOUND;

@RestController
@RequestMapping("/routes/corridors")
public class DirectionalCorridorGeometryController {
    private static final MediaType GEO_JSON = MediaType.parseMediaType("application/geo+json");
    private static final CacheControl CACHE_CONTROL = CacheControl.maxAge(Duration.ofDays(1)).cachePublic();
    private static final Map<String, String> GEOMETRY_RESOURCES = Map.of(
        "I25", "classpath:routes/directional/v1/i25.geojson",
        "I70", "classpath:routes/directional/v1/i70.geojson"
    );

    private final ObjectMapper objectMapper;
    private final ResourceLoader resourceLoader;
    private final Map<String, JsonNode> geometryCache = new ConcurrentHashMap<>();

    public DirectionalCorridorGeometryController(ObjectMapper objectMapper, ResourceLoader resourceLoader) {
        this.objectMapper = objectMapper;
        this.resourceLoader = resourceLoader;
    }

    @GetMapping(value = "/{corridor}/directions", produces = "application/geo+json")
    public ResponseEntity<JsonNode> directions(@PathVariable String corridor) {
        String normalized = normalizeCorridor(corridor);
        String resource = GEOMETRY_RESOURCES.get(normalized);
        if (resource == null) {
            throw new ResponseStatusException(NOT_FOUND, "Directional corridor geometry is unavailable");
        }

        JsonNode geometry = geometryCache.computeIfAbsent(normalized, ignored -> readGeometry(resource));
        return ResponseEntity.ok()
            .contentType(GEO_JSON)
            .cacheControl(CACHE_CONTROL)
            .body(geometry);
    }

    private JsonNode readGeometry(String location) {
        try (var input = resourceLoader.getResource(location).getInputStream()) {
            return objectMapper.readTree(input);
        } catch (IOException ex) {
            throw new UncheckedIOException("Unable to read directional corridor geometry " + location, ex);
        }
    }

    private static String normalizeCorridor(String corridor) {
        return corridor == null
            ? ""
            : corridor.trim().toUpperCase(Locale.ROOT).replace("-", "");
    }
}
