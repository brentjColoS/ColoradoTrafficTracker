package com.example.ingest_service;

import java.time.Duration;
import io.netty.channel.ChannelOption;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.util.DefaultUriBuilderFactory;
import reactor.netty.http.client.HttpClient;

@Configuration
public class HttpConfig {

    @Bean
    WebClient tomtomWebClient(WebClient.Builder builder, TrafficHttpClientProps httpClientProps) {
        DefaultUriBuilderFactory factory = new DefaultUriBuilderFactory("https://api.tomtom.com");
        factory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.VALUES_ONLY);
        return builder
            .clientConnector(clientConnector(httpClientProps))
            .uriBuilderFactory(factory)
            .baseUrl("https://api.tomtom.com")
            .build();
    }

    @Bean
    WebClient routesWebClient(WebClient.Builder builder, RoutesServiceProps routesProps, TrafficHttpClientProps httpClientProps) {
        String baseUrl = routesProps.baseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            baseUrl = "http://routes-service:8081";
        }
        return builder
            .clientConnector(clientConnector(httpClientProps))
            .baseUrl(baseUrl)
            .build();
    }

    private ReactorClientHttpConnector clientConnector(TrafficHttpClientProps httpClientProps) {
        HttpClient httpClient = HttpClient.create()
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, httpClientProps.connectTimeoutSeconds() * 1000)
            .responseTimeout(Duration.ofSeconds(httpClientProps.responseTimeoutSeconds()));
        return new ReactorClientHttpConnector(httpClient);
    }
}
