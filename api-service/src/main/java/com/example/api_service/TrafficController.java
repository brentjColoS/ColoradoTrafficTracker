package com.example.api_service;

import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/traffic")
public class TrafficController {
    private final TrafficSampleRepository repo;
    public TrafficController(TrafficSampleRepository repo) {this.repo = repo;}

    @GetMapping("/latest")
    public ResponseEntity<TrafficSample> latest(@RequestParam String corridor) {
        if (corridor == null || corridor.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        return repo.findByCorridorOrderByPolledAtDesc(corridor.trim(), PageRequest.of(0, 1))
            .stream()
            .findFirst()
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/health")
    public String health() {
        return "ok";
    }
}
