package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class FlowSpatialEvidenceControllerTest {

    @Test
    void returnsLatestEvidenceWithoutExposingRawFeatures() {
        FlowSpatialEvidenceStore store = new FlowSpatialEvidenceStore();
        store.record(evidence("I70", "2026-09-20T18:01:00Z"));
        store.record(evidence("I25", "2026-09-20T18:00:00Z"));
        FlowSpatialEvidenceController controller = new FlowSpatialEvidenceController(store);

        ResponseEntity<List<FlowSpatialEvidence>> all = controller.latest(null);
        ResponseEntity<List<FlowSpatialEvidence>> one = controller.latest("i70");

        assertThat(all.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(all.getBody()).extracting(FlowSpatialEvidence::corridor).containsExactly("I25", "I70");
        assertThat(one.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(one.getBody()).singleElement().extracting(FlowSpatialEvidence::corridor).isEqualTo("I70");
    }

    @Test
    void distinguishesInvalidAndUnavailableCorridors() {
        FlowSpatialEvidenceController controller = new FlowSpatialEvidenceController(new FlowSpatialEvidenceStore());

        assertThat(controller.latest(" ").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(controller.latest("I25").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    private static FlowSpatialEvidence evidence(String corridor, String observedAt) {
        FlowSpatialEvidence.Distribution distribution = new FlowSpatialEvidence.Distribution(0.2, 0.4, 0.8, 1.0);
        return new FlowSpatialEvidence(
            corridor,
            Instant.parse(observedAt),
            10,
            "OBSERVED",
            "Route-order evidence only.",
            10, 12, 8, 7, 1, 6, 1, 0, 0, 3, 3, 1,
            distribution, distribution, distribution
        );
    }
}
