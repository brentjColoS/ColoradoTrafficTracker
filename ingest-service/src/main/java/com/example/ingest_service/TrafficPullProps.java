package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.pull")
public record TrafficPullProps(
    Flow flow,
    Incidents incidents,
    MonthlyRequestBudget monthlyRequestBudget
) {
    public TrafficPullProps {
        flow = flow == null ? new Flow(true, "tomtom", 60, 10, "") : flow;
        incidents = incidents == null ? new Incidents(true, "cdot", 900, 9, 60) : incidents;
        monthlyRequestBudget = monthlyRequestBudget == null
            ? new MonthlyRequestBudget(190_000, 195_000, 200_000)
            : monthlyRequestBudget;
    }

    public record Flow(
        boolean enabled,
        String provider,
        int pollSeconds,
        int tileZoom,
        String tileCorridorZoomOverrides
    ) {}

    public record Incidents(
        boolean enabled,
        String provider,
        int pollSeconds,
        int tileZoom,
        int leaseCheckSeconds
    ) {
        public Incidents(boolean enabled, String provider, int pollSeconds, int tileZoom) {
            this(enabled, provider, pollSeconds, tileZoom, 60);
        }
    }

    public record MonthlyRequestBudget(
        int targetRequests,
        int hardStopRequests,
        int allowanceRequests
    ) {}
}
