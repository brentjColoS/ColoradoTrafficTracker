package com.example.ingest_service;

import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/traffic/flow-spatial-evidence")
public class FlowSpatialEvidenceController {
    private final FlowSpatialEvidenceStore store;

    public FlowSpatialEvidenceController(FlowSpatialEvidenceStore store) {
        this.store = store;
    }

    @GetMapping
    public ResponseEntity<List<FlowSpatialEvidence>> latest(
        @RequestParam(name = "corridor", required = false) String corridor
    ) {
        if (corridor == null) return ResponseEntity.ok(store.snapshot());
        if (corridor.isBlank()) return ResponseEntity.badRequest().build();
        return store.latest(corridor)
            .map(evidence -> ResponseEntity.ok(List.of(evidence)))
            .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
