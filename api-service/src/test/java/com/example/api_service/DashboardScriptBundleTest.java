package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class DashboardScriptBundleTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"gzip", "br, gzip, deflate", " GZIP ; Q=0.5 ", "*;q=1", "gzip;q=0.4,identity;q=0.2"})
    void compressedScriptsReuseExactBytesAndRevalidateTheirOwnRepresentation(String encoding) throws Exception {
        var page = new DashboardPageController(mock(DashboardDataService.class), new ObjectMapper(), new DashboardProps(true,60,false));
        var identity = page.scripts("");
        var compressed = page.scripts(encoding);
        assertEquals("gzip", compressed.getHeaders().getFirst("Content-Encoding"));
        assertEquals(java.util.List.of("Accept-Encoding"), compressed.getHeaders().getVary());
        assertSame(compressed.getBody(), page.scripts(encoding).getBody());
        assertNotEquals(identity.getHeaders().getETag(), compressed.getHeaders().getETag());
        try (var input = new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(compressed.getBody()))) {
            assertArrayEquals(identity.getBody(), input.readAllBytes());
        }
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(page).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/dashboard/dashboard-scripts.js")
            .header("Accept-Encoding", encoding).header("If-None-Match", compressed.getHeaders().getETag()))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotModified());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/dashboard/dashboard-scripts.js")
            .header("Accept-Encoding", "identity").header("If-None-Match", compressed.getHeaders().getETag()))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"", "br", "identity", "gzip;q=0,*;q=1", "gzip;q=0.5,identity;q=1", "gzip;q=bad", "gzip;q=NaN", "gzip;q=2", "gzip;q=-1", ";"})
    void refusedOrInvalidCompressionKeepsIdentityScriptsUsable(String encoding) throws Exception {
        var page = new DashboardPageController(mock(DashboardDataService.class), new ObjectMapper(), new DashboardProps(true,60,false));
        var response = page.scripts(encoding);
        assertNull(response.getHeaders().getFirst("Content-Encoding"));
        assertSame(page.scripts("").getBody(), response.getBody());
        assertEquals("no-cache", response.getHeaders().getCacheControl());
    }

    private static String source(String name) throws IOException {
        return new ClassPathResource("static/dashboard/" + name).getContentAsString(StandardCharsets.UTF_8);
    }

    @Test void servedPageDiscoversOneContentVersionedBundleBeforeItsBootstrap() throws Exception {
        var data = mock(DashboardDataService.class);
        var page = new DashboardPageController(data, new ObjectMapper(), new DashboardProps(true,60,false));
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(page).build();
        String html = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/dashboard/index.html"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertEquals(1, html.split("<script src=", -1).length - 1);
        assertTrue(html.indexOf("dashboard-scripts.js?v=") < html.indexOf("id=\"dashboardBootstrap\""));
        assertTrue(html.contains("\" defer></script>"));
        var response = page.scripts("");
        byte[] body = response.getBody();
        assertNotNull(body);
        String version = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        assertTrue(html.contains("dashboard-scripts.js?v=" + version));
        assertEquals('"' + version + '"', response.getHeaders().getETag());
        assertEquals("no-cache", response.getHeaders().getCacheControl());
        assertEquals("text/javascript;charset=UTF-8", response.getHeaders().getContentType().toString());
        assertSame(body, page.scripts("").getBody());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/dashboard/dashboard-scripts.js")
            .header("If-None-Match", response.getHeaders().getETag()))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotModified())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().string(""));
    }

    @Test void existingScriptOrderAndSeparatorsArePreservedAndContentChangesVersion() throws Exception {
        String one = "<head></head><body><script src=\"incident-types.js?v=one\" defer></script>"
            + "<script src=\"variable-speed-signs.js?v=two\"></script></body>";
        var bundle = new DashboardScriptBundle(one);
        assertEquals(source("incident-types.js") + "\n;\n" + source("variable-speed-signs.js") + "\n;\n",
            new String(bundle.body(), StandardCharsets.UTF_8));
        var reversed = new DashboardScriptBundle(one.replace("incident-types.js", "placeholder.js")
            .replace("variable-speed-signs.js", "incident-types.js").replace("placeholder.js", "variable-speed-signs.js"));
        assertNotEquals(bundle.version(), reversed.version());
        assertEquals(bundle.version(), new DashboardScriptBundle(one.replace("?v=one", "?v=changed")).version());
        assertTrue(bundle.html().contains("<body>"));
    }

    @Test void missingScriptsAndUnsupportedPathsFailBeforeServingAPartialBundle() {
        assertThrows(IOException.class, () -> new DashboardScriptBundle("<head></head>"));
        for (String file : new String[]{"../dashboard.js", "https://example.invalid/script.js", "missing-fixture.js"}) {
            assertThrows(IOException.class, () -> new DashboardScriptBundle("<head></head><script src=\"" + file + "\" defer></script>"));
        }
    }
}
