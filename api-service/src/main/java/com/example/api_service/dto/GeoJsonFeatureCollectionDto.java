package com.example.api_service.dto;

import java.util.List;

public record GeoJsonFeatureCollectionDto(
    String type,
    List<GeoJsonFeatureDto> features
) {
    public GeoJsonFeatureCollectionDto(List<GeoJsonFeatureDto> features) {
        this("FeatureCollection", features);
    }
}
