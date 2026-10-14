package com.example.api_service;

public interface TrafficWindowStatisticsProjection {
    Double getAverageSpeed();
    Double getLowestObservedSpeed();
    Double getAverageTravelMinutes();
    Double getFastestTravelMinutes();
    Double getSlowestTravelMinutes();
}
