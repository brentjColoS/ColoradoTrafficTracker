package com.example.api_service;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;
import java.util.Arrays;
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
public class DashboardDataController {
    static final Set<Integer> RANGES = Set.of(2, 6, 24, 168, 720);
    private final DashboardDataService data;

    public DashboardDataController(DashboardDataService data) { this.data = data; }

    @GetMapping("/snapshot")
    public ResponseEntity<Map<String, Section>> snapshot(
        @RequestParam(name = "ranges", defaultValue = "24") List<Integer> ranges,
        @RequestParam(name = "selectedHours", defaultValue = "24") int selectedHours,
        @RequestParam(name = "historical", defaultValue = "false") boolean historical,
        @RequestParam(name = "known", defaultValue = "") String known
    ) {
        if (ranges.isEmpty() || ranges.size() > 5 || !RANGES.containsAll(ranges)
            || !RANGES.contains(selectedHours) || known.length() > 4096) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(data.snapshot(ranges.stream().distinct().toList(), selectedHours, historical, versions(known)));
    }

    @GetMapping("/history")
    public ResponseEntity<Map<String, Section>> history(
        @RequestParam(name = "corridors", defaultValue = "I25,I70") List<String> corridors,
        @RequestParam("hours") int hours,
        @RequestParam("asOf") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf,
        @RequestParam(name = "zones", defaultValue = "false") boolean zones,
        @RequestParam(name = "known", defaultValue = "") String known
    ) {
        if (corridors.isEmpty() || corridors.size() > 2 || !Set.of("I25", "I70").containsAll(corridors)
            || !RANGES.contains(hours) || asOf == null || known.length() > 4096) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(data.history(corridors.stream().distinct().toList(), hours, asOf, zones, versions(known)));
    }

    private Set<String> versions(String known) {
        return Set.copyOf(Arrays.asList(known.split(",")));
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Section(int status, String version, OffsetDateTime fetchedAt, Object data) {
        Section withoutData() { return new Section(status, version, fetchedAt, null); }
    }
}
