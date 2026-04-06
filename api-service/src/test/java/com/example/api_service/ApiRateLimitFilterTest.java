package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.ServletException;
import java.io.IOException;
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

    private static MockHttpServletResponse perform(ApiRateLimitFilter filter, String path)
        throws ServletException, IOException {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", path);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }
}
