package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.web.reactive.function.client.WebClientResponseException;

class TransientProviderFailureTest {

    @Test
    void retriesTransportAndServerFailures() {
        assertThat(TransientProviderFailure.isRetryable(new IOException("connection reset")))
            .isTrue();
        assertThat(TransientProviderFailure.isRetryable(
            new IllegalStateException(new TimeoutException("slow provider"))
        )).isTrue();
        assertThat(TransientProviderFailure.isRetryable(response(503))).isTrue();
    }

    @Test
    void doesNotRetryClientOrApplicationFailures() {
        assertThat(TransientProviderFailure.isRetryable(response(401))).isFalse();
        assertThat(TransientProviderFailure.isRetryable(response(403))).isFalse();
        assertThat(TransientProviderFailure.isRetryable(response(429))).isFalse();
        assertThat(TransientProviderFailure.isRetryable(new IllegalStateException("bad data")))
            .isFalse();
    }

    private static WebClientResponseException response(int status) {
        return WebClientResponseException.create(
            status,
            "provider response",
            HttpHeaders.EMPTY,
            new byte[0],
            null
        );
    }
}
