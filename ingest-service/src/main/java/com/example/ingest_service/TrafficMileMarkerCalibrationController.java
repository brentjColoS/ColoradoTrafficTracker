package com.example.ingest_service;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
@RequestMapping("/internal/traffic/mile-marker-calibration")
public class TrafficMileMarkerCalibrationController {
    private final TrafficMileMarkerCalibrationService calibrationService;

    public TrafficMileMarkerCalibrationController(TrafficMileMarkerCalibrationService calibrationService) {
        this.calibrationService = calibrationService;
    }

    @PostMapping("/run")
    public Mono<ResponseEntity<TrafficMileMarkerCalibrationService.CalibrationReport>> runCalibration(
        @RequestParam(name = "lookbackHours", required = false) Integer lookbackHours,
        @RequestParam(name = "corridor", required = false) String corridor
    ) {
        return Mono.fromCallable(() -> calibrationService.recalibrateRecentIncidents(lookbackHours, corridor))
            .subscribeOn(Schedulers.boundedElastic())
            .map(ResponseEntity::ok)
            .onErrorResume(TrafficMileMarkerCalibrationService.CalibrationInProgressException.class,
                ex -> Mono.just(ResponseEntity.status(HttpStatus.CONFLICT).build()));
    }
}
