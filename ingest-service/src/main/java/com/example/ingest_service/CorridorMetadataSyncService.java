package com.example.ingest_service;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CorridorMetadataSyncService {
    private final CorridorRefRepository corridorRefRepository;

    public CorridorMetadataSyncService(CorridorRefRepository corridorRefRepository) {
        this.corridorRefRepository = corridorRefRepository;
    }

    @Transactional
    public void sync(List<TrafficProps.Corridor> corridors) {
        if (corridors == null || corridors.isEmpty()) return;

        Map<String, CorridorRef> existing = new HashMap<>();
        corridorRefRepository.findAllById(corridors.stream().map(TrafficProps.Corridor::name).toList())
            .forEach(ref -> existing.put(ref.getCode(), ref));

        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        for (TrafficProps.Corridor corridor : corridors) {
            CorridorRef ref = existing.getOrDefault(corridor.name(), new CorridorRef());
            if (ref.getCode() == null) {
                ref.setCode(corridor.name());
                ref.setCreatedAt(now);
            }

            ref.setDisplayName(nonBlank(corridor.displayName(), corridor.name()));
            ref.setRoadNumber(nonBlank(corridor.roadNumber(), corridor.name()));
            ref.setPrimaryDirection(normalizeDirection(corridor.primaryDirection()));
            ref.setSecondaryDirection(normalizeDirection(corridor.secondaryDirection()));
            ref.setStartMileMarker(corridor.startMileMarker());
            ref.setEndMileMarker(corridor.endMileMarker());
            ref.setBbox(corridor.bbox());

            double[] center = bboxCenter(corridor.bbox());
            ref.setCenterLat(center[0]);
            ref.setCenterLon(center[1]);
            ref.setUpdatedAt(now);

            corridorRefRepository.save(ref);
        }
    }

    private static String nonBlank(String preferred, String fallback) {
        return preferred != null && !preferred.isBlank() ? preferred.trim() : fallback;
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return direction.trim().toUpperCase();
    }

    private static double[] bboxCenter(String bbox) {
        String[] parts = bbox.split(",");
        if (parts.length != 4) return new double[]{0.0, 0.0};
        double lat1 = Double.parseDouble(parts[0].trim());
        double lon1 = Double.parseDouble(parts[1].trim());
        double lat2 = Double.parseDouble(parts[2].trim());
        double lon2 = Double.parseDouble(parts[3].trim());
        return new double[]{(lat1 + lat2) / 2.0, (lon1 + lon2) / 2.0};
    }
}
