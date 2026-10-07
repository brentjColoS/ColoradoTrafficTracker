package com.example.api_service;

import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.List;
import org.springframework.cache.CacheManager;
import org.springframework.cache.caffeine.CaffeineCache;
import org.springframework.cache.support.SimpleCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ApiCacheConfig {

    @Bean
    public CacheManager cacheManager() {
        CaffeineCache latest = new CaffeineCache(
            "apiLatest",
            Caffeine.newBuilder().recordStats().maximumSize(500).expireAfterWrite(Duration.ofSeconds(20)).build()
        );
        CaffeineCache history = new CaffeineCache(
            "apiHistory",
            Caffeine.newBuilder().recordStats().maximumSize(2_000).expireAfterWrite(Duration.ofSeconds(30)).build()
        );
        CaffeineCache corridors = new CaffeineCache(
            "apiCorridors",
            Caffeine.newBuilder().recordStats().maximumSize(32).expireAfterWrite(Duration.ofMinutes(5)).build()
        );

        SimpleCacheManager manager = new SimpleCacheManager();
        manager.setCaches(List.of(latest, history, corridors));
        return manager;
    }
}
