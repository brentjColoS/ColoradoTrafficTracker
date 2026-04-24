package com.example.api_service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

@Entity
@Table(name = "traffic_sample_all")
public class TrafficHistorySample {
    @Id
    @Column(name = "history_id")
    private Long historyId;

    @Column(name = "sample_ref_id")
    private Long sampleRefId;

    @Column(nullable = false)
    private String corridor;

    @Column(name = "avg_current_speed")
    private Double avgCurrentSpeed;
    @Column(name = "avg_freeflow_speed")
    private Double avgFreeflowSpeed;
    @Column(name = "min_current_speed")
    private Double minCurrentSpeed;
    private Double confidence;

    @Column(name = "source_mode", nullable = false)
    private String sourceMode;

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
    private Integer incidentCount;

    @Column(name = "incidents_json", columnDefinition = "text")
    private String incidentsJson;

    @Column(name = "validation_requested_points")
    private Integer validationRequestedPoints;

    @Column(name = "validation_returned_points")
    private Integer validationReturnedPoints;

    @Column(name = "validation_coverage_ratio")
    private Double validationCoverageRatio;

    @Column(name = "validation_used", nullable = false)
    private Boolean validationUsed;

    @Column(name = "degraded", nullable = false)
    private Boolean degraded;

    @Column(name = "degraded_reason")
    private String degradedReason;

    @Column(name = "polled_at", nullable = false)
    private OffsetDateTime polledAt;

    @Column(name = "ingested_at", nullable = false)
    private OffsetDateTime ingestedAt;

    @Column(name = "archived_at")
    private OffsetDateTime archivedAt;

    @Column(name = "is_archived", nullable = false)
    private Boolean isArchived;

    public Long getHistoryId() { return historyId; }
    public void setHistoryId(Long historyId) { this.historyId = historyId; }

    public Long getSampleRefId() { return sampleRefId; }
    public void setSampleRefId(Long sampleRefId) { this.sampleRefId = sampleRefId; }

    public String getCorridor() { return corridor; }
    public void setCorridor(String corridor) { this.corridor = corridor; }

    public Double getAvgCurrentSpeed() { return avgCurrentSpeed; }
    public void setAvgCurrentSpeed(Double avgCurrentSpeed) { this.avgCurrentSpeed = avgCurrentSpeed; }

    public Double getAvgFreeflowSpeed() { return avgFreeflowSpeed; }
    public void setAvgFreeflowSpeed(Double avgFreeflowSpeed) { this.avgFreeflowSpeed = avgFreeflowSpeed; }

    public Double getMinCurrentSpeed() { return minCurrentSpeed; }
    public void setMinCurrentSpeed(Double minCurrentSpeed) { this.minCurrentSpeed = minCurrentSpeed; }

    public Double getConfidence() { return confidence; }
    public void setConfidence(Double confidence) { this.confidence = confidence; }

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

    public String getIncidentsJson() { return incidentsJson; }
    public void setIncidentsJson(String incidentsJson) { this.incidentsJson = incidentsJson; }

    public Integer getValidationRequestedPoints() { return validationRequestedPoints; }
    public void setValidationRequestedPoints(Integer validationRequestedPoints) { this.validationRequestedPoints = validationRequestedPoints; }

    public Integer getValidationReturnedPoints() { return validationReturnedPoints; }
    public void setValidationReturnedPoints(Integer validationReturnedPoints) { this.validationReturnedPoints = validationReturnedPoints; }

    public Double getValidationCoverageRatio() { return validationCoverageRatio; }
    public void setValidationCoverageRatio(Double validationCoverageRatio) { this.validationCoverageRatio = validationCoverageRatio; }

    public Boolean getValidationUsed() { return validationUsed; }
    public void setValidationUsed(Boolean validationUsed) { this.validationUsed = validationUsed; }

    public Boolean getDegraded() { return degraded; }
    public void setDegraded(Boolean degraded) { this.degraded = degraded; }

    public String getDegradedReason() { return degradedReason; }
    public void setDegradedReason(String degradedReason) { this.degradedReason = degradedReason; }

    public OffsetDateTime getPolledAt() { return polledAt; }
    public void setPolledAt(OffsetDateTime polledAt) { this.polledAt = polledAt; }

    public OffsetDateTime getIngestedAt() { return ingestedAt; }
    public void setIngestedAt(OffsetDateTime ingestedAt) { this.ingestedAt = ingestedAt; }

    public OffsetDateTime getArchivedAt() { return archivedAt; }
    public void setArchivedAt(OffsetDateTime archivedAt) { this.archivedAt = archivedAt; }

    public Boolean getIsArchived() { return isArchived; }
    public void setIsArchived(Boolean archived) { isArchived = archived; }
}
