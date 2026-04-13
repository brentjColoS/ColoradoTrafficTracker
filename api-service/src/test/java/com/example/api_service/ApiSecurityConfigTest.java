package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.web.servlet.FilterRegistrationBean;

class ApiSecurityConfigTest {

    private final ApiSecurityConfig config = new ApiSecurityConfig();

    @Test
    void beanFactoriesCreateNonNullFilters() {
        ApiKeyAuthFilter authFilter = config.apiKeyAuthFilter(new ApiSecurityProps(true, "key"));
        ApiRateLimitFilter rateFilter = config.apiRateLimitFilter(new ApiRateLimitProps(true, 5));

        assertThat(authFilter).isNotNull();
        assertThat(rateFilter).isNotNull();
    }

    @Test
    void servletFilterRegistrationsAreDisabledToAvoidDoubleExecution() {
        ApiKeyAuthFilter authFilter = config.apiKeyAuthFilter(new ApiSecurityProps(true, "key"));
        ApiRateLimitFilter rateFilter = config.apiRateLimitFilter(new ApiRateLimitProps(true, 5));

        FilterRegistrationBean<ApiKeyAuthFilter> authRegistration = config.apiKeyAuthFilterRegistration(authFilter);
        FilterRegistrationBean<ApiRateLimitFilter> rateRegistration = config.apiRateLimitFilterRegistration(rateFilter);

        assertThat(authRegistration.isEnabled()).isFalse();
        assertThat(rateRegistration.isEnabled()).isFalse();
        assertThat(authRegistration.getFilter()).isSameAs(authFilter);
        assertThat(rateRegistration.getFilter()).isSameAs(rateFilter);
    }
}
