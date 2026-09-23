package com.example.ingest_service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class CorridorFlowCellGrid {
    static final double CELL_SIZE_MILES = 0.5;

    private CorridorFlowCellGrid() {}

    static List<Cell> between(String corridor, Double firstMarker, Double secondMarker) {
        if (corridor == null || corridor.isBlank() || firstMarker == null || secondMarker == null) {
            return List.of();
        }

        double lowMarker = Math.min(firstMarker, secondMarker);
        double highMarker = Math.max(firstMarker, secondMarker);
        if (!Double.isFinite(lowMarker) || !Double.isFinite(highMarker) || highMarker <= lowMarker) {
            return List.of();
        }

        String normalizedCorridor = corridor.trim().toUpperCase(Locale.ROOT);
        int cellCount = (int) Math.ceil((highMarker - lowMarker) / CELL_SIZE_MILES);
        List<Cell> cells = new ArrayList<>(cellCount);
        for (int sequence = 0; sequence < cellCount; sequence++) {
            double startMarker = roundedMarker(lowMarker + (sequence * CELL_SIZE_MILES));
            double endMarker = roundedMarker(Math.min(highMarker, startMarker + CELL_SIZE_MILES));
            cells.add(new Cell(
                normalizedCorridor + ":" + markerKey(startMarker) + "-" + markerKey(endMarker),
                normalizedCorridor,
                sequence,
                startMarker,
                endMarker
            ));
        }
        return List.copyOf(cells);
    }

    private static double roundedMarker(double marker) {
        return Math.round(marker * 1_000.0) / 1_000.0;
    }

    private static String markerKey(double marker) {
        return String.format(Locale.US, "%.3f", marker);
    }

    record Cell(
        String id,
        String corridor,
        int sequence,
        double startMileMarker,
        double endMileMarker
    ) {}
}
