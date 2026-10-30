package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;
import org.junit.jupiter.api.Test;

class TrafficSampleSignatureTest {
    @Test
    void preservesExistingSignaturesForDefaultAndMissingFields() {
        TrafficSample sample = new TrafficSample();
        assertThat(TrafficSampleSignature.from(sample))
            .isEqualTo("1323ef9d00668b083098baa889437e1a52849b820383d75b28e4b1b10c3c950f");
        assertThat(TrafficSampleSignature.speedOnly(sample))
            .isEqualTo("ea202749678abb8a94d6b2ab2da2dbb593dd3ec8e9764af4b26e65f2558e5791");
        sample.setSourceMode(null);
        sample.setIncidentCount(null);
        sample.setLocalizedSlowdown(null);
        assertThat(TrafficSampleSignature.from(sample))
            .isEqualTo("4f0681a108a33e4decf589503c71ce68df989a250e33fb46a769febf72218ae7");
        assertThat(TrafficSampleSignature.speedOnly(sample))
            .isEqualTo("756514a3231dbf6ab3d5dbc1c15ae68bb074afd83ec41118ca7adfa02a8c57c9");
    }

    @Test
    void incidentChangesAffectFullSignatureWithoutChangingFlowIdentity() {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(" I25 ");
        sample.setAvgCurrentSpeed(42.1234567);
        String speed = TrafficSampleSignature.speedOnly(sample);
        String full = TrafficSampleSignature.from(sample);
        sample.setIncidentCount(1);
        sample.setIncidentsJson("{\"description\":\"snow ☃\"}");
        assertThat(TrafficSampleSignature.speedOnly(sample)).isEqualTo(speed);
        assertThat(TrafficSampleSignature.from(sample)).isNotEqualTo(full);
        sample.setAvgCurrentSpeed(41.0);
        assertThat(TrafficSampleSignature.speedOnly(sample)).isNotEqualTo(speed);
    }

    @Test
    void decimalRoundingAndSignaturesRemainLocaleIndependent() {
        TrafficSample sample = new TrafficSample();
        sample.setAvgCurrentSpeed(42.12345671);
        String signature = TrafficSampleSignature.from(sample);
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.GERMANY);
            sample.setAvgCurrentSpeed(42.12345672);
            assertThat(TrafficSampleSignature.from(sample)).isEqualTo(signature);
        } finally {
            Locale.setDefault(previous);
        }
    }
}
