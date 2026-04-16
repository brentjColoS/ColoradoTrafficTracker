package com.example.api_service;

import com.example.api_service.dto.TrafficProviderGuardStatusDto;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/system", "/dashboard-api/system"})
public class TrafficProviderGuardController {

    private static final String PROVIDER_NAME = "tomtom";

    private final ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider;

    public TrafficProviderGuardController(ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider) {
        this.statusRepositoryProvider = statusRepositoryProvider;
    }

    @GetMapping("/provider-status")
    public ResponseEntity<TrafficProviderGuardStatusDto> providerStatus() {
        TrafficProviderGuardStatusRepository statusRepository = statusRepositoryProvider.getIfAvailable();
        TrafficProviderGuardStatus status = Optional.ofNullable(statusRepository)
            .flatMap(repository -> repository.findById(PROVIDER_NAME))
            .orElse(null);
        if (status == null) {
            return ResponseEntity.ok(new TrafficProviderGuardStatusDto(
                PROVIDER_NAME,
                "UNKNOWN",
                false,
                null,
                "No provider guard status has been recorded yet.",
                null,
                0,
                null,
                null,
                null,
                null
            ));
        }

        return ResponseEntity.ok(new TrafficProviderGuardStatusDto(
            status.getProviderName(),
            status.getState(),
            status.isHalted(),
            status.getFailureCode(),
            status.getMessage(),
            status.getDetailsJson(),
            status.getConsecutiveNullCycles(),
            status.getLastCheckedAt(),
            status.getLastSuccessAt(),
            status.getLastFailureAt(),
            status.getShutdownTriggeredAt()
        ));
    }
}
