package com.example.api_service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

@Entity
@Table(name = "traffic_speed_zone_sample")
public class TrafficSpeedZoneSample {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "sample_id", nullable = false)
    private Long sampleId;

    @Column(nullable = false)
    private String corridor;

    @Column(name = "zone_key", nullable = false)
    private String zoneKey;

    @Column(name = "zone_order", nullable = false)
    private Integer zoneOrder;

    @Column(name = "zone_label", nullable = false)
    private String zoneLabel;

    @Column(name = "zone_description")
    private String zoneDescription;

    @Column(name = "start_mile_marker", nullable = false)
    private Double startMileMarker;

    @Column(name = "end_mile_marker", nullable = false)
    private Double endMileMarker;

    @Column(name = "posted_speed_mph", nullable = false)
    private Integer postedSpeedMph;

    @Column(name = "avg_current_speed")
    private Double avgCurrentSpeed;

    @Column(name = "min_current_speed")
    private Double minCurrentSpeed;

    @Column(name = "speed_stddev")
    private Double speedStddev;

    @Column(name = "p10_speed")
    private Double p10Speed;

    @Column(name = "p50_speed")
    private Double p50Speed;

    @Column(name = "p90_speed")
    private Double p90Speed;

    @Column(name = "speed_sample_count", nullable = false)
    private Integer speedSampleCount;

    @Column(name = "speed_state_signature")
    private String speedStateSignature;

    @Column(name = "polled_at", nullable = false)
    private OffsetDateTime polledAt;

    @Column(name = "ingested_at", nullable = false)
    private OffsetDateTime ingestedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getSampleId() { return sampleId; }
    public void setSampleId(Long sampleId) { this.sampleId = sampleId; }

    public String getCorridor() { return corridor; }
    public void setCorridor(String corridor) { this.corridor = corridor; }

    public String getZoneKey() { return zoneKey; }
    public void setZoneKey(String zoneKey) { this.zoneKey = zoneKey; }

    public Integer getZoneOrder() { return zoneOrder; }
    public void setZoneOrder(Integer zoneOrder) { this.zoneOrder = zoneOrder; }

    public String getZoneLabel() { return zoneLabel; }
    public void setZoneLabel(String zoneLabel) { this.zoneLabel = zoneLabel; }

    public String getZoneDescription() { return zoneDescription; }
    public void setZoneDescription(String zoneDescription) { this.zoneDescription = zoneDescription; }

    public Double getStartMileMarker() { return startMileMarker; }
    public void setStartMileMarker(Double startMileMarker) { this.startMileMarker = startMileMarker; }

    public Double getEndMileMarker() { return endMileMarker; }
    public void setEndMileMarker(Double endMileMarker) { this.endMileMarker = endMileMarker; }

    public Integer getPostedSpeedMph() { return postedSpeedMph; }
    public void setPostedSpeedMph(Integer postedSpeedMph) { this.postedSpeedMph = postedSpeedMph; }

    public Double getAvgCurrentSpeed() { return avgCurrentSpeed; }
    public void setAvgCurrentSpeed(Double avgCurrentSpeed) { this.avgCurrentSpeed = avgCurrentSpeed; }

    public Double getMinCurrentSpeed() { return minCurrentSpeed; }
    public void setMinCurrentSpeed(Double minCurrentSpeed) { this.minCurrentSpeed = minCurrentSpeed; }

    public Double getSpeedStddev() { return speedStddev; }
    public void setSpeedStddev(Double speedStddev) { this.speedStddev = speedStddev; }

    public Double getP10Speed() { return p10Speed; }
    public void setP10Speed(Double p10Speed) { this.p10Speed = p10Speed; }

    public Double getP50Speed() { return p50Speed; }
    public void setP50Speed(Double p50Speed) { this.p50Speed = p50Speed; }

    public Double getP90Speed() { return p90Speed; }
    public void setP90Speed(Double p90Speed) { this.p90Speed = p90Speed; }

    public Integer getSpeedSampleCount() { return speedSampleCount; }
    public void setSpeedSampleCount(Integer speedSampleCount) { this.speedSampleCount = speedSampleCount; }

    public String getSpeedStateSignature() { return speedStateSignature; }
    public void setSpeedStateSignature(String speedStateSignature) { this.speedStateSignature = speedStateSignature; }

    public OffsetDateTime getPolledAt() { return polledAt; }
    public void setPolledAt(OffsetDateTime polledAt) { this.polledAt = polledAt; }

    public OffsetDateTime getIngestedAt() { return ingestedAt; }
    public void setIngestedAt(OffsetDateTime ingestedAt) { this.ingestedAt = ingestedAt; }
}
