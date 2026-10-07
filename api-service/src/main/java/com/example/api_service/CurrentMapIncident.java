package com.example.api_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Objects;

final class CurrentMapIncident {

    private final CurrentIncidentProjection incident;
    private final JsonNode properties;

    CurrentMapIncident(CurrentIncidentProjection incident, ObjectMapper objectMapper) {
        this.incident = Objects.requireNonNull(incident);
        this.properties = properties(incident.getRawEventJson(), Objects.requireNonNull(objectMapper));
    }

    public Long getHistoryId() { return incident.getEventId(); }
    public Long getIncidentRefId() { return incident.getEventId(); }
    public Long getSampleRefId() { return null; }
    public String getCorridor() { return incident.getCorridor(); }
    public String getRoadNumber() { return incident.getRoadNumber(); }
    public Integer getIconCategory() { return integer("iconCategory"); }
    public String getIncidentDescription() { return incident.getIncidentDescription(); }
    public Integer getDelaySeconds() {
        Integer delay = integer("delaySeconds");
        return delay == null ? integer("delay") : delay;
    }
    public String getGeometryType() { return incident.getGeometryType(); }
    public String getGeometryJson() { return incident.getGeometryJson(); }
    public String getTravelDirection() { return incident.getTravelDirection(); }
    public Double getClosestMileMarker() { return incident.getClosestMileMarker(); }
    public String getMileMarkerMethod() { return incident.getMileMarkerMethod(); }
    public Double getMileMarkerConfidence() { return incident.getMileMarkerConfidence(); }
    public Double getDistanceToCorridorMeters() { return incident.getDistanceToCorridorMeters(); }
    public String getLocationLabel() { return incident.getLocationLabel(); }
    public Double getCentroidLat() { return incident.getCentroidLat(); }
    public Double getCentroidLon() { return incident.getCentroidLon(); }
    public String getIncidentProvider() { return incident.getProvider(); }
    public String getIncidentProduct() { return incident.getProduct(); }
    public String getProviderEventId() { return incident.getProviderEventId(); }
    public String getNormalizedStatus() { return incident.getNormalizedStatus(); }
    public String getNormalizedCategory() { return incident.getNormalizedCategory(); }
    public OffsetDateTime getSourceUpdatedAt() { return utc(incident.getSourceUpdatedAt()); }
    public OffsetDateTime getFirstSeenAt() { return utc(incident.getFirstSeenAt()); }
    public OffsetDateTime getLastSeenAt() { return utc(incident.getLastSeenAt()); }
    public OffsetDateTime getPolledAt() { return getLastSeenAt(); }
    public OffsetDateTime getNormalizedAt() { return null; }
    public OffsetDateTime getArchivedAt() { return null; }
    public Boolean getIsArchived() { return false; }

    private Integer integer(String fieldName) {
        JsonNode value = properties.path(fieldName);
        return value.isIntegralNumber() ? value.intValue() : null;
    }

    private static JsonNode properties(String rawEventJson, ObjectMapper objectMapper) {
        if (rawEventJson == null || rawEventJson.isBlank()) {
            return objectMapper.createObjectNode();
        }
        try {
            JsonNode parsed = objectMapper.readTree(rawEventJson).path("properties");
            return parsed.isObject() ? parsed : objectMapper.createObjectNode();
        } catch (Exception ignored) {
            return objectMapper.createObjectNode();
        }
    }

    private static OffsetDateTime utc(Instant value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
    }
}
