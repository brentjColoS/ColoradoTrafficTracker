package com.example.api_service.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

public record GeoJsonFeatureDto(
    String type,
    String id,
    JsonNode geometry,
    Map<String, Object> properties
) {
    public GeoJsonFeatureDto(String id, JsonNode geometry, Map<String, Object> properties) {
        this("Feature", id, geometry, properties);
    }
}
