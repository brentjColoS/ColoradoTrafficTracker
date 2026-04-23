package com.example.ingest_service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

@Entity
@Table(name = "traffic_incident")
public class TrafficIncident {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sample_id", nullable = false)
    private TrafficSample sample;

    @Column(nullable = false)
    private String corridor;

    @Column(name = "road_number")
    private String roadNumber;
    @Column(name = "icon_category")
    private Integer iconCategory;
    @Column(name = "incident_description", columnDefinition = "text")
    private String incidentDescription;
    @Column(name = "delay_seconds")
    private Integer delaySeconds;
    @Column(name = "geometry_type")
    private String geometryType;
    @Column(name = "travel_direction")
    private String travelDirection;
    @Column(name = "closest_mile_marker")
    private Double closestMileMarker;
    @Column(name = "mile_marker_method")
    private String mileMarkerMethod;
    @Column(name = "mile_marker_confidence")
    private Double mileMarkerConfidence;
    @Column(name = "distance_to_corridor_meters")
    private Double distanceToCorridorMeters;
    @Column(name = "location_label")
    private String locationLabel;
    @Column(name = "centroid_lat")
    private Double centroidLat;
    @Column(name = "centroid_lon")
    private Double centroidLon;

    @Column(name = "geometry_json", columnDefinition = "text")
    private String geometryJson;

    @Column(name = "polled_at", nullable = false)
    private OffsetDateTime polledAt;

    @Column(name = "normalized_at", nullable = false)
    private OffsetDateTime normalizedAt = OffsetDateTime.now(ZoneOffset.UTC);

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public TrafficSample getSample() { return sample; }
    public void setSample(TrafficSample sample) { this.sample = sample; }

    public String getCorridor() { return corridor; }
    public void setCorridor(String corridor) { this.corridor = corridor; }

    public String getRoadNumber() { return roadNumber; }
    public void setRoadNumber(String roadNumber) { this.roadNumber = roadNumber; }

    public Integer getIconCategory() { return iconCategory; }
    public void setIconCategory(Integer iconCategory) { this.iconCategory = iconCategory; }

    public String getIncidentDescription() { return incidentDescription; }
    public void setIncidentDescription(String incidentDescription) { this.incidentDescription = incidentDescription; }

    public Integer getDelaySeconds() { return delaySeconds; }
    public void setDelaySeconds(Integer delaySeconds) { this.delaySeconds = delaySeconds; }

    public String getGeometryType() { return geometryType; }
    public void setGeometryType(String geometryType) { this.geometryType = geometryType; }

    public String getTravelDirection() { return travelDirection; }
    public void setTravelDirection(String travelDirection) { this.travelDirection = travelDirection; }

    public Double getClosestMileMarker() { return closestMileMarker; }
    public void setClosestMileMarker(Double closestMileMarker) { this.closestMileMarker = closestMileMarker; }

    public String getMileMarkerMethod() { return mileMarkerMethod; }
    public void setMileMarkerMethod(String mileMarkerMethod) { this.mileMarkerMethod = mileMarkerMethod; }

    public Double getMileMarkerConfidence() { return mileMarkerConfidence; }
    public void setMileMarkerConfidence(Double mileMarkerConfidence) { this.mileMarkerConfidence = mileMarkerConfidence; }

    public Double getDistanceToCorridorMeters() { return distanceToCorridorMeters; }
    public void setDistanceToCorridorMeters(Double distanceToCorridorMeters) { this.distanceToCorridorMeters = distanceToCorridorMeters; }

    public String getLocationLabel() { return locationLabel; }
    public void setLocationLabel(String locationLabel) { this.locationLabel = locationLabel; }

    public Double getCentroidLat() { return centroidLat; }
    public void setCentroidLat(Double centroidLat) { this.centroidLat = centroidLat; }

    public Double getCentroidLon() { return centroidLon; }
    public void setCentroidLon(Double centroidLon) { this.centroidLon = centroidLon; }

    public String getGeometryJson() { return geometryJson; }
    public void setGeometryJson(String geometryJson) { this.geometryJson = geometryJson; }

    public OffsetDateTime getPolledAt() { return polledAt; }
    public void setPolledAt(OffsetDateTime polledAt) { this.polledAt = polledAt; }

    public OffsetDateTime getNormalizedAt() { return normalizedAt; }
    public void setNormalizedAt(OffsetDateTime normalizedAt) { this.normalizedAt = normalizedAt; }
}
