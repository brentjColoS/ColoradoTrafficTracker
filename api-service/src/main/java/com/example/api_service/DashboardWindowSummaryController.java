package com.example.api_service;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/traffic/dashboard", "/dashboard-api/traffic/dashboard"})
public class DashboardWindowSummaryController {
    private final DashboardWindowSummaryService summaries;

    public DashboardWindowSummaryController(DashboardWindowSummaryService summaries) { this.summaries = summaries; }

    @GetMapping("/window-summary")
    public ResponseEntity<Map<String, DashboardWindowSummaryService.WindowSummary>> summary(
        @RequestParam(name = "corridors", defaultValue = "I25,I70") List<String> corridors,
        @RequestParam("hours") int hours,
        @RequestParam("asOf") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        if (corridors.isEmpty() || corridors.size() > 2 || !Set.of("I25", "I70").containsAll(corridors)
            || !DashboardDataController.RANGES.contains(hours) || asOf == null
            || asOf.isAfter(OffsetDateTime.now().plusMinutes(1))) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(summaries.read(corridors.stream().distinct().toList(), hours, asOf));
    }
}
