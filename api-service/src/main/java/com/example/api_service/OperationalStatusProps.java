package com.example.api_service;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "operations.status")
public record OperationalStatusProps(
    List<String> corridors,
    int flowStaleAfterMinutes,
    int incidentStaleAfterMinutes,
    int providerStaleAfterMinutes
) {}
