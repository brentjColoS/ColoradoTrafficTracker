package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.ServletException;
import java.io.IOException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

class ApiRateLimitFilterTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void filterEnforcesPerMinuteLimit() throws ServletException, IOException {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(new ApiRateLimitProps(true, 2));

        MockHttpServletResponse first = perform(filter, "/api/traffic/corridors");
        MockHttpServletResponse second = perform(filter, "/api/traffic/corridors");
        MockHttpServletResponse third = perform(filter, "/api/traffic/corridors");

        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(second.getStatus()).isEqualTo(200);
        assertThat(third.getStatus()).isEqualTo(429);
        assertThat(third.getHeader("Retry-After")).isEqualTo("60");
        assertThat(third.getHeader("X-RateLimit-Limit")).isEqualTo("2");
        assertThat(third.getHeader("X-RateLimit-Remaining")).isEqualTo("0");
        assertThat(third.getContentType()).isEqualTo("application/json");
        assertThat(third.getContentAsString()).contains("rate_limited");
    }

    @Test
    void healthEndpointIsExcludedFromRateLimit() throws ServletException, IOException {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(new ApiRateLimitProps(true, 1));

        MockHttpServletResponse first = perform(filter, "/api/traffic/health");
        MockHttpServletResponse second = perform(filter, "/api/traffic/health");
        MockHttpServletResponse third = perform(filter, "/api/traffic/health");

        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(second.getStatus()).isEqualTo(200);
        assertThat(third.getStatus()).isEqualTo(200);
    }

    @Test
    void disabledRateLimitSkipsFiltering() throws ServletException, IOException {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(new ApiRateLimitProps(false, 1));

        MockHttpServletResponse first = perform(filter, "/api/traffic/corridors");
        MockHttpServletResponse second = perform(filter, "/api/traffic/corridors");
        MockHttpServletResponse third = perform(filter, "/api/traffic/corridors");

        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(second.getStatus()).isEqualTo(200);
        assertThat(third.getStatus()).isEqualTo(200);
    }

    @Test
    void forwardedForHeaderFormsDistinctBucketsWhenApiKeyMissing() throws ServletException, IOException {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(new ApiRateLimitProps(true, 1));

        MockHttpServletResponse first = perform(filter, "/api/traffic/corridors", "203.0.113.10", null, null);
        MockHttpServletResponse second = perform(filter, "/api/traffic/corridors", "203.0.113.10", null, null);
        MockHttpServletResponse third = perform(filter, "/api/traffic/corridors", "198.51.100.22", null, null);

        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(second.getStatus()).isEqualTo(429);
        assertThat(third.getStatus()).isEqualTo(200);
    }

    @Test
    void remoteAddressFormsDistinctBucketsWhenNoApiKeyOrForwardedFor() throws ServletException, IOException {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(new ApiRateLimitProps(true, 1));

        MockHttpServletResponse first = perform(filter, "/api/traffic/corridors", null, "192.0.2.10", null);
        MockHttpServletResponse second = perform(filter, "/api/traffic/corridors", null, "192.0.2.10", null);
        MockHttpServletResponse third = perform(filter, "/api/traffic/corridors", null, "192.0.2.11", null);

        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(second.getStatus()).isEqualTo(429);
        assertThat(third.getStatus()).isEqualTo(200);
    }

    @Test
    void authenticationNameFormsBucketWhenNoApiKey() throws ServletException, IOException {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(new ApiRateLimitProps(true, 1));
        SecurityContextHolder.getContext()
            .setAuthentication(new TestingAuthenticationToken("client-a", "N/A", "ROLE_API_USER"));

        MockHttpServletResponse first = perform(filter, "/api/traffic/corridors", null, "192.0.2.10", null);
        MockHttpServletResponse second = perform(filter, "/api/traffic/corridors", null, "198.51.100.7", null);

        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(second.getStatus()).isEqualTo(429);
    }

    @Test
    void apiKeyTrimmedValueFormsBucketBeforeFallbacks() throws ServletException, IOException {
        ApiRateLimitFilter filter = new ApiRateLimitFilter(new ApiRateLimitProps(true, 1));

        MockHttpServletResponse first = perform(filter, "/api/traffic/corridors", null, "192.0.2.10", "  same-key  ");
        MockHttpServletResponse second = perform(filter, "/api/traffic/corridors", null, "198.51.100.7", "same-key");
        MockHttpServletResponse third = perform(filter, "/api/traffic/corridors", null, "198.51.100.7", "different-key");

        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(second.getStatus()).isEqualTo(429);
        assertThat(third.getStatus()).isEqualTo(200);
    }

    private static MockHttpServletResponse perform(ApiRateLimitFilter filter, String path)
        throws ServletException, IOException {
        return perform(filter, path, null, null, null);
    }

    private static MockHttpServletResponse perform(
        ApiRateLimitFilter filter,
        String path,
        String forwardedFor,
        String remoteAddr,
        String apiKey
    ) throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        if (forwardedFor != null) {
            request.addHeader("X-Forwarded-For", forwardedFor);
        }
        if (remoteAddr != null) {
            request.setRemoteAddr(remoteAddr);
        }
        if (apiKey != null) {
            request.addHeader("X-API-Key", apiKey);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }
}
