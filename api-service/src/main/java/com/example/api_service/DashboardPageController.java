package com.example.api_service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DashboardPageController {
    private final DashboardDataService data;
    private final ObjectMapper mapper;
    private final String html;
    private final DashboardProps props;

    public DashboardPageController(DashboardDataService data, ObjectMapper mapper, DashboardProps props) throws IOException {
        this.data = data; this.mapper = mapper; this.props = props;
        html = new ClassPathResource("static/dashboard/index.html").getContentAsString(StandardCharsets.UTF_8);
    }

    @GetMapping(value = "/dashboard/index.html", produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> page(@RequestParam(name = "demo", defaultValue = "0") String demo,
        @RequestParam(name = "historical", defaultValue = "0") String historical, @RequestParam(name = "replay", defaultValue = "0") String replay)
        throws JsonProcessingException {
        String body = html;
        if (props.publicDataEnabled() && !"1".equals(demo) && !"1".equals(historical) && !"1".equals(replay)) {
            String bootstrap = mapper.writeValueAsString(data.snapshot(List.of(24), 24, false, Set.of()))
                .replace("<", "\\u003c").replace("&", "\\u0026");
            body = html.replace("</head>", "<script id=\"dashboardBootstrap\" type=\"application/json\">"
                + bootstrap + "</script></head>");
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}
