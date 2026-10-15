package com.example.ingest_service;

import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;

@Component
public class CdotVariableSpeedClient {
    private final WebClient http;

    public CdotVariableSpeedClient(@Qualifier("cdotWebClient") WebClient http) {
        this.http = http.mutate().codecs(codecs -> codecs.defaultCodecs().maxInMemorySize(16_384)).build();
    }

    public Mono<VariableSpeedSign> fetch(String key, I70VariableSpeedSigns.Device device, Instant fetchedAt) {
        if (key == null || key.isBlank()) return Mono.error(new IllegalStateException("CDOT key unavailable"));
        if (device == null || !device.equals(I70VariableSpeedSigns.device(device.id()))) {
            return Mono.error(new IllegalArgumentException("Sign is outside the monitored catalog"));
        }
        return http.get().uri(builder -> builder.path("/api/v1/signs")
                .queryParam("apiKey", key).queryParam("id", device.id()).queryParam("limit", 2).build())
            .retrieve().bodyToMono(JsonNode.class).timeout(Duration.ofSeconds(10))
            .map(body -> map(body, device, fetchedAt))
            // Provider exceptions can embed the credential-bearing request URL.
            .onErrorMap(error -> new IllegalStateException(error instanceof WebClientResponseException response
                && response.getStatusCode().isError()
                    ? "Scoped CDOT sign read failed (HTTP " + response.getStatusCode().value() + ")"
                    : "Scoped CDOT sign read failed; verify the response and connection"));
    }

    static VariableSpeedSign map(JsonNode body, I70VariableSpeedSigns.Device device, Instant fetchedAt) {
        JsonNode features = body.path("features");
        if (!"FeatureCollection".equals(body.path("type").asText()) || !features.isArray() || features.size() > 1) {
            throw new IllegalArgumentException("Expected one scoped sign or an empty feature collection");
        }
        if (features.isEmpty()) {
            VariableSpeedSign empty = VariableSpeedSign.unobserved(device);
            return new VariableSpeedSign(empty.id(), empty.mileMarker(), empty.direction(), empty.longitude(),
                empty.latitude(), empty.location(), empty.regularLimitMph(), null, "UNAVAILABLE", null, null,
                null, null, fetchedAt, fetchedAt);
        }
        JsonNode properties = features.get(0).path("properties");
        String route = properties.path("routeName").asText("").toUpperCase(Locale.ROOT);
        String direction = normalizeDirection(properties.path("direction").asText(""));
        double marker = properties.path("marker").asDouble(Double.NaN);
        if (!device.id().equals(properties.path("id").asText())
            || !route.equals("EAST".equals(device.direction()) ? "I-70E" : "I-70W")
            || !device.direction().equals(direction) || !Double.isFinite(marker)
            || marker < I70VariableSpeedSigns.START_MARKER || marker > I70VariableSpeedSigns.END_MARKER
            || Math.abs(marker - device.mileMarker()) > 0.15) {
            throw new IllegalArgumentException("Scoped response does not match the monitored sign");
        }
        String display = properties.path("displayStatus").asText("").toLowerCase(Locale.ROOT);
        String communication = properties.path("communicationStatus").asText("").toLowerCase(Locale.ROOT);
        String message = properties.path("messageText").asText("").trim();
        Integer speed = number(properties.get("speed"));
        Integer messageSpeed = message.matches("[0-9]{1,3}") ? Integer.valueOf(message) : null;
        if (speed == null) speed = messageSpeed;
        if (speed != null && (speed < 5 || speed > 85 || (messageSpeed != null && !speed.equals(messageSpeed)))) speed = null;
        String status = java.util.List.of("error", "communication error").contains(communication) ? "COMMUNICATION_ERROR"
            : !"operational".equals(communication) || !"on".equals(display) || speed == null ? "UNAVAILABLE" : "AVAILABLE";
        return new VariableSpeedSign(device.id(), device.mileMarker(), direction, device.longitude(),
            device.latitude(), device.location(), device.regularLimitMph(), speed, status, display, communication,
            timestamp(properties.get("lastUpdated")), timestamp(properties.get("activationTime")), fetchedAt, fetchedAt);
    }

    private static Integer number(JsonNode value) {
        if (value == null || value.isNull()) return null;
        String text = value.asText("");
        return text.matches("[0-9]{1,3}") ? Integer.valueOf(text) : null;
    }

    private static Instant timestamp(JsonNode value) {
        if (value == null || value.isNull()) return null;
        try { return Instant.parse(value.asText()); } catch (java.time.format.DateTimeParseException error) { return null; }
    }

    private static String normalizeDirection(String direction) {
        return switch (direction.toLowerCase(Locale.ROOT)) {
            case "e", "east", "eastbound" -> "EAST";
            case "w", "west", "westbound" -> "WEST";
            default -> "UNKNOWN";
        };
    }
}
