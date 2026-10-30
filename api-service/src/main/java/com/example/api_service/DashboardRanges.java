package com.example.api_service;

import java.util.Map;

final class DashboardRanges {
    static final Map<Integer, Integer> BUCKET_MINUTES = Map.of(
        2, 1,
        6, 5,
        24, 15,
        168, 60,
        720, 180
    );

    private DashboardRanges() {}
}
