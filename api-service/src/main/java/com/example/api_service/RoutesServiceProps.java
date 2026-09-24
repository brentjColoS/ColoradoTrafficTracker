package com.example.api_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "routes")
public record RoutesServiceProps(String baseUrl) {
    public RoutesServiceProps {
        if (baseUrl == null || baseUrl.isBlank()) baseUrl = "http://localhost:8081";
    }
}
