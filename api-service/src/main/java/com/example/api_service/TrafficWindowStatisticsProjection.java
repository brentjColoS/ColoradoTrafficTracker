package com.example.api_service;

public interface TrafficWindowStatisticsProjection {
    Double getAverageSpeed();
    Double getAverageTravelMinutes();
    Double getFastestTravelMinutes();
    Double getSlowestTravelMinutes();
}
