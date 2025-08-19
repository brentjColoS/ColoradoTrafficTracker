package com.example.traffic_backend;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

@Entity
@Table(name = "traffic_sample")
public class TrafficSample {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable=false) private String corridor;
    private Double avgCurrentSpeed;
    private Double avgFreeflowSpeed;
    private Double minCurrentSpeed;
    private Double confidence;              // average across sampled points

    @Column(columnDefinition = "text")
    private String incidentsJson;

    @Column(nullable=false)
    private OffsetDateTime polledAt = OffsetDateTime.now(ZoneOffset.UTC);

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

    public String getCorridor() {return corridor;}
    public void setCorridor(String corridor) {this.corridor = corridor;}

    public String getIncidentsJson() {return incidentsJson;}
    public void setIncidentsJson(String incidentsJson) {this.incidentsJson = incidentsJson;}

    public OffsetDateTime getPolledAt() {return polledAt;}

    public void setPolledAt(OffsetDateTime polledAt) {this.polledAt = polledAt;}
}
