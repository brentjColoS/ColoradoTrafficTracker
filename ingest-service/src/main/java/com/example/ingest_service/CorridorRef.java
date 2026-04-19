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

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Column(name = "road_number")
    private String roadNumber;
    @Column(name = "primary_direction")
    private String primaryDirection;
    @Column(name = "secondary_direction")
    private String secondaryDirection;
    @Column(name = "start_mile_marker")
    private Double startMileMarker;
    @Column(name = "end_mile_marker")
    private Double endMileMarker;
    @Column(name = "mile_marker_anchors_json", columnDefinition = "text")
    private String mileMarkerAnchorsJson;

    @Column(nullable = false)
    private String bbox;

    @Column(name = "center_lat")
    private Double centerLat;
    @Column(name = "center_lon")
    private Double centerLon;

    @Column(name = "geometry_json", columnDefinition = "text")
    private String geometryJson;

    @Column(name = "geometry_source", nullable = false)
    private String geometrySource = "unknown";

    @Column(name = "geometry_updated_at")
    private OffsetDateTime geometryUpdatedAt;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now(ZoneOffset.UTC);

    @Column(name = "updated_at", nullable = false)
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

    public String getMileMarkerAnchorsJson() { return mileMarkerAnchorsJson; }
    public void setMileMarkerAnchorsJson(String mileMarkerAnchorsJson) { this.mileMarkerAnchorsJson = mileMarkerAnchorsJson; }

    public String getBbox() { return bbox; }
    public void setBbox(String bbox) { this.bbox = bbox; }

    public Double getCenterLat() { return centerLat; }
    public void setCenterLat(Double centerLat) { this.centerLat = centerLat; }

    public Double getCenterLon() { return centerLon; }
    public void setCenterLon(Double centerLon) { this.centerLon = centerLon; }

    public String getGeometryJson() { return geometryJson; }
    public void setGeometryJson(String geometryJson) { this.geometryJson = geometryJson; }

    public String getGeometrySource() { return geometrySource; }
    public void setGeometrySource(String geometrySource) { this.geometrySource = geometrySource; }

    public OffsetDateTime getGeometryUpdatedAt() { return geometryUpdatedAt; }
    public void setGeometryUpdatedAt(OffsetDateTime geometryUpdatedAt) { this.geometryUpdatedAt = geometryUpdatedAt; }

    public OffsetDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(OffsetDateTime createdAt) { this.createdAt = createdAt; }

    public OffsetDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(OffsetDateTime updatedAt) { this.updatedAt = updatedAt; }
}
