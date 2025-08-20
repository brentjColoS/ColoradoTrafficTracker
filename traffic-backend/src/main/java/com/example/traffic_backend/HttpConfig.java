package com.example.traffic_backend;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;

import com.fasterxml.jackson.databind.ser.std.StdKeySerializers.Default;

@Configuration
public class HttpConfig {
    @Bean
    WebClient webClient() {
        DefaultUriBuilderFactory factory = new DefaultUriBuilderFactory("https://api.tomtom.com");
        factory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.VALUES_ONLY);
        return WebClient.builder().uriBuilderFactory(factory).baseUrl("https://api.tomtom.com").build();
    }
}
