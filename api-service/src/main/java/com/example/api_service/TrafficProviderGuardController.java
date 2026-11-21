package com.example.api_service;

import com.example.api_service.dto.TrafficProviderGuardStatusDto;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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
    private final DashboardProps dashboardProps;

    public TrafficProviderGuardController(
        ObjectProvider<TrafficProviderGuardStatusRepository> statusRepositoryProvider,
        DashboardProps dashboardProps
    ) {
        this.statusRepositoryProvider = statusRepositoryProvider;
        this.dashboardProps = dashboardProps;
    }

    @GetMapping("/provider-status")
    public ResponseEntity<TrafficProviderGuardStatusDto> providerStatus() {
        TrafficProviderGuardStatusRepository statusRepository = statusRepositoryProvider.getIfAvailable();
        TrafficProviderGuardStatus status = Optional.ofNullable(statusRepository)
            .flatMap(repository -> repository.findById(PROVIDER_NAME))
            .orElse(null);
        return ResponseEntity.ok(TrafficProviderGuardPresentation.toDto(
            status, OffsetDateTime.now(ZoneOffset.UTC), dashboardProps.providerStatusStaleAfterMinutes()));
    }

}
