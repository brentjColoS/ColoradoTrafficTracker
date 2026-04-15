package com.example.api_service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;

@Entity
@Table(name = "traffic_incident_all")
public class TrafficHistoryIncident {
    @Id
    @Column(name = "history_id")
    private Long historyId;

    @Column(name = "incident_ref_id")
    private Long incidentRefId;
    @Column(name = "sample_ref_id")
    private Long sampleRefId;

    @Column(nullable = false)
    private String corridor;

    @Column(name = "road_number")
    private String roadNumber;
    @Column(name = "icon_category")
    private Integer iconCategory;
    @Column(name = "delay_seconds")
    private Integer delaySeconds;
    @Column(name = "geometry_type")
    private String geometryType;

    @Column(name = "geometry_json", columnDefinition = "text")
    private String geometryJson;

    @Column(name = "travel_direction")
    private String travelDirection;
    @Column(name = "closest_mile_marker")
    private Double closestMileMarker;
    @Column(name = "location_label")
    private String locationLabel;
    @Column(name = "centroid_lat")
    private Double centroidLat;
    @Column(name = "centroid_lon")
    private Double centroidLon;
    @Column(name = "polled_at")
    private OffsetDateTime polledAt;
    @Column(name = "normalized_at")
    private OffsetDateTime normalizedAt;
    @Column(name = "archived_at")
    private OffsetDateTime archivedAt;
    @Column(name = "is_archived")
    private Boolean isArchived;

    public Long getHistoryId() { return historyId; }
    public void setHistoryId(Long historyId) { this.historyId = historyId; }

    public Long getIncidentRefId() { return incidentRefId; }
    public void setIncidentRefId(Long incidentRefId) { this.incidentRefId = incidentRefId; }

    public Long getSampleRefId() { return sampleRefId; }
    public void setSampleRefId(Long sampleRefId) { this.sampleRefId = sampleRefId; }

    public String getCorridor() { return corridor; }
    public void setCorridor(String corridor) { this.corridor = corridor; }

    public String getRoadNumber() { return roadNumber; }
    public void setRoadNumber(String roadNumber) { this.roadNumber = roadNumber; }

    public Integer getIconCategory() { return iconCategory; }
    public void setIconCategory(Integer iconCategory) { this.iconCategory = iconCategory; }

    public Integer getDelaySeconds() { return delaySeconds; }
    public void setDelaySeconds(Integer delaySeconds) { this.delaySeconds = delaySeconds; }

    public String getGeometryType() { return geometryType; }
    public void setGeometryType(String geometryType) { this.geometryType = geometryType; }

    public String getGeometryJson() { return geometryJson; }
    public void setGeometryJson(String geometryJson) { this.geometryJson = geometryJson; }

    public String getTravelDirection() { return travelDirection; }
    public void setTravelDirection(String travelDirection) { this.travelDirection = travelDirection; }

    public Double getClosestMileMarker() { return closestMileMarker; }
    public void setClosestMileMarker(Double closestMileMarker) { this.closestMileMarker = closestMileMarker; }

    public String getLocationLabel() { return locationLabel; }
    public void setLocationLabel(String locationLabel) { this.locationLabel = locationLabel; }

    public Double getCentroidLat() { return centroidLat; }
    public void setCentroidLat(Double centroidLat) { this.centroidLat = centroidLat; }

    public Double getCentroidLon() { return centroidLon; }
    public void setCentroidLon(Double centroidLon) { this.centroidLon = centroidLon; }

    public OffsetDateTime getPolledAt() { return polledAt; }
    public void setPolledAt(OffsetDateTime polledAt) { this.polledAt = polledAt; }

    public OffsetDateTime getNormalizedAt() { return normalizedAt; }
    public void setNormalizedAt(OffsetDateTime normalizedAt) { this.normalizedAt = normalizedAt; }

    public OffsetDateTime getArchivedAt() { return archivedAt; }
    public void setArchivedAt(OffsetDateTime archivedAt) { this.archivedAt = archivedAt; }

    public Boolean getIsArchived() { return isArchived; }
    public void setIsArchived(Boolean archived) { isArchived = archived; }
}
