package com.example.api_service;

import com.example.api_service.dto.OperationalStatusDto;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/system", "/dashboard-api/system"})
public class OperationalStatusController {

    private final OperationalStatusService statusService;

    public OperationalStatusController(OperationalStatusService statusService) {
        this.statusService = statusService;
    }

    @GetMapping("/operational-status")
    public ResponseEntity<OperationalStatusDto> operationalStatus() {
        return ResponseEntity.ok(statusService.assess(OffsetDateTime.now(ZoneOffset.UTC)));
    }
}
