package com.example.ingest_service;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/tomtom/reset-probes")
public class TomTomResetProbeController {

    private final TomTomResetProbeHistory history;

    public TomTomResetProbeController(TomTomResetProbeHistory history) {
        this.history = history;
    }

    @GetMapping
    public List<TomTomResetProbeEvent> history(
        @RequestParam(name = "limit", defaultValue = "90") int limit
    ) {
        return history.recent(limit);
    }

    @GetMapping("/runs")
    public List<TomTomResetProbeRun> runs(
        @RequestParam(name = "limit", defaultValue = "90") int limit
    ) {
        return history.recentRuns(limit);
    }
}
