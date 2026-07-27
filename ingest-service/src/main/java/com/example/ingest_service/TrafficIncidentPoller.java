package com.example.ingest_service;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class TrafficIncidentPoller {

    private static final Logger log = LoggerFactory.getLogger(TrafficIncidentPoller.class);

    private final TrafficProps trafficProps;
    private final TrafficPullProps pullProps;
    private final RoutesClient routesClient;
    private final IncidentEventWriter eventWriter;
    private final IncidentSnapshotStore snapshotStore;
    private final TrafficProviderGuardService tomtomProviderGuard;
    private final Map<String, TrafficIncidentProvider> providers;

    public TrafficIncidentPoller(
        TrafficProps trafficProps,
        TrafficPullProps pullProps,
        RoutesClient routesClient,
        IncidentEventWriter eventWriter,
        IncidentSnapshotStore snapshotStore,
        TrafficProviderGuardService tomtomProviderGuard,
        List<TrafficIncidentProvider> providers
    ) {
        this.trafficProps = trafficProps;
        this.pullProps = pullProps;
        this.routesClient = routesClient;
        this.eventWriter = eventWriter;
        this.snapshotStore = snapshotStore;
        this.tomtomProviderGuard = tomtomProviderGuard;
        this.providers = providers.stream().collect(Collectors.toUnmodifiableMap(
            provider -> normalize(provider.providerName()),
            provider -> provider
        ));
    }

    @Scheduled(initialDelay = 15000, fixedDelayString = "#{${traffic.pull.incidents.pollSeconds} * 1000}")
    public void poll() {
        TrafficPullProps.Incidents config = pullProps.incidents();
        if (!trafficProps.useTileMode()) {
            log.debug("Independent incident polling is disabled while legacy point mode is active");
            return;
        }
        if (!config.enabled()) {
            log.debug("Incident polling is disabled");
            return;
        }

        String providerName = normalize(config.provider());
        TrafficIncidentProvider provider = providers.get(providerName);
        if (provider == null) {
            log.error(
                "No traffic incident provider is registered for '{}'; available providers are {}",
                providerName,
                providers.keySet()
            );
            return;
        }
        if ("tomtom".equals(providerName) && !tomtomIsAvailable()) {
            return;
        }

        String pollId = UUID.randomUUID().toString();
        Instant startedAt = Instant.now();
        try (MDC.MDCCloseable pollContext = MDC.putCloseable("pollId", pollId)) {
            List<TrafficProps.Corridor> corridors = routesClient.fetchCorridors().block();
            if (corridors == null || corridors.isEmpty()) {
                log.warn("No corridors returned from routes-service; keeping the previous incident snapshot");
                return;
            }

            Map<String, CorridorIncidentSnapshot> next = provider.poll(corridors);
            if (next == null || next.isEmpty()) {
                log.warn(
                    "{} incident poll returned no corridor snapshots; keeping the previous snapshot",
                    providerName
                );
                return;
            }
            boolean complete = corridors.stream()
                .map(TrafficProps.Corridor::name)
                .allMatch(next::containsKey);
            if (!complete) {
                log.warn(
                    "{} incident poll returned only {} of {} corridor snapshots; keeping the previous snapshot",
                    providerName,
                    next.size(),
                    corridors.size()
                );
                return;
            }

            eventWriter.publish(next);
            snapshotStore.replace(next);
            int incidentCount = next.values().stream()
                .mapToInt(CorridorIncidentSnapshot::incidentCount)
                .sum();
            log.info(
                "Published {} incident snapshot for {} corridors with {} active events in {} ms",
                providerName,
                next.size(),
                incidentCount,
                java.time.Duration.between(startedAt, Instant.now()).toMillis()
            );
        } catch (Exception e) {
            log.warn(
                "{} incident poll failed; keeping the previous snapshot: {}",
                providerName,
                e.toString()
            );
        }
    }

    private boolean tomtomIsAvailable() {
        if (trafficProps.tomtomApiKey() == null || trafficProps.tomtomApiKey().isBlank()) {
            log.warn("TOMTOM_API_KEY is missing or blank; keeping the previous incident snapshot");
            return false;
        }
        if (tomtomProviderGuard.isPollingHalted()) {
            log.warn("TomTom incident polling is halted by the provider guard");
            return false;
        }
        return true;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}
