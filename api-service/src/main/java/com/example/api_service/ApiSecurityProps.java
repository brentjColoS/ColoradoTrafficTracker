package com.example.api_service;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "api.security")
public record ApiSecurityProps(
    boolean enabled,
    String keys
) {
    public Set<String> keySet() {
        if (keys == null || keys.isBlank()) return Set.of();
        return Arrays.stream(keys.split(","))
            .map(String::trim)
            .filter(s -> !s.isBlank())
            .collect(Collectors.toUnmodifiableSet());
    }
}
