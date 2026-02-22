package com.example.ingest_service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;

@Configuration
public class HttpConfig {

    @Bean
    WebClient tomtomWebClient(WebClient.Builder builder) {
        DefaultUriBuilderFactory factory = new DefaultUriBuilderFactory("https://api.tomtom.com");
        factory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.VALUES_ONLY);
        return builder.uriBuilderFactory(factory).baseUrl("https://api.tomtom.com").build();
    }

    @Bean
    WebClient routesWebClient(WebClient.Builder builder, RoutesServiceProps routesProps) {
        String baseUrl = routesProps.baseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            baseUrl = "http://routes-service:8081";
        }
        return builder.baseUrl(baseUrl).build();
    }
}
