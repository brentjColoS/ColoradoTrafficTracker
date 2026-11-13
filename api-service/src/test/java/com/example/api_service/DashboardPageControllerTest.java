package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.example.api_service.DashboardDataController.Section;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

class DashboardPageControllerTest {
    final DashboardDataService data = mock(DashboardDataService.class);
    final ObjectMapper mapper = spy(new ObjectMapper().findAndRegisterModules());
    final OffsetDateTime fetched = OffsetDateTime.parse("2026-11-10T07:00:00Z");

    @Test void localStylesRemainCompleteAndOrderedWithoutAnOpeningNetworkDependency() throws Exception {
        when(data.bootstrap()).thenReturn(Map.of());
        var page = new DashboardPageController(data,mapper,new DashboardProps(true,60,false));
        String html = new String(page.page("0","0","0", "identity").getBody(),StandardCharsets.UTF_8);
        int previous = -1;
        for (String file : java.util.List.of("vendor/maplibre-gl/6.10.0/maplibre-gl.css", "dashboard.css", "flow-diagram.css", "health-panel.css")) {
            String css = new org.springframework.core.io.ClassPathResource("static/dashboard/" + file)
                .getContentAsString(StandardCharsets.UTF_8);
            assertTrue(html.contains("<style>\n" + css + "\n</style>"));
            int position = html.indexOf(css);
            assertTrue(position > previous);
            previous = position;
            // Inlining preserves these self-contained asset references without rebasing paths.
            var urls = java.util.regex.Pattern.compile("url\\(\\s*[\"']?([^\"')]+)").matcher(css);
            while (urls.find()) assertTrue(urls.group(1).startsWith("data:") || urls.group(1).startsWith("#"), file);
            assertFalse(java.util.regex.Pattern.compile("(?i)@import\\b").matcher(css).find(), file);
        }
        assertFalse(html.contains("rel=\"stylesheet\" href=\""));
        assertTrue(html.contains("https://fonts.googleapis.com/"));
    }

    @Test void tenConcurrentOpensShareOneEncodedPageWithoutLosingUnicodeOrScriptEscaping() throws Exception {
        when(data.bootstrap()).thenReturn(Map.of("health", new Section(200,"one",fetched,
            Map.of("description", "café → Denver & Boulder </script>"))));
        var page = new DashboardPageController(data,mapper,new DashboardProps(true,60,false));
        var workers = Executors.newFixedThreadPool(10);
        var ready = new CountDownLatch(10);
        var start = new CountDownLatch(1);
        try {
            var responses = new ArrayList<CompletableFuture<ResponseEntity<byte[]>>>();
            for (int i=0;i<10;i++) responses.add(CompletableFuture.supplyAsync(() -> {
                ready.countDown();
                try {
                    if (!start.await(3,TimeUnit.SECONDS)) throw new IllegalStateException("Start deadline");
                    return page.page("0","0","0", "identity");
                } catch (Exception error) { throw new java.util.concurrent.CompletionException(error); }
            },workers));
            assertTrue(ready.await(3,TimeUnit.SECONDS)); start.countDown();
            byte[] first = responses.getFirst().get(5,TimeUnit.SECONDS).getBody();
            for (var future : responses) {
                var response = future.get(5,TimeUnit.SECONDS);
                assertSame(first,response.getBody());
                assertEquals(new MediaType(MediaType.TEXT_HTML,StandardCharsets.UTF_8),response.getHeaders().getContentType());
                assertEquals("no-store",response.getHeaders().getCacheControl());
            }
            String html = new String(first,StandardCharsets.UTF_8);
            assertTrue(html.contains("café → Denver"));
            assertTrue(html.contains("\\u0026 Boulder \\u003c/script>"));
            verify(mapper,times(1)).writeValueAsString(any());
            verify(data,times(10)).bootstrap();
        } finally {
            start.countDown(); workers.shutdownNow();
            assertTrue(workers.awaitTermination(3,TimeUnit.SECONDS));
        }
    }

    @Test void changedFetchEvidenceStatusAndDataNeverReuseAnOlderPage() throws Exception {
        var current = new AtomicReference<>(Map.of("health", new Section(200,"same",fetched,Map.of("status","UP"))));
        when(data.bootstrap()).thenAnswer(call -> current.get());
        var page = new DashboardPageController(data,mapper,new DashboardProps(true,60,false));
        byte[] first = page.page("0","0","0", "identity").getBody();
        current.set(Map.of("health",new Section(200,"changed",fetched,Map.of("status","UP"))));
        byte[] versioned = page.page("0","0","0", "identity").getBody();
        assertNotSame(first,versioned);
        assertTrue(new String(versioned,StandardCharsets.UTF_8).contains("changed"));
        current.set(Map.of("health",new Section(200,"changed",fetched.plusSeconds(1),Map.of("status","UP"))));
        byte[] observed = page.page("0","0","0", "identity").getBody();
        assertNotSame(versioned,observed);
        assertNotEquals(new String(versioned,StandardCharsets.UTF_8),new String(observed,StandardCharsets.UTF_8));
        current.set(Map.of("health",new Section(503,"changed",fetched.plusSeconds(1),Map.of("status","DOWN"))));
        byte[] failed = page.page("0","0","0", "identity").getBody();
        assertNotSame(observed,failed);
        assertTrue(new String(failed,StandardCharsets.UTF_8).contains("\"status\":503"));
        current.set(Map.of("health",new Section(503,"changed",fetched.plusSeconds(1),Map.of("status","RECOVERING"))));
        byte[] recovering = page.page("0","0","0", "identity").getBody();
        assertNotSame(failed,recovering);
        assertTrue(new String(recovering,StandardCharsets.UTF_8).contains("RECOVERING"));
        verify(mapper,times(5)).writeValueAsString(any());
    }

    private static byte[] inflate(byte[] body) throws Exception {
        try (var decoder = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(body))) {
            return decoder.readAllBytes();
        }
    }

    @Test void compressedOpensShareExactCurrentDataAndKeepIdentityNegotiation() throws Exception {
        var current = new AtomicReference<>(Map.of("health", new Section(200,"one",fetched,
            Map.of("description", "café → Denver & Boulder </script>"))));
        when(data.bootstrap()).thenAnswer(call -> current.get());
        var page = new DashboardPageController(data,mapper,new DashboardProps(true,60,false));
        var workers = Executors.newFixedThreadPool(10);
        try {
            var responses = new ArrayList<CompletableFuture<ResponseEntity<byte[]>>>();
            for (int i=0;i<10;i++) responses.add(CompletableFuture.supplyAsync(() -> {
                try { return page.page("0","0","0","gzip, deflate, br, zstd"); }
                catch (Exception error) { throw new java.util.concurrent.CompletionException(error); }
            },workers));
            byte[] first = responses.getFirst().get(5,TimeUnit.SECONDS).getBody();
            byte[] identity = page.page("0","0","0","identity").getBody();
            assertArrayEquals(identity,inflate(first));
            for (var future : responses) {
                var response = future.get(5,TimeUnit.SECONDS);
                assertSame(first,response.getBody());
                assertEquals("gzip",response.getHeaders().getFirst("Content-Encoding"));
                assertEquals("Accept-Encoding",response.getHeaders().getFirst("Vary"));
                assertEquals("no-store",response.getHeaders().getCacheControl());
            }
            for (String header : java.util.List.of("", "gzip;q=0", "gzip;q=invalid", "gzip;q=.2, identity;q=1")) {
                var response = page.page("0","0","0",header);
                assertNull(response.getHeaders().getFirst("Content-Encoding"));
                assertSame(identity,response.getBody());
                assertEquals("Accept-Encoding",response.getHeaders().getFirst("Vary"));
            }
            current.set(Map.of("health",new Section(503,"two",fetched.plusSeconds(1),Map.of("status","DOWN"))));
            var changed = page.page("0","0","0","gzip");
            assertNotSame(first,changed.getBody());
            assertArrayEquals(page.page("0","0","0","identity").getBody(),inflate(changed.getBody()));
            assertTrue(new String(inflate(changed.getBody()),StandardCharsets.UTF_8).contains("DOWN"));
            verify(mapper,times(2)).writeValueAsString(any());
            verify(data,times(17)).bootstrap();
        } finally {
            workers.shutdownNow();
            assertTrue(workers.awaitTermination(3,TimeUnit.SECONDS));
        }
    }

    @Test void demoHistoricalAndReplayShellsSupportBothRepresentationsWithoutLiveData() throws Exception {
        var page = new DashboardPageController(data,mapper,new DashboardProps(true,60,true));
        for (String[] mode : new String[][]{{"1","0","0"},{"0","1","0"},{"0","0","1"}}) {
            var identity = page.page(mode[0],mode[1],mode[2],"identity");
            var compressed = page.page(mode[0],mode[1],mode[2],"gzip");
            assertArrayEquals(identity.getBody(),inflate(compressed.getBody()));
            assertFalse(new String(inflate(compressed.getBody()),StandardCharsets.UTF_8).contains("dashboardBootstrap"));
        }
        verifyNoInteractions(data);
    }

    @Test void preparedBytesHaveAnEightMiBBoundAndOversizedResponsesRemainComplete() throws Exception {
        var current = new AtomicReference<>(Map.of("health", new Section(200,"one",fetched,Map.of("description",""))));
        when(data.bootstrap()).thenAnswer(call -> current.get());
        var page = new DashboardPageController(data,mapper,new DashboardProps(true,60,false));
        int overhead = page.page("0","0","0", "identity").getBody().length;
        int limit = 8 * 1024 * 1024;
        String padding = "x".repeat(limit-overhead-64*1024);
        current.set(Map.of("health",new Section(200,"one",fetched,Map.of("description",padding))));
        byte[] boundary = page.page("0","0","0", "identity").getBody();
        assertTrue(boundary.length + page.page("0","0","0","gzip").getBody().length <= limit);
        assertSame(boundary,page.page("0","0","0", "identity").getBody());
        current.set(Map.of("health",new Section(200,"one",fetched,Map.of("description","x".repeat(limit-overhead-1)))));
        byte[] identityFits = page.page("0","0","0","identity").getBody();
        byte[] compressed = page.page("0","0","0","gzip").getBody();
        assertEquals(limit-1,identityFits.length);
        assertTrue(identityFits.length + compressed.length > limit);
        assertNotSame(identityFits,page.page("0","0","0","identity").getBody());
        assertArrayEquals(identityFits,inflate(compressed));
        current.set(Map.of("health",new Section(200,"one",fetched,Map.of("description","x".repeat(limit-overhead+1)))));
        byte[] oversized = page.page("0","0","0", "identity").getBody();
        byte[] repeated = page.page("0","0","0", "identity").getBody();
        assertEquals(limit+1,oversized.length);
        assertArrayEquals(oversized,repeated);
        assertNotSame(oversized,repeated);
        verify(mapper,times(7)).writeValueAsString(any());
    }
}
