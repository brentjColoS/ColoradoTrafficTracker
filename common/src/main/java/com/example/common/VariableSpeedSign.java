package com.example.common;

import java.time.Duration;
import java.time.Instant;

public record VariableSpeedSign(String id, double mileMarker, String direction, double longitude,
    double latitude, String location, Integer regularLimitMph, Integer reportedLimitMph,
    String status, String displayStatus, String communicationStatus, Instant sourceUpdatedAt,
    Instant activatedAt, Instant fetchedAt, Instant lastAttemptAt) {

    public static VariableSpeedSign unobserved(I70VariableSpeedSigns.Device device) {
        return new VariableSpeedSign(device.id(), device.mileMarker(), device.direction(), device.longitude(),
            device.latitude(), device.location(), device.regularLimitMph(), null, "NOT_OBSERVED", null,
            null, null, null, null, null);
    }

    public VariableSpeedSign failed(Instant attemptedAt) {
        return copy("FETCH_FAILED", attemptedAt);
    }

    public VariableSpeedSign at(Instant now) {
        if ("AVAILABLE".equals(status) && (fetchedAt == null || reportedLimitMph == null)) {
            return copy("UNAVAILABLE", lastAttemptAt);
        }
        if (fetchedAt != null && fetchedAt.plus(Duration.ofHours(1)).isBefore(now)
            && "AVAILABLE".equals(status)) return copy("STALE", lastAttemptAt);
        return this;
    }

    private VariableSpeedSign copy(String nextStatus, Instant attemptedAt) {
        return new VariableSpeedSign(id, mileMarker, direction, longitude, latitude, location,
            regularLimitMph, reportedLimitMph, nextStatus, displayStatus, communicationStatus,
            sourceUpdatedAt, activatedAt, fetchedAt, attemptedAt);
    }

    public boolean belowRegularLimit() {
        return "AVAILABLE".equals(status) && reportedLimitMph != null && regularLimitMph != null
            && reportedLimitMph < regularLimitMph;
    }
}
