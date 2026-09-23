package com.example.ingest_service;

import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/traffic/flow-cells")
public class CorridorFlowCellController {
    private final CorridorFlowCellStore store;

    public CorridorFlowCellController(CorridorFlowCellStore store) {
        this.store = store;
    }

    @GetMapping
    public ResponseEntity<List<CorridorFlowCellSnapshot>> latest(
        @RequestParam(name = "corridor", required = false) String corridor
    ) {
        if (corridor == null) return ResponseEntity.ok(store.snapshot());
        if (corridor.isBlank()) return ResponseEntity.badRequest().build();
        return store.latest(corridor)
            .map(snapshot -> ResponseEntity.ok(List.of(snapshot)))
            .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
