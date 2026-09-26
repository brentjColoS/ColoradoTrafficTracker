package com.example.api_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

final class CurrentMapIncident {

    private final CurrentIncidentProjection incident;
    private final JsonNode properties;

    CurrentMapIncident(CurrentIncidentProjection incident, ObjectMapper objectMapper) {
        this.incident = Objects.requireNonNull(incident);
        this.properties = properties(incident.getRawEventJson(), Objects.requireNonNull(objectMapper));
    }

    public Long getHistoryId() { return incident.getEventId(); }
    public boolean isActive() { return !Boolean.FALSE.equals(incident.getActive()); }
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
    public String getSourceType() { return text("sourceType"); }
    public String getSourceSeverity() { return text("sourceSeverity"); }
    public OffsetDateTime getSourceStartedAt() { return utc(incident.getSourceStartedAt()); }
    public OffsetDateTime getSourceEndedAt() { return utc(incident.getSourceEndedAt()); }
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

    public List<String> getLaneImpactLabels() {
        List<String> labels = new ArrayList<>();
        for (JsonNode impact : properties.path("laneImpacts")) {
            JsonNode closedLanes = impact.path("closedLaneTypes");
            if (!closedLanes.isArray() || closedLanes.isEmpty()) continue;
            List<String> lanes = new ArrayList<>();
            closedLanes.forEach(lane -> {
                if (lane.isTextual() && !lane.textValue().isBlank()) lanes.add(lane.textValue().trim());
            });
            if (lanes.isEmpty()) continue;
            String direction = impact.path("direction").asText("").trim();
            String prefix = direction.isBlank() ? ""
                : direction.toLowerCase().endsWith("bound") ? direction + ": " : direction + "bound: ";
            labels.add(prefix + String.join(" and ", lanes) + " closed");
        }
        return labels;
    }

    public List<String> getAdditionalImpactLabels() {
        List<String> labels = new ArrayList<>();
        for (JsonNode impact : properties.path("additionalImpacts")) {
            if (impact.isTextual() && !impact.textValue().isBlank()) labels.add(impact.textValue().trim());
        }
        return labels;
    }

    private String text(String fieldName) {
        JsonNode value = properties.path(fieldName);
        return value.isTextual() && !value.textValue().isBlank() ? value.textValue().trim() : null;
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
