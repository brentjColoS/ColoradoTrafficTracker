package com.example.api_service.dto;

public record TrafficBaselineProfileDto(
    int dayOfWeek,
    int hourOfDay,
    String sourceProfile,
    int sampleCount,
    double effectiveSampleSize,
    Double meanSpeed,
    Double standardDeviation,
    Double coverageOneSigma,
    Double coverageTwoSigma,
    Double coverageThreeSigma
) {}
