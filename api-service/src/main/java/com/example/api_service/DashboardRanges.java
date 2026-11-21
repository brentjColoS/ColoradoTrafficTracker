package com.example.api_service;

import java.util.List;
import java.util.Map;
import java.util.Set;

final class DashboardRanges {
    static final List<Integer> HOURS = List.of(2, 6, 24, 168, 720);
    static final Set<Integer> SUPPORTED = Set.copyOf(HOURS);
    static final Map<Integer, Integer> BUCKET_MINUTES = Map.of(
        2, 1,
        6, 5,
        24, 15,
        168, 60,
        720, 180
    );

    private DashboardRanges() {}
}
