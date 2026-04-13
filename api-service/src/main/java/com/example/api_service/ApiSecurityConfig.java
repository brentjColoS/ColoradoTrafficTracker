package com.example.api_service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;

@Configuration
public class ApiSecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(
        HttpSecurity http,
        ApiSecurityProps securityProps,
        ApiRateLimitProps rateLimitProps,
        ApiKeyAuthFilter apiKeyAuthFilter,
        ApiRateLimitFilter apiRateLimitFilter
    ) throws Exception {
        http.csrf(csrf -> csrf.disable());
        http.httpBasic(httpBasic -> httpBasic.disable());
        http.formLogin(form -> form.disable());
        http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS));

        if (securityProps.enabled()) {
            http.authorizeHttpRequests(auth -> auth
                .requestMatchers(
                    "/",
                    "/dashboard/**",
                    "/api/traffic/health",
                    "/actuator/health",
                    "/actuator/info"
                ).permitAll()
                .requestMatchers("/api/**", "/actuator/**").hasRole("API_USER")
                .anyRequest().denyAll()
            );
            http.addFilterBefore(apiKeyAuthFilter, AnonymousAuthenticationFilter.class);
        } else {
            http.authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        }

        if (rateLimitProps.enabled()) {
            http.addFilterBefore(apiRateLimitFilter, AnonymousAuthenticationFilter.class);
        }

        return http.build();
    }

    @Bean
    ApiKeyAuthFilter apiKeyAuthFilter(ApiSecurityProps securityProps) {
        return new ApiKeyAuthFilter(securityProps);
    }

    @Bean
    ApiRateLimitFilter apiRateLimitFilter(ApiRateLimitProps rateLimitProps) {
        return new ApiRateLimitFilter(rateLimitProps);
    }

    @Bean
    FilterRegistrationBean<ApiKeyAuthFilter> apiKeyAuthFilterRegistration(ApiKeyAuthFilter filter) {
        FilterRegistrationBean<ApiKeyAuthFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    FilterRegistrationBean<ApiRateLimitFilter> apiRateLimitFilterRegistration(ApiRateLimitFilter filter) {
        FilterRegistrationBean<ApiRateLimitFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
}
