package com.example.ingest_service;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

@Component
public class TrafficMileMarkerCalibrationStartup implements ApplicationRunner {
    private final TrafficMileMarkerCalibrationService calibrationService;
    private final TrafficMileMarkerCalibrationProps props;

    public TrafficMileMarkerCalibrationStartup(
        TrafficMileMarkerCalibrationService calibrationService,
        TrafficMileMarkerCalibrationProps props
    ) {
        this.calibrationService = calibrationService;
        this.props = props;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!props.enabled() || !props.runOnStartup()) {
            return;
        }
        calibrationService.recalibrateRecentIncidents();
    }
}
