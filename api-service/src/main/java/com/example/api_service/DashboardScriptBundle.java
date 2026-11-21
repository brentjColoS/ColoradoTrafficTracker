package com.example.api_service;

import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Pattern;
import java.util.zip.GZIPOutputStream;
import org.springframework.core.io.ClassPathResource;

final class DashboardScriptBundle {
    private static final Pattern SCRIPT = Pattern.compile("<script src=\"([^\"]+)\"(?: defer)?></script>");
    private final String html;
    private final byte[] body;
    private final String version;
    private final byte[] gzip;
    private final String gzipVersion;

    DashboardScriptBundle(String template) throws IOException {
        var scripts = SCRIPT.matcher(template);
        var source = new StringBuilder();
        while (scripts.find()) {
            String file = scripts.group(1).split("\\?", 2)[0];
            if (!file.matches("[a-z0-9-]+\\.js")) throw new IOException("Unsupported dashboard script path");
            source.append(new ClassPathResource("static/dashboard/" + file)
                .getContentAsString(StandardCharsets.UTF_8)).append("\n;\n");
        }
        if (source.isEmpty()) throw new IOException("Dashboard scripts are missing");
        body = source.toString().getBytes(StandardCharsets.UTF_8);
        var compressed = new ByteArrayOutputStream();
        try (var encoder = new GZIPOutputStream(compressed)) { encoder.write(body); }
        gzip = compressed.toByteArray();
        try {
            version = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
            gzipVersion = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(gzip));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
        html = SCRIPT.matcher(template).replaceAll("").replace("</head>",
            "<script src=\"dashboard-scripts.js?v=" + version + "\" defer></script>\n</head>");
    }

    String html() { return html; }
    byte[] body() { return body; }
    String version() { return version; }
    byte[] gzip() { return gzip; }
    String gzipVersion() { return gzipVersion; }
}
