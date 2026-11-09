package com.example.api_service;

import com.example.api_service.DashboardDataController.Section;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.support.TransactionOperations;

final class DashboardSectionCache implements AutoCloseable {
    private record Cached(Section section, int bytes, Section failure) {}
    private final Cache<String, Cached> cache = Caffeine.newBuilder()
        .maximumWeight(32 * 1024 * 1024).weigher((String key, Cached value) -> value.bytes())
        .expireAfterAccess(Duration.ofHours(12)).build();
    private final ConcurrentHashMap<String, CompletableFuture<Section>> loads = new ConcurrentHashMap<>();
    private final ObjectMapper mapper;
    private final Clock clock;
    private final Executor executor;
    private TransactionOperations refreshTransactions;

    DashboardSectionCache(ObjectMapper mapper, Clock clock) {
        this(mapper, clock, executor());
    }

    DashboardSectionCache(ObjectMapper mapper, Clock clock, Executor executor) {
        this.mapper = mapper; this.clock = clock; this.executor = executor;
    }

    void useRefreshTransactions(TransactionOperations transactions) { this.refreshTransactions = transactions; }

    private static ThreadPoolExecutor executor() {
        var executor = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16), task -> {
            Thread thread = new Thread(task, "dashboard-cache-refresh");
            thread.setDaemon(true);
            return thread;
        });
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }

    Section read(String key, int seconds, Supplier<? extends ResponseEntity<?>> loader) {
        OffsetDateTime now = OffsetDateTime.now(clock);
        Cached previous = cache.getIfPresent(key);
        if (previous != null) {
            if (fresh(key, previous, seconds, now)) return previous.section();
            boolean retrying = previous.failure() != null && previous.failure().fetchedAt().plusSeconds(5).isAfter(now);
            boolean retained = previous.section().status() == 200 && previous.section().version() != null && seconds <= 3600 && !key.equals("health")
                && !key.startsWith("/system/") && !key.startsWith("/traffic/database/")
                && previous.section().fetchedAt().plusSeconds(seconds + Math.min(seconds, 60)).isAfter(now);
            if (retained) {
                if (!retrying) refresh(key, previous, loader);
                return previous.section().withRefreshing();
            }
            if (retrying) return previous.failure();
        }
        CompletableFuture<Section> created = new CompletableFuture<>();
        CompletableFuture<Section> shared = loads.putIfAbsent(key, created);
        if (shared == null) {
            Cached latest = cache.getIfPresent(key);
            if (latest != null && latest != previous && fresh(key, latest, seconds, OffsetDateTime.now(clock))) {
                created.complete(latest.section()); loads.remove(key, created);
            } else if (latest != null && latest.failure() != null
                && latest.failure().fetchedAt().plusSeconds(5).isAfter(OffsetDateTime.now(clock))) {
                created.complete(latest.failure()); loads.remove(key, created);
            } else load(key, loader, created);
            shared = created;
        }
        try { return shared.get(10, TimeUnit.SECONDS); }
        catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return failure(); }
        catch (ExecutionException | TimeoutException unavailable) { return failure(); }
    }

    private boolean fresh(String key, Cached value, int seconds, OffsetDateTime now) {
        int lifetime = value.section().status() == 200 || key.equals("/traffic/database/observations?") ? seconds : 5;
        return value.section().fetchedAt().plusSeconds(lifetime).isAfter(now);
    }

    private void refresh(String key, Cached previous, Supplier<? extends ResponseEntity<?>> loader) {
        CompletableFuture<Section> created = new CompletableFuture<>();
        if (loads.putIfAbsent(key, created) != null) return;
        Cached latest = cache.getIfPresent(key);
        if (latest != null && latest != previous) {
            created.complete(latest.section()); loads.remove(key, created); return;
        }
        Supplier<? extends ResponseEntity<?>> bounded = refreshTransactions == null ? loader
            : () -> refreshTransactions.execute(status -> loader.get());
        try { executor.execute(() -> load(key, bounded, created)); }
        catch (RejectedExecutionException busy) {
            Section failure = failure();
            cache.asMap().computeIfPresent(key, (ignored, current) -> new Cached(current.section(), current.bytes(), failure));
            created.complete(failure);
            loads.remove(key, created);
        }
    }

    private void load(String key, Supplier<? extends ResponseEntity<?>> loader, CompletableFuture<Section> result) {
        try {
            Section section;
            int bytes = 256;
            try {
                ResponseEntity<?> response = loader.get();
                OffsetDateTime now = OffsetDateTime.now(clock);
                if (response.getStatusCode().value() != 200 || response.getBody() == null)
                    section = new Section(response.getStatusCode().value(), null, now, null);
                else {
                    bytes += mapper.writeValueAsBytes(response.getBody()).length;
                    section = new Section(200, UUID.randomUUID().toString(), now, response.getBody());
                }
            } catch (Exception unavailable) { section = failure(); }
            Cached previous = cache.getIfPresent(key);
            if (section.status() == 200 || previous == null || previous.section().status() != 200)
                cache.put(key, new Cached(section, bytes, null));
            else cache.put(key, new Cached(previous.section(), previous.bytes(), section));
            result.complete(section);
        } catch (Error failed) { result.completeExceptionally(failed); throw failed; }
        finally { loads.remove(key, result); }
    }

    private Section failure() { return new Section(503, null, OffsetDateTime.now(clock), null); }

    @Override public void close() {
        loads.values().forEach(load -> load.completeExceptionally(new IllegalStateException("Dashboard cache stopped")));
        loads.clear();
        if (executor instanceof ThreadPoolExecutor pool) pool.shutdownNow();
    }
}
