package com.example.ingest_service;

public record TomTomAccount(String id, String apiKey) {

    public TomTomAccount {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("TomTom account id must not be blank");
        }
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalArgumentException("TomTom API key must not be blank");
        }
        id = id.trim().toLowerCase(java.util.Locale.ROOT);
        apiKey = apiKey.trim();
    }

    @Override
    public String toString() {
        return "TomTomAccount[id=" + id + "]";
    }
}
