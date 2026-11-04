package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpHeaders;
import org.springframework.web.reactive.function.client.WebClientResponseException;

class ProviderFailureClassifierTest {
    @ParameterizedTest
    @CsvSource({"401,AUTH", "403,AUTH", "404,UNKNOWN", "429,RATE_LIMIT", "500,PROVIDER_5XX", "503,PROVIDER_5XX"})
    void classifiesHttpFailuresThroughTheirCauseChain(int status, ProviderFailureCategory expected) {
        var error = response(status, "fixture failure");
        assertThat(ProviderFailureClassifier.classifyFailure(new IllegalStateException(error))).isEqualTo(expected);
        assertThat(ProviderFailureClassifier.isAuthorizationFailure(error)).isEqualTo(status == 401 || status == 403);
    }

    @Test
    void creditsRequireAForbiddenResponseAndRemainDistinctFromAuthorization() {
        for (String body : new String[]{"InsufficientFunds", "NOT ENOUGH CREDITS"}) {
            var credits = response(403, body);
            assertThat(ProviderFailureClassifier.isInsufficientFunds(credits)).isTrue();
            assertThat(ProviderFailureClassifier.isAuthorizationFailure(credits)).isFalse();
            assertThat(ProviderFailureClassifier.classifyFailure(credits)).isEqualTo(ProviderFailureCategory.CREDITS_EXHAUSTED);
            assertThat(ProviderFailureClassifier.isInsufficientFunds(response(401, body))).isFalse();
        }
        assertThat(ProviderFailureClassifier.isInsufficientFunds(null)).isFalse();
    }

    @Test
    void networkQuotaAndUnknownFailuresKeepTheirCategories() {
        assertThat(ProviderFailureClassifier.classifyFailure(new java.io.IOException())).isEqualTo(ProviderFailureCategory.NETWORK);
        assertThat(ProviderFailureClassifier.classifyFailure(new java.util.concurrent.TimeoutException())).isEqualTo(ProviderFailureCategory.NETWORK);
        assertThat(ProviderFailureClassifier.classifyFailure(null)).isEqualTo(ProviderFailureCategory.UNKNOWN);
        assertThat(ProviderFailureClassifier.classifyFailure(new IllegalStateException())).isEqualTo(ProviderFailureCategory.UNKNOWN);
    }

    private static WebClientResponseException response(int code, String body) {
        return WebClientResponseException.create(code, "fixture", HttpHeaders.EMPTY, body.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8);
    }
}
