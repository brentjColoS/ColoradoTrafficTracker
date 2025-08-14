package com.example.traffic_backend;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class HttpConfig {
    @Bean
    WebClient webClient() {
        return WebClient.builder().baseUrl("https://api.tomtom.com").build();
    }
}
