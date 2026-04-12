package com.example.ingest_service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CorridorGeometryStore {
    private final CorridorRefRepository corridorRefRepository;

    public CorridorGeometryStore(CorridorRefRepository corridorRefRepository) {
        this.corridorRefRepository = corridorRefRepository;
    }

    @Transactional
    public void updateFromRouting(String corridorCode, List<double[]> polyline) {
        if (corridorCode == null || corridorCode.isBlank() || polyline == null || polyline.size() < 2) return;

        corridorRefRepository.findById(corridorCode).ifPresent(ref -> {
            String geometryJson = CorridorGeometrySupport.toGeoJsonLineString(polyline);
            if (geometryJson == null || geometryJson.equals(ref.getGeometryJson())) return;

            OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
            ref.setGeometryJson(geometryJson);
            ref.setGeometrySource("routing");
            ref.setGeometryUpdatedAt(now);
            ref.setUpdatedAt(now);
            corridorRefRepository.save(ref);
        });
    }
}
