package com.example.api_service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

@Entity
@Table(name = "traffic_sample")
public class TrafficSample {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable=false) private String corridor;
    @Column(name = "avg_current_speed")
    private Double avgCurrentSpeed;
    @Column(name = "avg_freeflow_speed")
    private Double avgFreeflowSpeed;
    @Column(name = "min_current_speed")
    private Double minCurrentSpeed;
    private Double confidence;              // average across sampled points
    @Column(name = "source_mode", nullable = false)
    private String sourceMode = "unknown";
    @Column(name = "speed_sample_count")
    private Integer speedSampleCount;
    @Column(name = "speed_stddev")
    private Double speedStddev;
    @Column(name = "p10_speed")
    private Double p10Speed;
    @Column(name = "p50_speed")
    private Double p50Speed;
    @Column(name = "p90_speed")
    private Double p90Speed;
    @Column(name = "incident_count", nullable = false)
    private Integer incidentCount = 0;

    @Column(name = "incidents_json", columnDefinition = "text")
    private String incidentsJson;

    @Column(name = "polled_at", nullable=false)
    private OffsetDateTime polledAt = OffsetDateTime.now(ZoneOffset.UTC);

    @Column(name = "ingested_at", nullable = false)
    private OffsetDateTime ingestedAt = OffsetDateTime.now(ZoneOffset.UTC);

    public Long getId() {return id;}
    public void setId(Long id) {this.id = id;}

    public Double getAvgCurrentSpeed() {return avgCurrentSpeed;}
    public void setAvgCurrentSpeed(Double avgCurrentSpeed) {this.avgCurrentSpeed = avgCurrentSpeed;}

    public Double getAvgFreeflowSpeed() {return avgFreeflowSpeed;}
    public void setAvgFreeflowSpeed(Double avgFreeflowSpeed) {this.avgFreeflowSpeed = avgFreeflowSpeed;}

    public Double getMinCurrentSpeed() {return minCurrentSpeed;}
    public void setMinCurrentSpeed(Double minCurrentSpeed) {this.minCurrentSpeed = minCurrentSpeed;}

    public Double getConfidence() {return confidence;}
    public void setConfidence(Double confidence) {this.confidence = confidence;}

    public String getSourceMode() { return sourceMode; }
    public void setSourceMode(String sourceMode) { this.sourceMode = sourceMode; }

    public Integer getSpeedSampleCount() { return speedSampleCount; }
    public void setSpeedSampleCount(Integer speedSampleCount) { this.speedSampleCount = speedSampleCount; }

    public Double getSpeedStddev() { return speedStddev; }
    public void setSpeedStddev(Double speedStddev) { this.speedStddev = speedStddev; }

    public Double getP10Speed() { return p10Speed; }
    public void setP10Speed(Double p10Speed) { this.p10Speed = p10Speed; }

    public Double getP50Speed() { return p50Speed; }
    public void setP50Speed(Double p50Speed) { this.p50Speed = p50Speed; }

    public Double getP90Speed() { return p90Speed; }
    public void setP90Speed(Double p90Speed) { this.p90Speed = p90Speed; }

    public Integer getIncidentCount() { return incidentCount; }
    public void setIncidentCount(Integer incidentCount) { this.incidentCount = incidentCount; }

    public String getCorridor() {return corridor;}
    public void setCorridor(String corridor) {this.corridor = corridor;}

    public String getIncidentsJson() {return incidentsJson;}
    public void setIncidentsJson(String incidentsJson) {this.incidentsJson = incidentsJson;}

    public OffsetDateTime getPolledAt() {return polledAt;}

    public void setPolledAt(OffsetDateTime polledAt) {this.polledAt = polledAt;}

    public OffsetDateTime getIngestedAt() { return ingestedAt; }
    public void setIngestedAt(OffsetDateTime ingestedAt) { this.ingestedAt = ingestedAt; }
}
