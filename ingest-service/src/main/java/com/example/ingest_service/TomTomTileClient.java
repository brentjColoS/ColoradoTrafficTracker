package com.example.ingest_service;

import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

final class TomTomTileClient {
    private static final Logger log = LoggerFactory.getLogger(TomTomTileClient.class);
    private static final String VECTOR_TILE_PRODUCT = TomTomRequestGovernor.VECTOR_TILE_PRODUCT;
    private final WebClient http;
    private final TrafficProviderGuardService providerGuardService;
    private final TomTomAccountQuotaManager quotaManager;
    private final TileQuotaUsage quotaUsage;

    TomTomTileClient(WebClient http, TrafficProviderGuardService providerGuardService,
        TomTomAccountQuotaManager quotaManager, TileQuotaUsage quotaUsage) {
        this.http = http;
        this.providerGuardService = providerGuardService;
        this.quotaManager = quotaManager;
        this.quotaUsage = quotaUsage;
    }

    Mono<Map<TrafficTile, List<DecodedTrafficFeature>>> fetchFlowTiles(
        Set<TrafficTile> tiles,
        TomTomAccount account,
        int concurrency,
        AtomicLong issuedInitialCalls,
        Set<TrafficTile> fineTiles
    ) {
        // Retries reserve separately; only initial requests consume the batch reservation.
        return Flux.fromIterable(tiles)
            .flatMap(tile -> Mono.defer(() -> {
                issuedInitialCalls.incrementAndGet();
                return flowTileCall(tile, account, fineTiles.contains(tile));
            })
                .map(bytes -> Map.entry(tile, TrafficTileDecoder.decode(bytes, tile).stream().filter(TomTomTileClient::isFlowLayer).toList())), concurrency)
            .collectMap(Map.Entry::getKey, Map.Entry::getValue);
    }

    Mono<Map<TrafficTile, List<DecodedTrafficFeature>>> fetchIncidentTiles(
        Set<TrafficTile> tiles,
        TomTomAccount account,
        int concurrency,
        AtomicLong issuedInitialCalls
    ) {
        return Flux.fromIterable(tiles)
            .flatMap(tile -> Mono.defer(() -> {
                issuedInitialCalls.incrementAndGet();
                return incidentTileCall(tile, account);
            })
                .map(bytes -> Map.entry(tile, TrafficTileDecoder.decode(bytes, tile).stream().filter(TomTomTileClient::isIncidentLayer).toList())), concurrency)
            .collectMap(Map.Entry::getKey, Map.Entry::getValue);
    }

    private Mono<byte[]> flowTileCall(
        TrafficTile tile,
        TomTomAccount account,
        boolean finePrecision
    ) {
        return retryReservedVectorTile(account, () -> http.get()
                .uri(u -> u.path("/traffic/map/4/tile/flow/absolute/" + tile.z() + "/" + tile.x() + "/" + tile.y() + ".pbf")
                    .queryParam("roadTypes", "[0,1,2]")
                    .queryParam("margin", "0")
                    .queryParamIfPresent("trafficLevelStep", finePrecision ? java.util.Optional.of(1) : java.util.Optional.empty())
                    .queryParam("key", account.apiKey())
                    .build())
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .header("Tracking-ID", java.util.UUID.randomUUID().toString())
                .retrieve()
                .bodyToMono(byte[].class)
                .timeout(Duration.ofSeconds(8))
        )
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w) {
                    recordAccountFailure(account, w, "traffic/map/4/tile/flow");
                } else {
                    providerGuardService.recordRecoverableProviderFailure(
                        "traffic/map/4/tile/flow",
                        e
                    );
                }
                return Mono.error(e);
            });
    }

    private Mono<byte[]> incidentTileCall(
        TrafficTile tile,
        TomTomAccount account
    ) {
        return retryReservedVectorTile(account, () -> http.get()
                .uri(u -> u.path("/traffic/map/4/tile/incidents/" + tile.z() + "/" + tile.x() + "/" + tile.y() + ".pbf")
                    .queryParam("tags", "[icon_category,description,delay,road_type,id]")
                    .queryParam("key", account.apiKey())
                    .build())
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .header("Tracking-ID", java.util.UUID.randomUUID().toString())
                .retrieve()
                .bodyToMono(byte[].class)
                .timeout(Duration.ofSeconds(8))
        )
            .onErrorResume(e -> {
                if (e instanceof WebClientResponseException w) {
                    recordAccountFailure(account, w, "traffic/map/4/tile/incidents");
                } else {
                    providerGuardService.recordRecoverableProviderFailure(
                        "traffic/map/4/tile/incidents",
                        e
                    );
                }
                return Mono.error(e);
            });
    }

    private <T> Mono<T> retryReservedVectorTile(
        TomTomAccount account,
        Supplier<Mono<T>> request
    ) {
        int hardStop = quotaUsage.config().hardStopPerAccount();
        return Mono.defer(request)
            .retryWhen(
                Retry.backoff(1, Duration.ofMillis(250))
                    .filter(TransientProviderFailure::isRetryable)
                    .doBeforeRetry(signal -> {
                        if (
                            quotaManager.reserveForAccount(
                                account,
                                VECTOR_TILE_PRODUCT,
                                1,
                                hardStop
                            ).isEmpty()
                        ) {
                            throw new TomTomRequestQuotaExceededException(
                                VECTOR_TILE_PRODUCT,
                                quotaUsage.used(),
                                hardStop
                            );
                        }
                        quotaUsage.refresh(quotaUsage.config().hardStop());
                        log.warn(
                            "Retrying a TomTom vector tile with account {} after a transient failure: {}",
                            account.id(),
                            signal.failure().toString()
                        );
                    })
            );
    }

    private void recordAccountFailure(
        TomTomAccount account,
        WebClientResponseException response,
        String endpoint
    ) {
        if (providerGuardService.isInsufficientFunds(response)) {
            quotaManager.markCreditsExhausted(account.id());
            providerGuardService.recordRecoverableProviderFailure(endpoint, response);
            return;
        }
        if (providerGuardService.isAuthorizationFailure(response)) {
            quotaManager.markAuthorizationFailed(account.id());
            if (quotaManager.hasAvailableAccount()) {
                log.warn(
                    "TomTom account {} was quarantined after an authorization failure; another account remains available",
                    account.id()
                );
            } else {
                providerGuardService.tripAuthorizationFailure(
                    endpoint,
                    response.getStatusCode().value(),
                    response.getResponseBodyAsString()
                );
            }
            return;
        }
        providerGuardService.recordRecoverableProviderFailure(endpoint, response);
    }

    private static boolean isFlowLayer(DecodedTrafficFeature feature) {
        String layerName = feature.layerName() == null ? "" : feature.layerName().toLowerCase(Locale.ROOT);
        return layerName.contains("traffic flow");
    }

    private static boolean isIncidentLayer(DecodedTrafficFeature feature) {
        String layerName = feature.layerName() == null ? "" : feature.layerName().toLowerCase(Locale.ROOT);
        return layerName.contains("incident");
    }
}
