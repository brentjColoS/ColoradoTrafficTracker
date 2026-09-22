package com.example.ingest_service;

import java.time.Instant;

public record FlowSpatialEvidence(
    String corridor,
    Instant observedAt,
    int sourceZoom,
    String status,
    String detail,
    int decodedFeatureCount,
    int corridorFeatureCount,
    int uniqueFeatureCount,
    int duplicateFeatureCount,
    int oneSideFeatureCount,
    int fullCoverageFeatureCount,
    int unknownCoverageFeatureCount,
    int closureFeatureCount,
    int routeOrderForwardFeatureCount,
    int routeOrderReverseFeatureCount,
    int ambiguousOrientationFeatureCount,
    Distribution featureLengthMiles,
    Distribution routeSpanMiles,
    Distribution maxRouteDistanceMeters
) {
    public record Distribution(Double minimum, Double median, Double p90, Double maximum) {
        static Distribution empty() {
            return new Distribution(null, null, null, null);
        }
    }
}
