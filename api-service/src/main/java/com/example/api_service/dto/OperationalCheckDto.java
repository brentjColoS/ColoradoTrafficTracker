package com.example.api_service.dto;

import java.time.OffsetDateTime;

public record OperationalCheckDto(
    String component,
    String status,
    String code,
    String message,
    OffsetDateTime observedAt,
    Integer ageMinutes,
    Integer thresholdMinutes,
    String suggestedAction
) {}
