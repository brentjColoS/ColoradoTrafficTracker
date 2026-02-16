package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic")
public record TrafficProps(String tomtomApiKey, int pollSeconds) {
    public static record Corridor(String name, String bbox) {}
}
