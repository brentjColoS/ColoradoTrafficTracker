package com.example.api_service;

import com.example.api_service.DashboardDataController.Section;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.actuate.health.HealthEndpoint;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class DashboardDataService {
    private final TrafficDashboardController summaries;
    private final TrafficAnalyticsController analytics;
    private final TrafficController traffic;
    private final TrafficSpeedZoneTrendController zones;
    private final TrafficFlowCellController cells;
    private final TrafficMapController maps;
    private final OperationalStatusController status;
    private final ObjectProvider<HealthEndpoint> health;
    private final IncidentRevisionRepository incidentRevisions;
    private final Clock clock;
    private final ObjectMapper mapper;
    private record Cached(Section section, int bytes) {}
    private final Cache<String, Cached> cache = Caffeine.newBuilder()
        .maximumWeight(32 * 1024 * 1024).weigher((String key, Cached value) -> value.bytes())
        .expireAfterAccess(Duration.ofHours(12)).build();

    @org.springframework.beans.factory.annotation.Autowired
    public DashboardDataService(TrafficDashboardController summaries, TrafficAnalyticsController analytics,
        TrafficController traffic, TrafficSpeedZoneTrendController zones, TrafficFlowCellController cells,
        TrafficMapController maps, OperationalStatusController status, ObjectProvider<HealthEndpoint> health,
        IncidentRevisionRepository incidentRevisions, ObjectMapper mapper) {
        this(summaries, analytics, traffic, zones, cells, maps, status, health, incidentRevisions, mapper, Clock.systemUTC());
    }

    DashboardDataService(TrafficDashboardController summaries, TrafficAnalyticsController analytics,
        TrafficController traffic, TrafficSpeedZoneTrendController zones, TrafficFlowCellController cells,
        TrafficMapController maps, OperationalStatusController status, ObjectProvider<HealthEndpoint> health,
        IncidentRevisionRepository incidentRevisions, ObjectMapper mapper, Clock clock) {
        this.summaries = summaries; this.analytics = analytics; this.traffic = traffic; this.zones = zones;
        this.cells = cells; this.maps = maps; this.status = status; this.health = health;
        this.incidentRevisions = incidentRevisions; this.mapper = mapper; this.clock = clock;
    }

    public Map<String, Section> snapshot(List<Integer> ranges, int selected, boolean historical, Set<String> known) {
        Map<String, Section> result = new LinkedHashMap<>();
        add(result, "health", 20, () -> {
            HealthEndpoint endpoint = health.getObject();
            return ResponseEntity.ok(Map.of("status", endpoint.health().getStatus().getCode()));
        });
        add(result, "/traffic/map/corridors", 300, () -> ResponseEntity.ok(maps.corridors()));
        add(result, "/system/operational-status", 20, status::operationalStatus);
        for (String corridor : List.of("I25", "I70")) {
            String query = "?corridor=" + corridor;
            Section summary = add(result, "/traffic/summary" + query
                + "&windowHours=168&recentIncidentWindowMinutes=1440&preferUsable=true", 60,
                () -> summaries.currentSummary(corridor));
            TrafficDashboardController.CurrentSummary body = summary.data() instanceof TrafficDashboardController.CurrentSummary dto ? dto : null;
            OffsetDateTime anchor = historical && body != null && body.latest() != null ? body.latest().polledAt() : null;
            String asOf = asOf(anchor);
            add(result, "/traffic/analytics/trends" + query + "&windowHours=889&limit=890&preferUsable=true" + asOf,
                60, () -> analytics.trends(corridor, 889, 890, true, anchor));
            add(result, "/traffic/history" + query + "&windowMinutes=1440&limit=1500&preferUsable=true&includeIncidents=false" + asOf,
                60, () -> traffic.history(corridor, 1440, 1500, true, false, anchor));
            baseline(result, corridor, anchor, false);
            baseline(result, corridor, anchor, true);
            if (anchor == null) {
                add(result, "/traffic/map/flow-cells/current" + query, 60, () -> cells.current(corridor));
                liveIncidents(result, corridor);
            } else {
                add(result, "/traffic/map/flow-cells/hourly" + query + asOf, 60, () -> cells.hourly(corridor, anchor));
            }
            for (int hours : ranges) {
                int interval = hours == selected || hours == 24 ? 60 : switch (hours) {
                    case 2 -> 60; case 6 -> 300; case 24 -> 900; case 168 -> 3600; default -> 10800;
                };
                add(result, "/traffic/zones/trends" + query + "&windowHours=" + hours + asOf,
                    interval, () -> zones.trends(corridor, hours, anchor));
                if (hours > 24) add(result, "/traffic/map/flow-cells/frequency" + query + "&windowHours=" + hours + asOf,
                    hours == selected ? 60 : 3600, () -> cells.frequency(corridor, hours, anchor));
                if (historical) add(result, "/traffic/map/incidents/timeline" + query
                    + "&windowMinutes=" + (hours * 60) + "&limit=1000" + asOf, 60,
                    () -> maps.incidentTimeline(corridor, hours * 60, 1000, anchor));
            }
            if (!ranges.contains(24)) add(result, "/traffic/zones/trends" + query + "&windowHours=24" + asOf,
                60, () -> zones.trends(corridor, 24, anchor));
        }
        return changes(result, known);
    }

    private void liveIncidents(Map<String, Section> result, String corridor) {
        String path = "/traffic/map/incidents/shared?corridor=" + corridor;
        try {
            String revision = incidentRevisions.revision(corridor);
            Section bundle = read(path + "|" + revision, 900, () -> maps.sharedIncidents(corridor));
            result.put(key(path), bundle);
            // A capped shared set cannot safely replace independently capped short windows.
            if (bundle.data() instanceof TrafficMapController.SharedIncidents incidents && incidents.truncated()) {
                for (int hours : List.of(2, 6, 24, 168, 720)) add(result,
                    "/traffic/map/incidents/recent?corridor=" + corridor + "&windowMinutes=" + hours * 60 + "&limit=1000",
                    60, () -> maps.recentIncidents(corridor, hours * 60, 1000));
            }
        } catch (RuntimeException error) {
            result.put(key(path), failure());
        }
    }

    public Map<String, Section> history(List<String> corridors, int hours, OffsetDateTime end,
        boolean zoneView, Set<String> known) {
        Map<String, Section> result = new LinkedHashMap<>();
        for (String corridor : corridors) {
            String query = "?corridor=" + corridor;
            String asOf = asOf(end);
            if (zoneView) add(result, "/traffic/zones/trends" + query + "&windowHours=" + hours + asOf,
                600, () -> zones.trends(corridor, hours, end));
            else add(result, "/traffic/analytics/trends" + query + "&windowHours=" + (hours + 169)
                + "&limit=" + (hours + 170) + "&preferUsable=true" + asOf,
                600, () -> analytics.trends(corridor, hours + 169, hours + 170, true, end));
            baseline(result, corridor, end, zoneView);
            if (!zoneView && hours <= 24) {
                int minutes = hours * 60, limit = Math.min(2000, minutes + 60);
                add(result, "/traffic/history" + query + "&windowMinutes=" + minutes + "&limit=" + limit
                    + "&preferUsable=true&includeIncidents=false" + asOf, 600,
                    () -> traffic.history(corridor, minutes, limit, true, false, end));
            }
            add(result, "/traffic/map/incidents/timeline" + query + "&windowMinutes=" + (hours * 60) + "&limit=1000" + asOf,
                600, () -> maps.incidentTimeline(corridor, hours * 60, 1000, end));
        }
        return changes(result, known);
    }

    private void baseline(Map<String, Section> result, String corridor, OffsetDateTime anchor, boolean zone) {
        String path = "/traffic/" + (zone ? "zones" : "analytics") + "/baselines?corridor=" + corridor + asOf(anchor);
        String cacheKey = "baseline|" + corridor + "|" + zone + "|" + TrafficBaselineSupport.denverWeekStart(anchor == null ? OffsetDateTime.now(clock) : anchor);
        result.put(key(path), read(cacheKey, 604800,
            () -> zone ? zones.baselines(corridor, anchor) : analytics.baselines(corridor, anchor)));
    }

    private Section add(Map<String, Section> result, String path, int seconds, Supplier<? extends ResponseEntity<?>> loader) {
        Section section = read(key(path), seconds, loader);
        result.put(key(path), section);
        return section;
    }

    private Section read(String key, int seconds, Supplier<? extends ResponseEntity<?>> loader) {
        return cache.asMap().compute(key, (ignored, previous) -> {
            OffsetDateTime now = OffsetDateTime.now(clock);
            if (previous != null) {
                int lifetime = previous.section().status() == 200 ? seconds : 5;
                if (previous.section().fetchedAt().plusSeconds(lifetime).isAfter(now)) return previous;
            }
            try {
                ResponseEntity<?> response = loader.get();
                if (response.getStatusCode().value() != 200 || response.getBody() == null) return new Cached(new Section(
                    response.getStatusCode().value(), null, now, null), 256);
                return new Cached(new Section(200, UUID.randomUUID().toString(), now, response.getBody()),
                    256 + mapper.writeValueAsBytes(response.getBody()).length);
            } catch (Exception error) { return new Cached(failure(), 256); }
        }).section();
    }

    private Section failure() { return new Section(503, null, OffsetDateTime.now(clock), null); }

    private Map<String, Section> changes(Map<String, Section> result, Set<String> known) {
        Map<String, Section> changed = new LinkedHashMap<>();
        result.forEach((key, value) -> changed.put(key,
            value.version() != null && known.contains(value.version()) ? value.withoutData() : value));
        return changed;
    }

    private String asOf(OffsetDateTime anchor) { return anchor == null ? "" : "&asOf=" + anchor; }

    static String key(String path) {
        if (path.equals("health")) return path;
        var uri = UriComponentsBuilder.fromUriString(path).build();
        Map<String, String> params = new TreeMap<>();
        uri.getQueryParams().forEach((name, values) -> params.put(name,
            name.equals("asOf") ? String.valueOf(OffsetDateTime.parse(values.get(0)).toInstant().toEpochMilli()) : values.get(0)));
        return uri.getPath() + "?" + params.entrySet().stream().map(e -> e.getKey() + "=" + e.getValue())
            .collect(java.util.stream.Collectors.joining("&"));
    }
}
