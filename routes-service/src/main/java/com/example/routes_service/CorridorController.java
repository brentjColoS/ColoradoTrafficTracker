package com.example.routes_service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.util.StreamUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/routes")
public class CorridorController {

    private final RoutesProps routesProps;
    private final ResourceLoader resourceLoader;

    public CorridorController(RoutesProps routesProps, ResourceLoader resourceLoader) {
        this.routesProps = routesProps;
        this.resourceLoader = resourceLoader;
    }

    @GetMapping("/corridors")
    public List<RoutesProps.Corridor> corridors() {
        if (routesProps.corridors() == null) {
            return List.of();
        }
        return routesProps.corridors().stream()
            .map(this::withConfiguredGeometry)
            .toList();
    }

    private RoutesProps.Corridor withConfiguredGeometry(RoutesProps.Corridor corridor) {
        if (corridor.geometryJson() != null && !corridor.geometryJson().isBlank()) {
            return corridor;
        }
        if (corridor.geometryResource() == null || corridor.geometryResource().isBlank()) {
            return corridor;
        }

        String geometryJson = readGeometryResource(corridor.geometryResource());
        return new RoutesProps.Corridor(
            corridor.name(),
            corridor.displayName(),
            corridor.roadNumber(),
            corridor.primaryDirection(),
            corridor.secondaryDirection(),
            corridor.startMileMarker(),
            corridor.endMileMarker(),
            corridor.mileMarkerAnchors(),
            corridor.bbox(),
            geometryJson,
            corridor.geometryResource(),
            corridor.maxSnapDistanceMeters()
        );
    }

    private String readGeometryResource(String location) {
        String normalized = location.startsWith("classpath:")
            ? location
            : "classpath:" + location;
        Resource resource = resourceLoader.getResource(normalized);
        try (var input = resource.getInputStream()) {
            return StreamUtils.copyToString(input, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            throw new UncheckedIOException("Unable to read corridor geometry resource " + location, ex);
        }
    }
}
