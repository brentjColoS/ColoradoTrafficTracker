package com.example.api_service;

import java.util.Locale;

final class CorridorCodes {
    private CorridorCodes() {}

    static String normalizeCorridor(String corridor) {
        if (corridor == null) return null;
        String value = corridor.trim().toUpperCase(Locale.ROOT);
        return value.isBlank() ? null : value;
    }
}
