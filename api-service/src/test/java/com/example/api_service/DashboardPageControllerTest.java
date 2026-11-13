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
        String html = new String(page.page("0","0","0").getBody(),StandardCharsets.UTF_8);
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
                    return page.page("0","0","0");
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
        byte[] first = page.page("0","0","0").getBody();
        current.set(Map.of("health",new Section(200,"changed",fetched,Map.of("status","UP"))));
        byte[] versioned = page.page("0","0","0").getBody();
        assertNotSame(first,versioned);
        assertTrue(new String(versioned,StandardCharsets.UTF_8).contains("changed"));
        current.set(Map.of("health",new Section(200,"changed",fetched.plusSeconds(1),Map.of("status","UP"))));
        byte[] observed = page.page("0","0","0").getBody();
        assertNotSame(versioned,observed);
        assertNotEquals(new String(versioned,StandardCharsets.UTF_8),new String(observed,StandardCharsets.UTF_8));
        current.set(Map.of("health",new Section(503,"changed",fetched.plusSeconds(1),Map.of("status","DOWN"))));
        byte[] failed = page.page("0","0","0").getBody();
        assertNotSame(observed,failed);
        assertTrue(new String(failed,StandardCharsets.UTF_8).contains("\"status\":503"));
        current.set(Map.of("health",new Section(503,"changed",fetched.plusSeconds(1),Map.of("status","RECOVERING"))));
        byte[] recovering = page.page("0","0","0").getBody();
        assertNotSame(failed,recovering);
        assertTrue(new String(recovering,StandardCharsets.UTF_8).contains("RECOVERING"));
        verify(mapper,times(5)).writeValueAsString(any());
    }

    @Test void preparedBytesHaveAnEightMiBBoundAndOversizedResponsesRemainComplete() throws Exception {
        var current = new AtomicReference<>(Map.of("health", new Section(200,"one",fetched,Map.of("description",""))));
        when(data.bootstrap()).thenAnswer(call -> current.get());
        var page = new DashboardPageController(data,mapper,new DashboardProps(true,60,false));
        int overhead = page.page("0","0","0").getBody().length;
        int limit = 8 * 1024 * 1024;
        String padding = "x".repeat(limit-overhead);
        current.set(Map.of("health",new Section(200,"one",fetched,Map.of("description",padding))));
        byte[] boundary = page.page("0","0","0").getBody();
        assertEquals(limit,boundary.length);
        assertSame(boundary,page.page("0","0","0").getBody());
        current.set(Map.of("health",new Section(200,"one",fetched,Map.of("description",padding+"x"))));
        byte[] oversized = page.page("0","0","0").getBody();
        byte[] repeated = page.page("0","0","0").getBody();
        assertEquals(limit+1,oversized.length);
        assertArrayEquals(oversized,repeated);
        assertNotSame(oversized,repeated);
        verify(mapper,times(4)).writeValueAsString(any());
    }
}
