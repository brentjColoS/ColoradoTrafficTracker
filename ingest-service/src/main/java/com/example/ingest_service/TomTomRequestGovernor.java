package com.example.ingest_service;

import java.util.function.Supplier;
import org.springframework.stereotype.Component;
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

    private final TrafficRequestBudget requestBudget;
    private final TrafficPullProps pullProps;

    public TomTomRequestGovernor(
        TrafficRequestBudget requestBudget,
        TrafficPullProps pullProps
    ) {
        this.requestBudget = requestBudget;
        this.pullProps = pullProps;
    }

    public <T> Mono<T> vectorTile(Supplier<Mono<T>> request) {
        return budgeted(
            VECTOR_TILE_PRODUCT,
            Math.max(1, pullProps.monthlyRequestBudget().hardStopRequests()),
            request
        );
    }

    public <T> Mono<T> mapDisplayRaster(Supplier<Mono<T>> request) {
        return budgeted(MAP_DISPLAY_RASTER_PRODUCT, MAP_DISPLAY_HARD_STOP, request);
    }

    public <T> Mono<T> routing(Supplier<Mono<T>> request) {
        return budgeted(ROUTING_PRODUCT, ROUTING_HARD_STOP, request);
    }

    public <T> Mono<T> flowSegment(Supplier<Mono<T>> request) {
        return budgeted(FLOW_SEGMENT_PRODUCT, FLOW_SEGMENT_HARD_STOP, request);
    }

    public <T> Mono<T> incidentDetails(Supplier<Mono<T>> request) {
        return budgeted(INCIDENT_DETAILS_PRODUCT, INCIDENT_DETAILS_HARD_STOP, request);
    }

    private <T> Mono<T> budgeted(
        String product,
        int hardStop,
        Supplier<Mono<T>> request
    ) {
        return Mono.defer(() -> {
            TrafficRequestBudget.MonthlyReservation reservation = requestBudget.reserveMonthly(
                PROVIDER,
                product,
                1,
                hardStop
            );
            if (!reservation.allowed()) {
                return Mono.error(new TomTomRequestQuotaExceededException(
                    product,
                    reservation.requestsUsed(),
                    hardStop
                ));
            }
            return request.get();
        });
    }
}
