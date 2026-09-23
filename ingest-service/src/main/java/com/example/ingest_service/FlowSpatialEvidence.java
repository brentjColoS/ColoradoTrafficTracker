package com.example.ingest_service;

import java.time.Instant;

public record FlowSpatialEvidence(
    String corridor,
    Instant observedAt,
    int sourceZoom,
    String status,
    String detail,
    int decodedFeatureCount,
    int decodedPathCount,
    int corridorPathCount,
    int uniquePathCount,
    int duplicatePathCount,
    int oneSidePathCount,
    int fullCoveragePathCount,
    int unknownCoveragePathCount,
    int closurePathCount,
    int routeOrderForwardPathCount,
    int routeOrderReversePathCount,
    int ambiguousOrientationPathCount,
    Distribution pathLengthMiles,
    Distribution routeSpanMiles,
    Distribution maxRouteDistanceMeters
) {
    public record Distribution(Double minimum, Double median, Double p90, Double maximum) {
        static Distribution empty() {
            return new Distribution(null, null, null, null);
        }
    }
}
