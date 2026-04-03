package com.example.api_service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class ApiRateLimitFilter extends OncePerRequestFilter {

    private static final class WindowCounter {
        long minuteWindow;
        int used;

        WindowCounter(long minuteWindow) {
            this.minuteWindow = minuteWindow;
            this.used = 0;
        }
    }

    private final ApiRateLimitProps rateLimitProps;
    private final Cache<String, WindowCounter> counters = Caffeine.newBuilder()
        .expireAfterAccess(Duration.ofMinutes(5))
        .maximumSize(20_000)
        .build();

    public ApiRateLimitFilter(ApiRateLimitProps rateLimitProps) {
        this.rateLimitProps = rateLimitProps;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!rateLimitProps.enabled()) return true;
        String path = request.getRequestURI();
        if ("/api/traffic/health".equals(path)) return true;
        return !path.startsWith("/api/traffic");
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        int limit = Math.max(1, rateLimitProps.requestsPerMinute());
        long currentMinute = Instant.now().getEpochSecond() / 60;
        String clientKey = resolveClientKey(request);

        WindowCounter counter = counters.get(clientKey, key -> new WindowCounter(currentMinute));
        int used;
        synchronized (counter) {
            if (counter.minuteWindow != currentMinute) {
                counter.minuteWindow = currentMinute;
                counter.used = 0;
            }
            counter.used++;
            used = counter.used;
        }

        int remaining = Math.max(0, limit - used);
        response.setHeader("X-RateLimit-Limit", String.valueOf(limit));
        response.setHeader("X-RateLimit-Remaining", String.valueOf(remaining));

        if (used > limit) {
            response.setStatus(429);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setHeader("Retry-After", "60");
            response.getWriter().write("{\"error\":\"rate_limited\",\"message\":\"Per-minute request limit exceeded\"}");
            return;
        }

        filterChain.doFilter(request, response);
    }

    private static String resolveClientKey(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            return "auth:" + authentication.getName();
        }

        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isBlank()) {
            String first = forwardedFor.split(",")[0].trim();
            if (!first.isBlank()) return "ip:" + first;
        }
        return "ip:" + request.getRemoteAddr();
    }
}
