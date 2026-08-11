package com.example.api_service;

import com.example.api_service.dto.IncidentModelParityDto;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/traffic/incidents")
public class IncidentModelParityController {

    private final IncidentModelParityService parityService;

    public IncidentModelParityController(IncidentModelParityService parityService) {
        this.parityService = parityService;
    }

    @GetMapping("/parity")
    public IncidentModelParityDto parity() {
        return parityService.compare();
    }
}
