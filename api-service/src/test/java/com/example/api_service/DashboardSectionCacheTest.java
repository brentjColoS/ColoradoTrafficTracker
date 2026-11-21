package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static com.example.api_service.DashboardReadDiagnostics.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataAccessResourceFailureException;

class DashboardSectionCacheTest {
    final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-09T12:00:00Z"));
    final Clock clock = new Clock() {
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return now.get(); }
    };
    final List<Runnable> pending = new ArrayList<>();
    final List<Event> events = new CopyOnWriteArrayList<>();
    final DashboardReadDiagnostics diagnostics = new DashboardReadDiagnostics(clock, events::add);
    final DashboardSectionCache cache = new DashboardSectionCache(new ObjectMapper(), clock, pending::add, diagnostics);
    final AtomicInteger calls = new AtomicInteger();
    final Supplier<ResponseEntity<?>> loader = () -> ResponseEntity.ok(Map.of("generation", calls.incrementAndGet()));
    final String path = "/traffic/history?corridor=I25";

    @Test void expiredSuccessReturnsImmediatelyAndQueuesExactlyOneRefreshWithOriginalEvidence() {
        var initial = cache.read(path, 60, loader);
        now.set(now.get().plusSeconds(61));
        for (int n=0;n<10;n++) {
            var retained = cache.read(path, 60, loader);
            assertEquals(initial.version(), retained.version()); assertEquals(initial.fetchedAt(), retained.fetchedAt());
            assertEquals(initial.data(), retained.data()); assertTrue(retained.refreshing());
            assertTrue(retained.withoutData().refreshing()); assertNull(retained.withoutData().data());
        }
        assertEquals(1, calls.get()); assertEquals(1, pending.size());
        pending.removeFirst().run();
        var refreshed = cache.read(path, 60, loader);
        assertEquals(2, calls.get()); assertNotEquals(initial.version(), refreshed.version());
        assertFalse(refreshed.refreshing()); assertEquals(OffsetDateTime.now(clock), refreshed.fetchedAt());
    }

    @Test void staleAllowanceIsBoundedAndFailuresNeverRenewTheLastSuccessfulFetch() {
        var initial = cache.read(path, 60, loader);
        now.set(now.get().plusSeconds(61));
        Supplier<ResponseEntity<?>> unavailable = () -> {calls.incrementAndGet();return ResponseEntity.status(503).build();};
        assertTrue(cache.read(path, 60, unavailable).refreshing()); pending.removeFirst().run();
        for(int n=0;n<10;n++) assertEquals(initial.fetchedAt(), cache.read(path, 60, unavailable).fetchedAt());
        assertTrue(pending.isEmpty()); assertEquals(2, calls.get());
        now.set(initial.fetchedAt().toInstant().plusSeconds(120));
        var failure = cache.read(path, 60, unavailable);
        assertEquals(503, failure.status()); assertNull(failure.data()); assertFalse(failure.refreshing());
        assertEquals(3, calls.get());
        cache.read(path, 60, unavailable);assertEquals(3, calls.get());
        now.set(now.get().plusSeconds(5));assertEquals(200,cache.read(path,60,loader).status());assertEquals(4,calls.get());
    }

    @Test void authoritativeHealthAndCountsDoNotServeExpiredSuccesses() {
        for(String key:List.of("health","/system/operational-status?","/traffic/database/observations?")) {
            var first=cache.read(key,20,loader);now.set(now.get().plusSeconds(21));
            var next=cache.read(key,20,loader);assertNotEquals(first.version(),next.version());assertFalse(next.refreshing());
        }
        assertTrue(pending.isEmpty());
    }

    @Test void historicalWindowsNeverBorrowEachOthersResultsAndFailuresRetryAfterFiveSeconds() {
        var first=cache.read(path+"&asOf=one",600,loader);
        var other=cache.read(path+"&asOf=two",600,loader);
        assertNotEquals(first.version(),other.version());
        Supplier<ResponseEntity<?>> unavailable=()->{calls.incrementAndGet();return ResponseEntity.notFound().build();};
        assertEquals(404,cache.read("missing",60,unavailable).status());
        assertEquals(404,cache.read("missing",60,unavailable).status());assertEquals(3,calls.get());
        now.set(now.get().plusSeconds(5));assertEquals(200,cache.read("missing",60,loader).status());
    }

    @Test void saturatedBackgroundQueueRetainsEvidenceWithABoundedRetryCooldown() {
        var rejecting = new DashboardSectionCache(new ObjectMapper(),clock,task->{throw new RejectedExecutionException();}, diagnostics);
        var first=rejecting.read(path,60,loader);now.set(now.get().plusSeconds(61));
        var retained=rejecting.read(path,60,loader);assertTrue(retained.refreshing());assertEquals(first.version(),retained.version());
        assertEquals(1,calls.get());
        assertEquals(1, events.size());
        assertEquals(Stage.REFRESH_QUEUE, events.getFirst().stage());
        assertEquals(Cause.CAPACITY_REJECTED, events.getFirst().cause());
        now.set(now.get().plusSeconds(59));assertEquals(200,rejecting.read(path,60,loader).status());assertEquals(2,calls.get());
    }

    @Test void coldReadersShareSuccessAndInterruptedWaiterDoesNotCancelTheOwner() throws Exception {
        var entered=new CountDownLatch(1);var release=new CountDownLatch(1);
        Supplier<ResponseEntity<?>> blocked=()->{
            calls.incrementAndGet();entered.countDown();
            try {assertTrue(release.await(3,TimeUnit.SECONDS));} catch(InterruptedException e){throw new IllegalStateException(e);}
            return ResponseEntity.ok("observed");
        };
        var pool=Executors.newFixedThreadPool(2);
        try {
            var first=pool.submit(()->cache.read(path,60,blocked));assertTrue(entered.await(2,TimeUnit.SECONDS));
            var interrupted=pool.submit(()->{
                Thread.currentThread().interrupt();try {assertEquals(503,cache.read(path,60,blocked).status());assertTrue(Thread.currentThread().isInterrupted());}
                finally {Thread.interrupted();}
            });
            interrupted.get(2,TimeUnit.SECONDS);release.countDown();
            assertEquals("observed",first.get(2,TimeUnit.SECONDS).data());assertEquals(1,calls.get());
        } finally {release.countDown();pool.shutdownNow();}
    }

    @Test void serializationFailureDoesNotPoisonLaterLoads() {
        assertEquals(503,cache.read(path,60,()->ResponseEntity.ok(new Object())).status());
        assertEquals(1, events.size());
        assertEquals(Stage.ENCODE, events.getFirst().stage());
        assertEquals(Cause.SERIALIZATION, events.getFirst().cause());
        now.set(now.get().plusSeconds(5));assertEquals(200,cache.read(path,60,loader).status());
        cache.close();
    }

    @Test void loaderFailureIsReportedOnceAndRetainsUsefulDataUntilRetry() {
        var fresh = cache.read(path, 60, loader);
        now.set(now.get().plusSeconds(61));
        var failed = (Supplier<ResponseEntity<?>>) () -> { throw new DataAccessResourceFailureException("sensitive query"); };
        assertTrue(cache.read(path, 60, failed).refreshing());
        pending.removeFirst().run();
        for (int i = 0; i < 10; i++) {
            var retained = cache.read(path, 60, failed);
            assertTrue(retained.refreshing());
            assertEquals(fresh.fetchedAt(), retained.fetchedAt());
            assertEquals(fresh.version(), retained.version());
        }
        assertTrue(pending.isEmpty());
        assertEquals(1, events.size());
        assertEquals(Stage.LOAD, events.getFirst().stage());
        assertEquals(Cause.SOURCE_READ, events.getFirst().cause());
        assertEquals(new Scope(Dataset.HISTORY, Corridor.I25), events.getFirst().scope());
        now.set(now.get().plusSeconds(5));
        assertTrue(cache.read(path, 60, loader).refreshing());
        pending.removeFirst().run();
        assertNotEquals(fresh.version(), cache.read(path, 60, loader).version());
    }

    @Test void aWaiterTimeoutDoesNotClaimTheOwnersLoadFailed() {
        var busy = new CompletableFuture<DashboardDataController.Section>() {
            @Override public DashboardDataController.Section get(long timeout, TimeUnit unit) throws TimeoutException {
                assertEquals(10, unit.toSeconds(timeout));
                throw new TimeoutException("waiter timeout");
            }
        };
        assertEquals(503, cache.await(path, busy).status());
        assertFalse(busy.isDone());
        assertEquals(1, events.size());
        assertEquals(Stage.WAIT, events.getFirst().stage());
        assertEquals(Cause.WAIT_TIMEOUT, events.getFirst().cause());
    }

    @Test void aBrokenDiagnosticSinkCannotStrandTheLoadOrTurnEmptyDataIntoFailure() {
        var broken = new DashboardReadDiagnostics(clock, event -> {
            events.add(event);
            throw new IllegalStateException("test sink failed");
        });
        try (var sections = new DashboardSectionCache(new ObjectMapper(), clock, pending::add, broken)) {
            assertEquals(503, sections.read(path, 60, () -> { throw new IllegalStateException("load failed"); }).status());
            assertEquals(1, events.size());
            assertEquals(Cause.UNEXPECTED, events.getFirst().cause());
            now.set(now.get().plusSeconds(5));
            assertEquals(List.of(), sections.read(path, 60, () -> ResponseEntity.ok(List.of())).data());
            assertEquals(404, sections.read("not-observed", 60, () -> ResponseEntity.notFound().build()).status());
            assertEquals(1, events.size());
        }
    }

    @Test void fastConcurrentColdReadsDoNotReloadAfterTheFirstFlightCompletes() throws Exception {
        var pool=Executors.newFixedThreadPool(10);
        var barrier=new CyclicBarrier(10);
        try {
            List<Future<?>> readers=new ArrayList<>();
            for(int reader=0;reader<10;reader++) readers.add(pool.submit(()->{
                for(int round=0;round<32;round++) {
                    try {barrier.await(2,TimeUnit.SECONDS);} catch(Exception failure){throw new IllegalStateException(failure);}
                    assertEquals(200,cache.read(path+round,60,loader).status());
                }
            }));
            for(var reader:readers) reader.get(5,TimeUnit.SECONDS);
            assertEquals(32,calls.get());
        } finally {pool.shutdownNow();}
    }
}
