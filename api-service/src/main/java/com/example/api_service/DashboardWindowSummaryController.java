package com.example.api_service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
@RequestMapping({"/api/traffic/dashboard", "/dashboard-api/traffic/dashboard"})
public class DashboardWindowSummaryController {
    private final DashboardWindowSummaryService summaries;
    private final ObjectMapper mapper;

    public DashboardWindowSummaryController(DashboardWindowSummaryService summaries, ObjectMapper mapper) {
        this.summaries = summaries; this.mapper = mapper;
    }

    @GetMapping(value = "/window-summary", produces = "application/json")
    public ResponseEntity<Map<String, DashboardWindowSummaryService.WindowSummary>> summary(
        @RequestParam(name = "corridors", defaultValue = "I25,I70") List<String> corridors,
        @RequestParam("hours") int hours,
        @RequestParam("asOf") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        if (!valid(corridors, hours, asOf)) return ResponseEntity.badRequest().build();
        return ResponseEntity.ok(summaries.read(corridors.stream().distinct().toList(), hours, asOf));
    }

    @GetMapping(value = "/window-summary", params = "progressive=true", produces = "application/x-ndjson")
    public ResponseEntity<StreamingResponseBody> progressive(
        @RequestParam(name = "corridors", defaultValue = "I25,I70") List<String> corridors,
        @RequestParam("hours") int hours,
        @RequestParam("asOf") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime asOf
    ) {
        if (!valid(corridors, hours, asOf)) return ResponseEntity.badRequest().build();
        StreamingResponseBody body = output -> summaries.read(corridors.stream().distinct().toList(), hours, asOf, frame -> {
            try {
                output.write(mapper.writeValueAsBytes(frame)); output.write('\n'); output.flush();
            } catch (IOException disconnected) { throw new UncheckedIOException(disconnected); }
        });
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/x-ndjson"))
            .cacheControl(CacheControl.noStore()).header("X-Accel-Buffering", "no").body(body);
    }

    private static boolean valid(List<String> corridors, int hours, OffsetDateTime asOf) {
        return !corridors.isEmpty() && corridors.size() <= 2 && Set.of("I25", "I70").containsAll(corridors)
            && DashboardDataController.RANGES.contains(hours) && asOf != null
            && !asOf.isAfter(OffsetDateTime.now().plusMinutes(1));
    }
}
