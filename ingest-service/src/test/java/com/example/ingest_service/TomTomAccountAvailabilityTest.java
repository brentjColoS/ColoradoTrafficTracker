package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class TomTomAccountAvailabilityTest {

    @Test
    void oneQuarantinedAccountDoesNotHideTheOther() {
        TomTomAccountAvailability availability = availabilityAt("2026-07-28T12:00:00Z");

        availability.markCreditsExhausted("primary");

        assertThat(availability.isAvailable("primary")).isFalse();
        assertThat(availability.isAvailable("secondary")).isTrue();
        assertThat(availability.hasAvailableAccount()).isTrue();
        assertThat(availability.snapshot("primary").retryOn())
            .isEqualTo(LocalDate.of(2026, 8, 1));
    }

    @Test
    void exhaustedCreditsWaitForAConfirmedReset() {
        MutableClock clock = new MutableClock("2026-07-31T23:59:59Z");
        TomTomAccountAvailability availability = new TomTomAccountAvailability(accountPool(), clock);

        availability.markCreditsExhausted("primary");
        assertThat(availability.isAvailable("primary")).isFalse();

        clock.set("2026-08-01T00:00:00Z");
        assertThat(availability.isAvailable("primary")).isFalse();

        availability.markAvailable("primary");
        assertThat(availability.state("primary"))
            .isEqualTo(TomTomAccountAvailability.State.AVAILABLE);
    }

    @Test
    void authorizationFailuresRequireAnExplicitReset() {
        TomTomAccountAvailability availability = availabilityAt("2026-07-28T12:00:00Z");

        availability.markAuthorizationFailed("secondary");
        assertThat(availability.state("secondary"))
            .isEqualTo(TomTomAccountAvailability.State.AUTH_FAILED);

        availability.markAvailable("secondary");
        assertThat(availability.state("secondary"))
            .isEqualTo(TomTomAccountAvailability.State.AVAILABLE);
    }

    private static TomTomAccountAvailability availabilityAt(String instant) {
        return new TomTomAccountAvailability(
            accountPool(),
            Clock.fixed(Instant.parse(instant), ZoneOffset.UTC)
        );
    }

    private static TomTomAccountPool accountPool() {
        return new TomTomAccountPool(
            new TrafficProps("primary-key", 60, "tile", 10, "", 2, 500, 0, 0, 0, true),
            new TomTomAccountsProps("secondary-key", true, true)
        );
    }

    private static class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(String instant) {
            this.instant = Instant.parse(instant);
        }

        private void set(String instant) {
            this.instant = Instant.parse(instant);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
