package com.example.traffic_backend;

import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;


@RestController
@RequestMapping("/api/traffic")
public class TrafficController {
    private final TrafficSampleRepository repo;
    public TrafficController(TrafficSampleRepository repo) {this.repo = repo;}

    @GetMapping("/latest")
    public TrafficSample latest(@RequestParam String corridor) {
        return repo.findByCorridorOrderByPolledAtDesc(corridor, PageRequest.of(0,1))
            .stream().findFirst().orElse(null);
    }

    @GetMapping("/health")
    public String health() {return "ok";}
}
