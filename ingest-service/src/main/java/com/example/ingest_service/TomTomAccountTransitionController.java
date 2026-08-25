package com.example.ingest_service;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/tomtom/account-transitions")
public class TomTomAccountTransitionController {

    private final TomTomAccountTransitionHistory history;

    public TomTomAccountTransitionController(TomTomAccountTransitionHistory history) {
        this.history = history;
    }

    @GetMapping
    public List<TomTomAccountTransitionEvent> history(
        @RequestParam(name = "limit", defaultValue = "90") int limit
    ) {
        return history.recent(limit);
    }
}
