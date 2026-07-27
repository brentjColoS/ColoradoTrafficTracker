package com.example.ingest_service;

public class TomTomRequestQuotaExceededException extends RuntimeException {

    private final String product;
    private final long requestsUsed;
    private final int hardStop;

    public TomTomRequestQuotaExceededException(String product, long requestsUsed, int hardStop) {
        super(
            "TomTom monthly request hard stop reached for "
                + product
                + " (used="
                + requestsUsed
                + ", hardStop="
                + hardStop
                + ")"
        );
        this.product = product;
        this.requestsUsed = requestsUsed;
        this.hardStop = hardStop;
    }

    public String product() {
        return product;
    }

    public long requestsUsed() {
        return requestsUsed;
    }

    public int hardStop() {
        return hardStop;
    }
}
