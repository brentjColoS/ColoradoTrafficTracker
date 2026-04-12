package com.example.ingest_service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

@Entity
@Table(name = "corridor_ref")
public class CorridorRef {
    @Id
    private String code;

    @Column(nullable = false)
    private String displayName;

    private String roadNumber;
    private String primaryDirection;
    private String secondaryDirection;
    private Double startMileMarker;
    private Double endMileMarker;

    @Column(nullable = false)
    private String bbox;

    private Double centerLat;
    private Double centerLon;

    @Column(columnDefinition = "text")
    private String geometryJson;

    @Column(nullable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now(ZoneOffset.UTC);

    @Column(nullable = false)
    private OffsetDateTime updatedAt = OffsetDateTime.now(ZoneOffset.UTC);

    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }

    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }

    public String getRoadNumber() { return roadNumber; }
    public void setRoadNumber(String roadNumber) { this.roadNumber = roadNumber; }

    public String getPrimaryDirection() { return primaryDirection; }
    public void setPrimaryDirection(String primaryDirection) { this.primaryDirection = primaryDirection; }

    public String getSecondaryDirection() { return secondaryDirection; }
    public void setSecondaryDirection(String secondaryDirection) { this.secondaryDirection = secondaryDirection; }

    public Double getStartMileMarker() { return startMileMarker; }
    public void setStartMileMarker(Double startMileMarker) { this.startMileMarker = startMileMarker; }

    public Double getEndMileMarker() { return endMileMarker; }
    public void setEndMileMarker(Double endMileMarker) { this.endMileMarker = endMileMarker; }

    public String getBbox() { return bbox; }
    public void setBbox(String bbox) { this.bbox = bbox; }

    public Double getCenterLat() { return centerLat; }
    public void setCenterLat(Double centerLat) { this.centerLat = centerLat; }

    public Double getCenterLon() { return centerLon; }
    public void setCenterLon(Double centerLon) { this.centerLon = centerLon; }

    public String getGeometryJson() { return geometryJson; }
    public void setGeometryJson(String geometryJson) { this.geometryJson = geometryJson; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
