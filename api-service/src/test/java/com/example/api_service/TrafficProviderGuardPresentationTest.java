package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.OffsetDateTime;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.Test;

class TrafficProviderGuardPresentationTest {
    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-10-29T20:00:00-06:00");

    @ParameterizedTest
    @CsvSource({"-120, 5, 0, FRESH", "299, 0, 4, FRESH", "300, 0, 5, STALE",
        "899, 15, 14, FRESH", "900, 15, 15, STALE"})
    void retainsWholeMinuteBoundaryMinimumAllowanceAndFutureClockClamp(
        int ageSeconds, int allowance, int expectedAge, String freshness
    ) {
        TrafficProviderGuardStatus status = new TrafficProviderGuardStatus();
        status.setLastCheckedAt(NOW.minusSeconds(ageSeconds));
        var dto = TrafficProviderGuardPresentation.toDto(status, NOW, allowance);
        assertThat(dto.statusAgeMinutes()).isEqualTo(expectedAge);
        assertThat(dto.freshnessState()).isEqualTo(freshness);
        assertThat(dto.stale()).isEqualTo("STALE".equals(freshness));
    }

    @Test
    void absentObservationDoesNotInventAStaleProvider() {
        var missing = TrafficProviderGuardPresentation.toDto(null, NOW, 5);
        assertThat(missing.providerName()).isEqualTo("tomtom");
        assertThat(missing.state()).isEqualTo("UNKNOWN");
        assertThat(missing.statusAgeMinutes()).isNull();
        assertThat(missing.freshnessState()).isEqualTo("UNKNOWN");
        assertThat(missing.stale()).isFalse();
        var unchecked = TrafficProviderGuardPresentation.toDto(new TrafficProviderGuardStatus(), NOW, 5);
        assertThat(unchecked.statusAgeMinutes()).isNull();
        assertThat(unchecked.freshnessState()).isEqualTo("UNKNOWN");
        assertThat(unchecked.stale()).isFalse();
    }
}
