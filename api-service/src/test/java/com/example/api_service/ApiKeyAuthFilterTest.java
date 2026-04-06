package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.ServletException;
import java.io.IOException;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

class ApiKeyAuthFilterTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void protectedRouteReturnsUnauthorizedForMissingApiKey() throws ServletException, IOException {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(new ApiSecurityProps(true, "dev-key"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/traffic/latest");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("Valid X-API-Key required");
    }

    @Test
    void protectedRouteAuthenticatesWithValidApiKey() throws ServletException, IOException {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(new ApiSecurityProps(true, "dev-key"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/traffic/latest");
        request.addHeader("X-API-Key", " dev-key ");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication().getName()).isEqualTo("api-client");
    }

    @Test
    void healthRouteSkipsAuthFilter() throws ServletException, IOException {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(new ApiSecurityProps(true, "dev-key"));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/traffic/health");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void disabledSecuritySkipsAuthFilterForProtectedRoute() throws ServletException, IOException {
        ApiKeyAuthFilter filter = new ApiKeyAuthFilter(new ApiSecurityProps(false, String.join(",", Set.of("a", "b"))));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/traffic/corridors");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(200);
    }
}
