package com.example.api_service;

import com.example.api_service.dto.TrafficProviderGuardStatusDto;
import java.time.Duration;
import java.time.OffsetDateTime;

final class TrafficProviderGuardPresentation {
    private TrafficProviderGuardPresentation() {}

    static TrafficProviderGuardStatusDto toDto(
        TrafficProviderGuardStatus status, OffsetDateTime now, int staleAfterMinutes
    ) {
        if (status == null) {
            return new TrafficProviderGuardStatusDto(
                "tomtom",
                "UNKNOWN",
                false,
                null,
                "No provider guard status has been recorded yet.",
                null,
                0,
                0,
                null,
                null,
                null,
                null,
                null,
                "UNKNOWN",
                false
            );
        }

        Integer ageMinutes = status.getLastCheckedAt() == null ? null
            : (int) Math.max(0, Duration.between(status.getLastCheckedAt(), now).toMinutes());
        boolean stale = ageMinutes != null && ageMinutes >= Math.max(5, staleAfterMinutes);
        return new TrafficProviderGuardStatusDto(
            status.getProviderName(),
            status.getState(),
            status.isHalted(),
            status.getFailureCode(),
            status.getMessage(),
            status.getDetailsJson(),
            status.getConsecutiveNullCycles(),
            status.getConsecutiveStaleCycles(),
            status.getLastCheckedAt(),
            status.getLastSuccessAt(),
            status.getLastFailureAt(),
            status.getShutdownTriggeredAt(),
            ageMinutes,
            ageMinutes == null ? "UNKNOWN" : stale ? "STALE" : "FRESH",
            stale
        );
    }
}
