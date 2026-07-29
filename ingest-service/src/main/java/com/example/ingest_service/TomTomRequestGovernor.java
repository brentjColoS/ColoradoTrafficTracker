package com.example.ingest_service;

import java.util.function.Function;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

@Component
public class TomTomRequestGovernor {

    public static final String PROVIDER = "tomtom";
    public static final String VECTOR_TILE_PRODUCT = "traffic-flow-incidents-vector-tiles";
    public static final String MAP_DISPLAY_RASTER_PRODUCT = "map-display-raster-tiles";
    public static final String ROUTING_PRODUCT = "routing";
    public static final String FLOW_SEGMENT_PRODUCT = "traffic-flow-segment-data";
    public static final String INCIDENT_DETAILS_PRODUCT = "traffic-incident-details";

    private static final int MAP_DISPLAY_HARD_STOP = 195_000;
    private static final int ROUTING_HARD_STOP = 19_500;
    private static final int FLOW_SEGMENT_HARD_STOP = 19_500;
    private static final int INCIDENT_DETAILS_HARD_STOP = 2_450;

    private final TomTomAccountQuotaManager quotaManager;
    private final TrafficPullProps pullProps;

    public TomTomRequestGovernor(
        TomTomAccountQuotaManager quotaManager,
        TrafficPullProps pullProps
    ) {
        this.quotaManager = quotaManager;
        this.pullProps = pullProps;
    }

    public <T> Mono<T> vectorTile(Function<TomTomAccount, Mono<T>> request) {
        return budgeted(
            VECTOR_TILE_PRODUCT,
            Math.max(1, pullProps.monthlyRequestBudget().hardStopRequests()),
            request
        );
    }

    public <T> Mono<T> mapDisplayRaster(Function<TomTomAccount, Mono<T>> request) {
        return budgeted(MAP_DISPLAY_RASTER_PRODUCT, MAP_DISPLAY_HARD_STOP, request);
    }

    public <T> Mono<T> routing(Function<TomTomAccount, Mono<T>> request) {
        return budgeted(ROUTING_PRODUCT, ROUTING_HARD_STOP, request);
    }

    public <T> Mono<T> flowSegment(Function<TomTomAccount, Mono<T>> request) {
        return budgeted(FLOW_SEGMENT_PRODUCT, FLOW_SEGMENT_HARD_STOP, request);
    }

    public <T> Mono<T> incidentDetails(Function<TomTomAccount, Mono<T>> request) {
        return budgeted(INCIDENT_DETAILS_PRODUCT, INCIDENT_DETAILS_HARD_STOP, request);
    }

    private <T> Mono<T> budgeted(
        String product,
        int hardStop,
        Function<TomTomAccount, Mono<T>> request
    ) {
        return Mono.defer(() -> {
            java.util.Optional<TomTomAccountQuotaManager.AccountReservation> reservation =
                quotaManager.reserveUpTo(product, 1, hardStop);
            if (reservation.isEmpty()) {
                long used = quotaManager.snapshots(product, hardStop, hardStop, hardStop).stream()
                    .mapToLong(TomTomAccountQuotaManager.AccountQuotaSnapshot::requestsUsed)
                    .sum();
                int combinedHardStop = (int) Math.min(
                    Integer.MAX_VALUE,
                    (long) hardStop * Math.max(1, quotaManager.configuredAccountCount())
                );
                return Mono.error(new TomTomRequestQuotaExceededException(
                    product,
                    used,
                    combinedHardStop
                ));
            }
            TomTomAccount account = reservation.get().account();
            return request.apply(account)
                .doOnError(error -> recordAccountFailure(account, error));
        });
    }

    public boolean hasAvailableAccount() {
        return quotaManager.hasAvailableAccount();
    }

    private void recordAccountFailure(TomTomAccount account, Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof WebClientResponseException response) {
                int status = response.getStatusCode().value();
                String body = response.getResponseBodyAsString().toLowerCase(java.util.Locale.ROOT);
                if (
                    status == 403
                        && (
                            body.contains("insufficientfunds")
                                || body.contains("not enough credits")
                        )
                ) {
                    quotaManager.markCreditsExhausted(account.id());
                } else if (status == 401 || status == 403) {
                    quotaManager.markAuthorizationFailed(account.id());
                }
                return;
            }
            current = current.getCause();
        }
    }
}
