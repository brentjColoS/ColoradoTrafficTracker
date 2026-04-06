package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.cache.CacheManager;
import org.springframework.cache.support.SimpleCacheManager;

class ApiCacheConfigTest {

    @Test
    void cacheManagerDefinesExpectedCaches() {
        ApiCacheConfig config = new ApiCacheConfig();

        CacheManager manager = config.cacheManager();
        if (manager instanceof SimpleCacheManager simpleCacheManager) {
            simpleCacheManager.initializeCaches();
        }

        assertThat(manager.getCache("apiLatest")).isNotNull();
        assertThat(manager.getCache("apiHistory")).isNotNull();
        assertThat(manager.getCache("apiCorridors")).isNotNull();
    }
}
