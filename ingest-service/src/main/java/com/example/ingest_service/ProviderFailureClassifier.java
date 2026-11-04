package com.example.ingest_service;

import java.util.Locale;
import java.util.concurrent.TimeoutException;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;

final class ProviderFailureClassifier {
    private ProviderFailureClassifier() {}

    static boolean isAuthorizationFailure(WebClientResponseException exception) {
        int statusCode = exception.getStatusCode().value();
        return (statusCode == 401 || statusCode == 403) && !isInsufficientFunds(exception);
    }

    static boolean isInsufficientFunds(WebClientResponseException exception) {
        if (exception == null || exception.getStatusCode().value() != 403) {
            return false;
        }
        String body = exception.getResponseBodyAsString().toLowerCase(Locale.ROOT);
        return body.contains("insufficientfunds") || body.contains("not enough credits");
    }

    static ProviderFailureCategory classifyFailure(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof TomTomRequestQuotaExceededException) {
                return ProviderFailureCategory.QUOTA_HARD_STOP;
            }
            if (current instanceof WebClientResponseException responseException) {
                int statusCode = responseException.getStatusCode().value();
                if (isInsufficientFunds(responseException)) {
                    return ProviderFailureCategory.CREDITS_EXHAUSTED;
                }
                if (statusCode == 401 || statusCode == 403) {
                    return ProviderFailureCategory.AUTH;
                }
                if (statusCode == 429) {
                    return ProviderFailureCategory.RATE_LIMIT;
                }
                if (responseException.getStatusCode().is5xxServerError()) {
                    return ProviderFailureCategory.PROVIDER_5XX;
                }
                return ProviderFailureCategory.UNKNOWN;
            }
            if (current instanceof WebClientRequestException
                || current instanceof TimeoutException
                || current instanceof java.io.IOException) {
                return ProviderFailureCategory.NETWORK;
            }
            current = current.getCause();
        }
        return ProviderFailureCategory.UNKNOWN;
    }
}
