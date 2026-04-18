package com.example.ingest_service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

public final class TrafficSampleSignature {

    private TrafficSampleSignature() {}

    public static String from(TrafficSample sample) {
        String payload = String.join(
            "|",
            normalize(sample.getCorridor()),
            normalize(sample.getSourceMode()),
            decimal(sample.getAvgCurrentSpeed()),
            decimal(sample.getAvgFreeflowSpeed()),
            decimal(sample.getMinCurrentSpeed()),
            decimal(sample.getConfidence()),
            integer(sample.getSpeedSampleCount()),
            decimal(sample.getSpeedStddev()),
            decimal(sample.getP10Speed()),
            decimal(sample.getP50Speed()),
            decimal(sample.getP90Speed()),
            integer(sample.getIncidentCount()),
            sha256(normalize(sample.getIncidentsJson()))
        );
        return sha256(payload);
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    private static String decimal(Double value) {
        return value == null ? "" : String.format(Locale.US, "%.6f", value);
    }

    private static String integer(Integer value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(bytes.length * 2);
            for (byte valueByte : bytes) {
                out.append(String.format(Locale.ROOT, "%02x", valueByte));
            }
            return out.toString();
        } catch (Exception e) {
            throw new IllegalStateException("Unable to hash traffic sample payload", e);
        }
    }
}
