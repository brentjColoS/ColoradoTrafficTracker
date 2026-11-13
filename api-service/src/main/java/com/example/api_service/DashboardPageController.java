package com.example.api_service;

import com.example.api_service.DashboardDataController.Section;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DashboardPageController {
    private static final int MAX_PREPARED_BYTES = 8 * 1024 * 1024;
    private static final MediaType HTML_UTF8 = new MediaType(MediaType.TEXT_HTML, StandardCharsets.UTF_8);
    private final DashboardDataService data;
    private final ObjectMapper mapper;
    private final String html;
    private final DashboardScriptBundle scripts;
    private final DashboardProps props;
    private final byte[] shell;
    private record PreparedPage(Map<String, Section> sections, byte[] body) {}
    private PreparedPage prepared;

    public DashboardPageController(DashboardDataService data, ObjectMapper mapper, DashboardProps props) throws IOException {
        this.data = data; this.mapper = mapper; this.props = props;
        scripts = new DashboardScriptBundle(new ClassPathResource("static/dashboard/index.html")
            .getContentAsString(StandardCharsets.UTF_8));
        html = scripts.html().replace("<html ", "<html data-replay-enabled=\"" + props.replayEnabled() + "\" ");
        shell = html.getBytes(StandardCharsets.UTF_8);
    }

    @GetMapping(value = "/dashboard/dashboard-scripts.js", produces = "text/javascript")
    public ResponseEntity<byte[]> scripts() {
        return ResponseEntity.ok().contentType(new MediaType("text", "javascript", StandardCharsets.UTF_8))
            .cacheControl(CacheControl.noCache()).eTag(scripts.version()).body(scripts.body());
    }

    @GetMapping(value = "/dashboard/index.html", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<byte[]> page(@RequestParam(name = "demo", defaultValue = "0") String demo,
        @RequestParam(name = "historical", defaultValue = "0") String historical, @RequestParam(name = "replay", defaultValue = "0") String replay)
        throws JsonProcessingException {
        byte[] body = shell;
        if (props.publicDataEnabled() && !"1".equals(demo) && !"1".equals(historical)
            && !(props.replayEnabled() && "1".equals(replay))) {
            body = currentPage(data.bootstrap());
        }
        return ResponseEntity.ok().contentType(HTML_UTF8).cacheControl(CacheControl.noStore()).body(body);
    }

    private synchronized byte[] currentPage(Map<String, Section> sections) throws JsonProcessingException {
        // Compare the entire section: status, data and fetch/refresh evidence must all match.
        if (prepared != null && prepared.sections().equals(sections)) return prepared.body();
        String bootstrap = mapper.writeValueAsString(sections).replace("<", "\\u003c").replace("&", "\\u0026");
        byte[] body = html.replace("</head>", "<script id=\"dashboardBootstrap\" type=\"application/json\">"
            + bootstrap + "</script></head>").getBytes(StandardCharsets.UTF_8);
        prepared = body.length <= MAX_PREPARED_BYTES ? new PreparedPage(Map.copyOf(sections), body) : null;
        return body;
    }
}
