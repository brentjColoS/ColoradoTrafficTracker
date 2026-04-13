package com.example.api_service;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class ApiKeyAuthFilter extends OncePerRequestFilter {

    private static final String API_KEY_HEADER = "X-API-Key";
    private static final List<SimpleGrantedAuthority> AUTHORITIES =
        List.of(new SimpleGrantedAuthority("ROLE_API_USER"));

    private final ApiSecurityProps securityProps;

    public ApiKeyAuthFilter(ApiSecurityProps securityProps) {
        this.securityProps = securityProps;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!securityProps.enabled()) return true;
        String path = request.getRequestURI();
        if ("/api/traffic/health".equals(path)) return true;
        if ("/actuator/health".equals(path)) return true;
        if ("/actuator/info".equals(path)) return true;
        return !path.startsWith("/api/") && !path.startsWith("/actuator/");
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        Set<String> validKeys = securityProps.keySet();
        String provided = request.getHeader(API_KEY_HEADER);
        String normalized = provided == null ? "" : provided.trim();

        if (validKeys.isEmpty() || normalized.isBlank() || !validKeys.contains(normalized)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"unauthorized\",\"message\":\"Valid X-API-Key required\"}");
            return;
        }

        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
            clientIdForKey(normalized),
            "N/A",
            AUTHORITIES
        );
        SecurityContextHolder.getContext().setAuthentication(auth);
        filterChain.doFilter(request, response);
    }

    static String clientIdForKey(String apiKey) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(apiKey.getBytes(StandardCharsets.UTF_8));
            return "api-key:" + hexPrefix(hash, 12);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 digest unavailable", e);
        }
    }

    private static String hexPrefix(byte[] bytes, int hexChars) {
        StringBuilder out = new StringBuilder(hexChars);
        for (byte value : bytes) {
            if (out.length() >= hexChars) break;
            out.append(Character.forDigit((value >> 4) & 0xf, 16));
            if (out.length() >= hexChars) break;
            out.append(Character.forDigit(value & 0xf, 16));
        }
        return out.toString();
    }
}
