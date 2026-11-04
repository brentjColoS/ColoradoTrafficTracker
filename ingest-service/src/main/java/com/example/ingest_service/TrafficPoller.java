package com.example.ingest_service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.StringJoiner;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class TrafficPoller {

    private static final Logger log = LoggerFactory.getLogger(TrafficPoller.class);
    private static final ZoneId DISPLAY_ZONE = ZoneId.of("America/Denver");
    private static final DateTimeFormatter POLL_TIME_FORMAT =
        DateTimeFormatter.ofPattern("HH:mm M/d/yyyy z").withZone(DISPLAY_ZONE);
    private static final int CORRIDOR_REPEAT_LOG_INTERVAL = 10;

    private final TomTomPointPoller pointPoller;
    private final TrafficProps props;
    private final RoutesClient routesClient;
    private final CorridorMetadataSyncService corridorMetadataSyncService;
    private final TrafficPullProps pullProps;
    private final Map<String, TrafficFlowProvider> flowProviders;
    private final TrafficSchedulerLease schedulerLease;
    private final TrafficProviderGuardService providerGuardService;
    private final MeterRegistry meterRegistry;

    private static record CorridorRepeatState(String signature, int repeatedCycles) {}
    private final Map<String, CorridorRepeatState> repeatedPayloadStateByCorridor = new ConcurrentHashMap<>();

    public TrafficPoller(
        @Qualifier("tomtomWebClient") WebClient http,
        TrafficProps props,
        RoutesClient routesClient,
        TrafficSampleWriter sampleWriter,
        CorridorMetadataSyncService corridorMetadataSyncService,
        CorridorGeometryStore corridorGeometryStore,
        TrafficPullProps pullProps,
        List<TrafficFlowProvider> flowProviders,
        TrafficSchedulerLease schedulerLease,
        TomTomRequestGovernor requestGovernor,
        TrafficProviderGuardService providerGuardService,
        MeterRegistry meterRegistry
    ) {
        this.pointPoller = new TomTomPointPoller(http, pullProps, sampleWriter, corridorGeometryStore,
            providerGuardService, requestGovernor);
        this.props = props;
        this.routesClient = routesClient;
        this.corridorMetadataSyncService = corridorMetadataSyncService;
        this.pullProps = pullProps;
        this.flowProviders = flowProviders.stream().collect(java.util.stream.Collectors.toUnmodifiableMap(
            provider -> provider.providerName().toLowerCase(Locale.ROOT),
            provider -> provider
        ));
        this.schedulerLease = schedulerLease;
        this.providerGuardService = providerGuardService;
        this.meterRegistry = meterRegistry;
    }

    @Scheduled(initialDelay = 5000, fixedDelayString = "#{${traffic.pull.flow.pollSeconds} * 1000}")
    public void pollAll() {
        int pollSeconds = Math.max(1, pullProps.flow().pollSeconds());
        boolean acquired = schedulerLease.tryRun(
            "traffic-flow",
            Duration.ofSeconds(pollSeconds),
            Duration.ofSeconds(Math.max(60, Math.min(600, pollSeconds))),
            this::pollOnce
        );
        if (!acquired) {
            log.debug("Skipping flow poll because another instance owns the lease or the next run is not due");
        }
    }

    void pollOnce() {
        String mode = props.useTileMode() ? "tile" : "point";
        Instant cycleStarted = Instant.now();
        String pollId = UUID.randomUUID().toString();

        try (MDC.MDCCloseable pollContext = MDC.putCloseable("pollId", pollId)) {
            if (!pullProps.flow().enabled()) {
                log.debug("Flow polling is disabled");
                recordCycleMetric(mode, "skipped", cycleStarted);
                return;
            }
            boolean tomtomFlow = !props.useTileMode()
                || "tomtom".equals(normalizedProviderName(pullProps.flow().provider()));
            if (tomtomFlow && (props.tomtomApiKey() == null || props.tomtomApiKey().isBlank())) {
                log.warn("TOMTOM_API_KEY is missing or blank; skipping this poll cycle");
                recordCycleMetric(mode, "skipped", cycleStarted);
                return;
            }
            if (tomtomFlow && providerGuardService.isPollingHalted()) {
                log.warn("Polling halted by provider guard; fix upstream access or null-data failure before restarting ingest-service");
                recordCycleMetric(mode, "skipped", cycleStarted);
                return;
            }

            List<TrafficProps.Corridor> corridors = routesClient.fetchCorridors().block();
            if (corridors == null || corridors.isEmpty()) {
                log.warn("No corridors returned from routes-service; skipping this poll cycle");
                providerGuardService.recordRecoverableCycleFailure(
                    ProviderFailureCategory.ROUTES_SERVICE,
                    "routes-service/routes/corridors",
                    "No corridor definitions were returned by routes-service."
                );
                recordCycleMetric(mode, "skipped", cycleStarted);
                return;
            }
            corridorMetadataSyncService.sync(corridors);

            List<ProviderCycleSnapshot> summaries = props.useTileMode()
                ? pollTileMode(corridors)
                : pollPointMode(corridors);

            if (!summaries.isEmpty()) {
                log.info(
                    "Flow poll completed in {} ms: {}",
                    Duration.between(cycleStarted, Instant.now()).toMillis(),
                    formatPollSummary(summaries)
                );
                if (log.isDebugEnabled()) {
                    log.debug("{}", formatPollOutput(summaries));
                }
                logRepeatedCorridorPayloads(mode, summaries);
            }
            if (tomtomFlow) {
                providerGuardService.recordCycleOutcome(
                    mode,
                    summaries,
                    corridors.size()
                );
            }
            recordCycleMetric(mode, "success", cycleStarted);
        } catch (Exception e) {
            log.error("Unhandled poll cycle error: {}", e.toString(), e);
            recordCycleMetric(mode, "failure", cycleStarted);
        }
    }

    private List<ProviderCycleSnapshot> pollTileMode(List<TrafficProps.Corridor> corridors) {
        List<ProviderCycleSnapshot> summaries = new ArrayList<>();
        String providerName = normalizedProviderName(pullProps.flow().provider());
        TrafficFlowProvider provider = flowProviders.get(providerName);
        if (provider == null) {
            log.error(
                "No traffic flow provider is registered for '{}'; available providers are {}",
                providerName,
                flowProviders.keySet()
            );
            return summaries;
        }
        Map<String, ProviderCycleSnapshot> tiledSnapshots = provider.poll(corridors);
        for (TrafficProps.Corridor corridor : corridors) {
            Instant corridorStarted = Instant.now();
            ProviderCycleSnapshot snapshot = tiledSnapshots.get(corridor.name());
            if (snapshot != null) {
                summaries.add(snapshot);
                recordCorridorMetric("tile", corridor.name(), "success", corridorStarted);
            } else {
                recordCorridorMetric("tile", corridor.name(), "no_data", corridorStarted);
            }
        }
        return summaries;
    }

    private static String normalizedProviderName(String provider) {
        return provider == null ? "" : provider.trim().toLowerCase(Locale.ROOT);
    }

    private List<ProviderCycleSnapshot> pollPointMode(List<TrafficProps.Corridor> corridors) {
        List<ProviderCycleSnapshot> summaries = new ArrayList<>();
        for (TrafficProps.Corridor corridor : corridors) {
            Instant corridorStarted = Instant.now();
            try (MDC.MDCCloseable corridorContext = MDC.putCloseable("corridor", corridor.name())) {
                ProviderCycleSnapshot summary = pointPoller.poll(corridor).block();
                if (summary != null) {
                    summaries.add(summary);
                    recordCorridorMetric("point", corridor.name(), "success", corridorStarted);
                } else {
                    recordCorridorMetric("point", corridor.name(), "no_data", corridorStarted);
                }
            } catch (Exception e) {
                log.warn("Poll failed for {}: {}", corridor.name(), e.toString());
                recordCorridorMetric("point", corridor.name(), "failure", corridorStarted);
            }
        }
        return summaries;
    }

    void logRepeatedCorridorPayloads(String mode, List<ProviderCycleSnapshot> summaries) {
        Set<String> activeCorridors = ConcurrentHashMap.newKeySet();
        for (ProviderCycleSnapshot summary : summaries) {
            activeCorridors.add(summary.corridor());
            CorridorRepeatState previous = repeatedPayloadStateByCorridor.get(summary.corridor());
            int repeatedCycles = previous != null && previous.signature().equals(summary.payloadSignature())
                ? previous.repeatedCycles() + 1
                : 1;
            repeatedPayloadStateByCorridor.put(summary.corridor(), new CorridorRepeatState(summary.payloadSignature(), repeatedCycles));

            if (
                log.isDebugEnabled()
                    && repeatedCycles >= CORRIDOR_REPEAT_LOG_INTERVAL
                    && repeatedCycles % CORRIDOR_REPEAT_LOG_INTERVAL == 0
            ) {
                log.debug(
                    "Corridor {} in {} mode has repeated the same sampled payload for {} consecutive cycles; avgSpeed={} sampleCount={}",
                    summary.corridor(),
                    mode,
                    repeatedCycles,
                    summary.sampledSpeeds().isEmpty() ? "n/a" : String.format(Locale.US, "%.1f", TrafficStats.average(summary.sampledSpeeds())),
                    summary.sampledSpeeds().size()
                );
            }
        }
        repeatedPayloadStateByCorridor.keySet().retainAll(activeCorridors);
    }

    private void recordCycleMetric(String mode, String result, Instant startedAt) {
        Counter.builder("traffic.poll.cycles.total")
            .description("Total scheduled poll cycles")
            .tag("mode", mode)
            .tag("result", result)
            .register(meterRegistry)
            .increment();
        Timer.builder("traffic.poll.cycle.duration")
            .description("End-to-end duration of poll cycles")
            .tag("mode", mode)
            .tag("result", result)
            .register(meterRegistry)
            .record(Duration.between(startedAt, Instant.now()));
    }

    private void recordCorridorMetric(String mode, String corridor, String result, Instant startedAt) {
        Counter.builder("traffic.poll.corridor.total")
            .description("Total per-corridor polling attempts")
            .tag("mode", mode)
            .tag("corridor", corridor)
            .tag("result", result)
            .register(meterRegistry)
            .increment();
        Timer.builder("traffic.poll.corridor.duration")
            .description("Duration of per-corridor poll work")
            .tag("mode", mode)
            .tag("corridor", corridor)
            .tag("result", result)
            .register(meterRegistry)
            .record(Duration.between(startedAt, Instant.now()));
    }

    private static Double min(List<Double> vals) {
        if (vals.isEmpty()) return null;
        double minimum = Double.POSITIVE_INFINITY;
        for (double val : vals) if (val < minimum) minimum = val;
        return minimum;
    }

    private static String formatPollSummary(List<ProviderCycleSnapshot> summaries) {
        StringJoiner joiner = new StringJoiner("; ");
        for (ProviderCycleSnapshot summary : summaries) {
            List<Double> speeds = summary.sampledSpeeds().stream()
                .filter(java.util.Objects::nonNull)
                .toList();
            joiner.add(String.format(
                Locale.US,
                "%s samples=%d avg=%s min=%s",
                displayCorridor(summary.corridor()),
                speeds.size(),
                displaySpeed(TrafficStats.average(speeds)),
                displaySpeed(min(speeds))
            ));
        }
        return joiner.toString();
    }

    private static String formatPollOutput(List<ProviderCycleSnapshot> summaries) {
        StringBuilder out = new StringBuilder();
        out.append("Polled at ").append(POLL_TIME_FORMAT.format(Instant.now()));
        for (ProviderCycleSnapshot summary : summaries) {
            out.append(System.lineSeparator())
                .append(displayCorridor(summary.corridor()))
                .append(": ")
                .append(displaySpeeds(summary.sampledSpeeds()));
        }
        return out.toString();
    }

    private static String displayCorridor(String corridor) {
        String value = corridor == null ? "" : corridor.trim().toUpperCase(Locale.ROOT);
        if (value.matches("I\\d+")) return "I-" + value.substring(1);
        return value.isBlank() ? "UNKNOWN" : value;
    }

    private static String displaySpeeds(List<Double> sampledSpeeds) {
        if (sampledSpeeds == null || sampledSpeeds.isEmpty()) return "no samples";
        StringJoiner joiner = new StringJoiner(", ");
        for (Double speed : sampledSpeeds) {
            if (speed == null) {
                joiner.add("n/a");
            } else {
                joiner.add(String.format(Locale.US, "%.0f", speed));
            }
        }
        return joiner.toString();
    }

    private static String displaySpeed(Double speed) {
        return speed == null ? "n/a" : String.format(Locale.US, "%.1f mph", speed);
    }
}
