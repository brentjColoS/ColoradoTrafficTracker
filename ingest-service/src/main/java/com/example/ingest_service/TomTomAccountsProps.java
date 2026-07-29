package com.example.ingest_service;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "traffic.tomtom-accounts")
public record TomTomAccountsProps(
    String secondaryApiKey,
    boolean secondaryEnabled
) {}
