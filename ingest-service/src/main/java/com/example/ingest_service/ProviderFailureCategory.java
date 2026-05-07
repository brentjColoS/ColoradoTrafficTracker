package com.example.ingest_service;

public enum ProviderFailureCategory {
    AUTH("AUTH", "AUTH_FORBIDDEN", "TomTom rejected the configured API key.", false, 100),
    CONFIG("CONFIG", "CONFIG_MISSING_KEY", "Provider configuration is incomplete.", false, 100),
    RATE_LIMIT("RATE_LIMIT", "RATE_LIMIT_RECOVERING", "TomTom rate-limited live traffic requests.", true, 80),
    QUOTA_HARD_STOP("QUOTA_HARD_STOP", "QUOTA_HARD_STOP", "Tile polling is paused by the configured daily quota hard stop.", true, 70),
    PROVIDER_5XX("PROVIDER_5XX", "PROVIDER_5XX_RECOVERING", "TomTom returned server errors for live traffic requests.", true, 60),
    NETWORK("NETWORK", "NETWORK_RECOVERING", "Network access to TomTom failed or timed out.", true, 50),
    ROUTES_SERVICE("ROUTES_SERVICE", "ROUTES_SERVICE_RECOVERING", "routes-service did not return corridor definitions.", true, 40),
    EMPTY_PAYLOAD("EMPTY_PAYLOAD", "EMPTY_PAYLOAD_RECOVERING", "TomTom returned no usable traffic speed data.", true, 30),
    UNKNOWN("UNKNOWN", "UNKNOWN_PROVIDER_RECOVERING", "Provider polling failed for an unclassified recoverable reason.", true, 10);

    private final String code;
    private final String recoveringFailureCode;
    private final String recoveryMessage;
    private final boolean recoverable;
    private final int priority;

    ProviderFailureCategory(
        String code,
        String recoveringFailureCode,
        String recoveryMessage,
        boolean recoverable,
        int priority
    ) {
        this.code = code;
        this.recoveringFailureCode = recoveringFailureCode;
        this.recoveryMessage = recoveryMessage;
        this.recoverable = recoverable;
        this.priority = priority;
    }

    public String code() {
        return code;
    }

    public String recoveringFailureCode() {
        return recoveringFailureCode;
    }

    public String recoveryMessage() {
        return recoveryMessage;
    }

    public boolean recoverable() {
        return recoverable;
    }

    public int priority() {
        return priority;
    }
}
