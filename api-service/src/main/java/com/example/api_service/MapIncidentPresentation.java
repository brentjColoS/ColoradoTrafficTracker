package com.example.api_service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class MapIncidentPresentation {
    private MapIncidentPresentation() {}

    static String directionLabel(String direction) {
        String normalized = normalizeDirection(direction);
        if (normalized == null) return null;
        return switch (normalized) {
            case "N" -> "northbound";
            case "S" -> "southbound";
            case "E" -> "eastbound";
            case "W" -> "westbound";
            default -> null;
        };
    }

    private static String normalizeDirection(String direction) {
        if (direction == null || direction.isBlank()) return null;
        return direction.trim().toUpperCase(Locale.ROOT);
    }

    static String referenceKey(CurrentMapIncident incident) {
        if (incident.getProviderEventId() != null && !incident.getProviderEventId().isBlank()) {
            String provider = incident.getIncidentProvider() == null || incident.getIncidentProvider().isBlank()
                ? "unknown"
                : incident.getIncidentProvider().trim().toLowerCase(Locale.ROOT);
            return provider + "|" + incident.getProviderEventId().trim();
        }
        String corridor = incident.getCorridor() == null ? "UNKNOWN" : incident.getCorridor();
        String mileMarker = incident.getClosestMileMarker() == null
            ? "MM?"
            : String.format(Locale.US, "MM%.1f", incident.getClosestMileMarker());
        String direction = normalizeDirection(incident.getTravelDirection());
        return corridor + "|" + mileMarker + "|" + (direction == null ? "?" : direction);
    }

    static String referenceLabel(CurrentMapIncident incident) {
        if (incident.getLocationLabel() != null && !incident.getLocationLabel().isBlank()) {
            return incident.getLocationLabel();
        }
        String corridor = incident.getRoadNumber() != null && !incident.getRoadNumber().isBlank()
            ? incident.getRoadNumber()
            : incident.getCorridor();
        String direction = directionLabel(incident.getTravelDirection());
        if (incident.getClosestMileMarker() != null && direction != null) {
            return String.format(Locale.US, "%s %s near MM %.1f", corridor, direction, incident.getClosestMileMarker());
        }
        if (incident.getClosestMileMarker() != null) {
            return String.format(Locale.US, "%s near MM %.1f", corridor, incident.getClosestMileMarker());
        }
        return corridor;
    }

    static String incidentDisplayLabel(CurrentMapIncident incident) {
        String description = incidentDescription(incident);
        String reference = referenceLabel(incident);
        if (description != null && !description.isBlank()) {
            if (reference != null && !reference.isBlank()) {
                return sentenceCase(description) + " at " + reference;
            }
            return sentenceCase(description);
        }

        String type = incidentTypeLabel(incident);
        if (type != null && !type.isBlank()) {
            if (reference != null && !reference.isBlank()) {
                return type + " at " + reference;
            }
            return type;
        }
        return reference;
    }

    static String incidentDescription(CurrentMapIncident incident) {
        String description = incident.getIncidentDescription();
        if (description != null && !description.isBlank()) {
            return "cdot".equals(incident.getIncidentProvider()) ? description.trim() : readableIncidentDescription(description);
        }
        return incidentTypeLabel(incident);
    }

    static String incidentImpactLabel(CurrentMapIncident incident) {
        List<String> impacts = new ArrayList<>();
        for (String laneImpact : incident.getLaneImpactLabels()) {
            impacts.add(sentenceCase(laneImpact));
        }
        for (String additionalImpact : incident.getAdditionalImpactLabels()) {
            String normalized = additionalImpact.trim().toLowerCase(Locale.ROOT);
            impacts.add(switch (normalized) {
                case "cmv involved" -> "Commercial vehicle involved";
                case "express lane closure" -> "Express lane closed";
                default -> sentenceCase(additionalImpact);
            });
        }
        return impacts.isEmpty() ? null : String.join(" · ", impacts.stream().distinct().toList());
    }

    static String incidentNote(CurrentMapIncident incident) {
        String description = incident.getIncidentDescription();
        if (description == null || description.isBlank()) return null;
        String sourceType = incident.getSourceType();
        String impact = incidentImpactLabel(incident);
        String normalizedImpact = impact == null ? "" : comparisonText(impact);
        for (String sentence : description.trim().split("(?<=[.!?])\\s+")) {
            String candidate = sentence.trim();
            if (candidate.isBlank()) continue;
            String normalized = candidate.toLowerCase(Locale.ROOT);
            if (sourceType != null && normalized.equals(sourceType.trim().toLowerCase(Locale.ROOT))) continue;
            if ((normalized.startsWith("between ") || normalized.startsWith("at ") || normalized.startsWith("from "))
                && normalized.contains("mile point")) continue;
            if (normalized.contains("roadway is reopened to traffic")) continue;
            String comparableCandidate = comparisonText(candidate).replace(" is ", " ");
            if (!normalizedImpact.isBlank() && normalizedImpact.contains(comparableCandidate)) continue;
            return sentenceCase(candidate);
        }
        return null;
    }

    private static String comparisonText(String value) {
        return value.toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9 ]", "")
            .replaceAll("\\b(the|a|an)\\b", "")
            .replaceAll("\\s+", " ")
            .trim();
    }

    private static String readableIncidentDescription(String description) {
        if (description == null || description.isBlank()) return null;
        String normalized = description.trim().replace('_', ' ').replace('-', ' ');
        normalized = normalized.replaceAll("\\s+", " ");
        String key = normalized.toLowerCase(Locale.ROOT);
        return switch (key) {
            case "roadworks", "road work", "roadwork" -> "Road works";
            case "cluster" -> "Incident cluster";
            case "heavy traffic" -> "Heavy traffic";
            case "stationary traffic" -> "Stationary traffic";
            case "slow traffic" -> "Slow traffic";
            case "queueing traffic", "queuing traffic" -> "Queueing traffic";
            case "broken down vehicle", "broken vehicle" -> "Broken down vehicle";
            default -> sentenceCase(normalized);
        };
    }

    static String incidentTypeLabel(Integer iconCategory) {
        if (iconCategory == null) return null;
        return switch (iconCategory) {
            case 0 -> "Unknown";
            case 1 -> "Accident";
            case 2 -> "Fog";
            case 3 -> "Dangerous conditions";
            case 4 -> "Rain";
            case 5 -> "Ice";
            case 6 -> "Traffic jam";
            case 7 -> "Lane closed";
            case 8 -> "Road closed";
            case 9 -> "Road works";
            case 10 -> "Wind";
            case 11 -> "Flooding";
            case 13 -> "Incident cluster";
            case 14 -> "Broken down vehicle";
            default -> "Incident type " + iconCategory;
        };
    }

    static String incidentTypeLabel(CurrentMapIncident incident) {
        if (incident != null && incident.getSourceType() != null
            && !incident.getSourceType().equalsIgnoreCase("other")) {
            return switch (incident.getSourceType().trim().toLowerCase(Locale.ROOT)) {
                case "2 vehicle crash" -> "Two-vehicle crash";
                case "3+ vehicle crash" -> "Multi-vehicle crash";
                case "it or fiber optics" -> "IT or fiber-optic work";
                default -> sentenceCase(incident.getSourceType());
            };
        }
        if (incident != null && incident.getNormalizedCategory() != null
            && !incident.getNormalizedCategory().isBlank()) {
            return switch (incident.getNormalizedCategory().trim().toLowerCase(Locale.ROOT)) {
                case "crash" -> "Crash";
                case "construction" -> "Road work";
                case "closure" -> "Road closure";
                case "traffic" -> "Traffic";
                case "weather" -> "Weather";
                case "outside_agency_activity" -> "Outside agency activity";
                case "its_work" -> "ITS work";
                default -> sentenceCase(incident.getNormalizedCategory().replace('_', ' '));
            };
        }
        return incidentTypeLabel(incident == null ? null : incident.getIconCategory());
    }

    private static String sentenceCase(String value) {
        if (value == null || value.isBlank()) return value;
        String trimmed = value.trim();
        return trimmed.substring(0, 1).toUpperCase(Locale.ROOT) + trimmed.substring(1);
    }

}
