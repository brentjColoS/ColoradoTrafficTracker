package com.example.ingest_service;

import java.io.IOException;
import java.util.concurrent.TimeoutException;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;

final class TransientProviderFailure {

    private TransientProviderFailure() {}

    static boolean isRetryable(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof WebClientResponseException response) {
                return response.getStatusCode().is5xxServerError();
            }
            if (
                current instanceof WebClientRequestException
                    || current instanceof TimeoutException
                    || current instanceof IOException
            ) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
