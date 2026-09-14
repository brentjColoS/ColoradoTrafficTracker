package com.example.api_service.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record OperationalStatusDto(
    String status,
    OffsetDateTime checkedAt,
    String summary,
    List<OperationalCheckDto> checks
) {}
