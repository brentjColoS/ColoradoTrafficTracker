package com.example.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

public final class I70VariableSpeedSigns {
    public static final double START_MARKER = 206;
    public static final double END_MARKER = 274;
    private static final List<Device> DEVICES = load();
    private static final Map<String, Device> BY_ID = DEVICES.stream()
        .collect(Collectors.toUnmodifiableMap(Device::id, Function.identity()));

    private I70VariableSpeedSigns() {}

    public static List<Device> devices() { return DEVICES; }
    public static Device device(String id) { return BY_ID.get(id); }

    private static List<Device> load() {
        try (InputStream input = I70VariableSpeedSigns.class.getResourceAsStream("/i70-variable-speed-signs.json")) {
            if (input == null) throw new IllegalStateException("I-70 sign catalog is missing");
            List<Device> devices = new ObjectMapper().readValue(input, new TypeReference<List<Device>>() {});
            if (devices.isEmpty() || devices.size() > 64 || devices.stream().anyMatch(device ->
                device.id() == null || !device.id().matches("OpenTMS-Sign[0-9]+")
                || !Double.isFinite(device.mileMarker()) || device.mileMarker() < START_MARKER
                || device.mileMarker() > END_MARKER || !List.of("EAST", "WEST").contains(device.direction())
                || !Double.isFinite(device.longitude()) || !Double.isFinite(device.latitude())
                || Math.abs(device.longitude()) > 180 || Math.abs(device.latitude()) > 90)) {
                throw new IllegalStateException("Invalid I-70 sign catalog");
            }
            return List.copyOf(devices);
        } catch (java.io.IOException error) {
            throw new IllegalStateException("Cannot read I-70 sign catalog", error);
        }
    }

    public record Device(String id, double mileMarker, String direction, double longitude,
        double latitude, String location) {
        public Integer regularLimitMph() {
            SpeedZoneDefinition zone = CorridorSpeedZones.locate("I70", mileMarker);
            return zone == null ? null : zone.postedSpeedMph();
        }
    }
}
