package com.example.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class VariableSpeedSignTest {
    private final Instant now = Instant.parse("2026-11-06T12:00:00Z");

    private VariableSpeedSign sign(String status, Integer regular, Integer reported, Instant fetched) {
        return new VariableSpeedSign("fixture", 240, "EAST", -105.5, 39.7, "fixture location",
            regular, reported, status, "on", "operational", now.minusSeconds(90),
            now.minusSeconds(60), fetched, now);
    }

    @Test
    void reportsReductionsOnlyForAvailableComparableLimits() {
        assertThat(sign("AVAILABLE", 65, 45, now).belowRegularLimit()).isTrue();
        assertThat(sign("AVAILABLE", 65, 65, now).belowRegularLimit()).isFalse();
        assertThat(sign("AVAILABLE", 65, 75, now).belowRegularLimit()).isFalse();
        assertThat(sign("STALE", 65, 45, now).belowRegularLimit()).isFalse();
        assertThat(sign("AVAILABLE", null, 45, now).belowRegularLimit()).isFalse();
        assertThat(sign("AVAILABLE", 65, null, now).belowRegularLimit()).isFalse();
    }

    @Test
    void expiresAvailableReadsAfterOneHourAndRetainsLastReportedData() {
        var current = sign("AVAILABLE", 65, 45, now.minusSeconds(3600));
        assertThat(current.at(now)).isSameAs(current);
        var stale = current.at(now.plusNanos(1));
        assertThat(stale.status()).isEqualTo("STALE");
        assertThat(stale).isEqualTo(sign("STALE", 65, 45, now.minusSeconds(3600)));
        assertThat(stale.belowRegularLimit()).isFalse();
        assertThat(stale.at(now.plusSeconds(7200))).isSameAs(stale);
    }

    @Test
    void treatsIncompleteAvailableReadsAsUnavailable() {
        assertThat(sign("AVAILABLE", 65, 45, null).at(now))
            .isEqualTo(sign("UNAVAILABLE", 65, 45, null));
        assertThat(sign("AVAILABLE", 65, null, now).at(now))
            .isEqualTo(sign("UNAVAILABLE", 65, null, now));
    }

    @Test
    void failedReadsPreserveTheObservationAndRecordTheAttempt() {
        var original = sign("AVAILABLE", 65, 45, now);
        var failed = original.failed(now.plusSeconds(30));
        assertThat(failed.status()).isEqualTo("FETCH_FAILED");
        assertThat(failed.lastAttemptAt()).isEqualTo(now.plusSeconds(30));
        assertThat(failed).usingRecursiveComparison()
            .ignoringFields("status", "lastAttemptAt").isEqualTo(original);
        assertThat(failed.at(now.plusSeconds(7200))).isSameAs(failed);
    }

    @Test
    void startsCatalogDevicesWithoutAnObservation() {
        var device = I70VariableSpeedSigns.device("OpenTMS-Sign475239");
        var unknown = VariableSpeedSign.unobserved(device);
        assertThat(unknown).isEqualTo(new VariableSpeedSign(device.id(), device.mileMarker(),
            device.direction(), device.longitude(), device.latitude(), device.location(),
            device.regularLimitMph(), null, "NOT_OBSERVED", null, null, null, null, null, null));
        assertThat(unknown.at(now)).isSameAs(unknown);
        assertThat(unknown.belowRegularLimit()).isFalse();
    }
}
