package com.example.traffic_backend;

import org.springframework.boot.context.properties.ConfigurationProperties;
import java.util.List;

@ConfigurationProperties(prefix = "traffic")
public record TrafficProps(String tomtomApiKey, int pollSeconds, List<Corridor> corridors) {
    public record Corridor(String name, String bbox) {}
}
