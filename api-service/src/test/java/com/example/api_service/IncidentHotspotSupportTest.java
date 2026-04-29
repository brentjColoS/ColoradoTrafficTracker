package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.api_service.dto.IncidentHotspotDto;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class IncidentHotspotSupportTest {

    @Test
    void rankReturnsEmptyForNullEmptyOrNonPositiveLimit() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

        assertThat(IncidentHotspotSupport.rank(null, now, 3)).isEmpty();
        assertThat(IncidentHotspotSupport.rank(List.of(), now, 3)).isEmpty();
        assertThat(IncidentHotspotSupport.rank(List.of(projection("I25", "N", 210, 5L, 10L, 30.0, 90)), now, 0)).isEmpty();
        assertThat(IncidentHotspotSupport.top(List.of(), now)).isNull();
    }

    @Test
    void rankPrefersSpecificRecentDelayedHotspotsOverApproximateFallbacks() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficIncidentHotspotProjection preciseDelayed = projection("I25", "N", 214, 8L, 90L, 220.0, 840);
        TrafficIncidentHotspotProjection approximateNoDelay = projection("I25", "N", null, 12L, 160L, 0.0, 0);
        TrafficIncidentHotspotProjection staleDelayed = projection("I70", "W", 240, 9L, 70L, 180.0, 600, now.minusHours(6), now.minusHours(3));

        List<IncidentHotspotDto> ranked = IncidentHotspotSupport.rank(List.of(approximateNoDelay, staleDelayed, preciseDelayed), now, 3);

        assertThat(ranked).hasSize(3);
        assertThat(ranked.get(0).referenceLabel()).isEqualTo("I25 northbound near MM 214");
        assertThat(ranked.get(0).approximateLocation()).isFalse();
        assertThat(ranked.get(0).hasDelaySignal()).isTrue();
        assertThat(ranked.get(0).pressureScore()).isGreaterThan(ranked.get(1).pressureScore());
        assertThat(ranked.get(2).approximateLocation()).isTrue();
    }

    @Test
    void topBuildsFriendlyLabelsAndDurationMetadata() {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        TrafficIncidentHotspotProjection hotspot = projection(
            "I70",
            " e ",
            241,
            4L,
            25L,
            45.5,
            300,
            now.minusMinutes(90),
            now.minusMinutes(10)
        );

        IncidentHotspotDto dto = IncidentHotspotSupport.top(List.of(hotspot), now);

        assertThat(dto).isNotNull();
        assertThat(dto.travelDirectionLabel()).isEqualTo("eastbound");
        assertThat(dto.referenceLabel()).isEqualTo("I70 eastbound near MM 241");
        assertThat(dto.activeDurationMinutes()).isEqualTo(80);
        assertThat(dto.hasDelaySignal()).isTrue();
        assertThat(dto.pressureScore()).isPositive();
    }

    private static TrafficIncidentHotspotProjection projection(
        String corridor,
        String direction,
        Integer mileMarkerBand,
        Long incidentCount,
        Long observationCount,
        Double avgDelaySeconds,
        Integer maxDelaySeconds
    ) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        return projection(corridor, direction, mileMarkerBand, incidentCount, observationCount, avgDelaySeconds, maxDelaySeconds, now.minusMinutes(70), now.minusMinutes(5));
    }

    private static TrafficIncidentHotspotProjection projection(
        String corridor,
        String direction,
        Integer mileMarkerBand,
        Long incidentCount,
        Long observationCount,
        Double avgDelaySeconds,
        Integer maxDelaySeconds,
        OffsetDateTime firstSeenAt,
        OffsetDateTime lastSeenAt
    ) {
        return new TrafficIncidentHotspotProjection() {
            @Override public String getCorridor() { return corridor; }
            @Override public String getTravelDirection() { return direction; }
            @Override public Integer getMileMarkerBand() { return mileMarkerBand; }
            @Override public Long getObservationCount() { return observationCount; }
            @Override public Long getIncidentCount() { return incidentCount; }
            @Override public Double getAvgDelaySeconds() { return avgDelaySeconds; }
            @Override public Integer getMaxDelaySeconds() { return maxDelaySeconds; }
            @Override public java.time.Instant getFirstSeenAt() { return firstSeenAt.toInstant(); }
            @Override public java.time.Instant getLastSeenAt() { return lastSeenAt.toInstant(); }
            @Override public Long getArchivedObservationCount() { return 2L; }
            @Override public Long getArchivedIncidentCount() { return 1L; }
        };
    }
}
