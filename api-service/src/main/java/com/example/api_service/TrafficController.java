package com.example.api_service;

import com.example.api_service.dto.TrafficHistoryResponseDto;
import com.example.api_service.dto.TrafficSampleDto;
import com.example.api_service.dto.TrafficSampleMapper;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/traffic")
public class TrafficController {
    private static final int MAX_WINDOW_MINUTES = 10_080;
    private static final int MAX_HISTORY_LIMIT = 500;

    private final TrafficSampleRepository repo;

    public TrafficController(TrafficSampleRepository repo) {this.repo = repo;}

    @GetMapping("/latest")
    public ResponseEntity<TrafficSampleDto> latest(@RequestParam("corridor") String corridor) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) {
            return ResponseEntity.badRequest().build();
        }

        return repo.findFirstByCorridorOrderByPolledAtDesc(normalized)
            .map(TrafficSampleMapper::toDto)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/history")
    public ResponseEntity<TrafficHistoryResponseDto> history(
        @RequestParam("corridor") String corridor,
        @RequestParam(name = "windowMinutes", defaultValue = "180") int windowMinutes,
        @RequestParam(name = "limit", defaultValue = "120") int limit
    ) {
        String normalized = normalizeCorridor(corridor);
        if (normalized == null) return ResponseEntity.badRequest().build();
        if (windowMinutes < 1 || windowMinutes > MAX_WINDOW_MINUTES) return ResponseEntity.badRequest().build();
        if (limit < 1 || limit > MAX_HISTORY_LIMIT) return ResponseEntity.badRequest().build();

        OffsetDateTime since = OffsetDateTime.now().minusMinutes(windowMinutes);
        List<TrafficSampleDto> samples = repo
            .findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(normalized, since, PageRequest.of(0, limit))
            .stream()
            .map(TrafficSampleMapper::toDto)
            .toList();

        return ResponseEntity.ok(
            new TrafficHistoryResponseDto(
                normalized,
                since,
                windowMinutes,
                limit,
                samples.size(),
                samples
            )
        );
    }

    @GetMapping("/corridors")
    public List<String> corridors() {
        return repo.findDistinctCorridors();
    }

    @GetMapping("/health")
    public String health() {
        return "ok";
    }

    private static String normalizeCorridor(String corridor) {
        if (corridor == null || corridor.isBlank()) return null;
        return corridor.trim();
    }
}
