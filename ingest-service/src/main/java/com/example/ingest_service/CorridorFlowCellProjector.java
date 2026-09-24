package com.example.ingest_service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

final class CorridorFlowCellProjector {
    private static final double KPH_TO_MPH = 0.621371;
    private static final double METERS_PER_MILE = 1_609.344;
    private static final double COVERAGE_EPSILON_MILES = 0.001;
    private static final double DIRECTIONAL_ROUTE_BUFFER_METERS = 75.0;
    private static final double DIRECTIONAL_MAX_MEAN_DISTANCE_METERS = 40.0;
    private static final double DIRECTIONAL_MIN_DISTANCE_MARGIN_METERS = 5.0;
    private static final double DIRECTIONAL_MIN_PATH_COVERAGE = 0.8;

    private CorridorFlowCellProjector() {}

    static CorridorFlowCellSnapshot project(
        String corridor,
        Instant observedAt,
        int sourceZoom,
        Double routeStartMileMarker,
        Double routeEndMileMarker,
        List<DecodedTrafficFeature> decodedFeatures,
        List<double[]> route,
        double routeBufferMeters
    ) {
        return project(
            corridor,
            observedAt,
            sourceZoom,
            routeStartMileMarker,
            routeEndMileMarker,
            decodedFeatures,
            route,
            Map.of(),
            routeBufferMeters
        );
    }

    static CorridorFlowCellSnapshot project(
        String corridor,
        Instant observedAt,
        int sourceZoom,
        Double routeStartMileMarker,
        Double routeEndMileMarker,
        List<DecodedTrafficFeature> decodedFeatures,
        List<double[]> route,
        Map<String, List<double[]>> directionalRoutes,
        double routeBufferMeters
    ) {
        List<CorridorFlowCellGrid.Cell> grid = CorridorFlowCellGrid.between(
            corridor,
            routeStartMileMarker,
            routeEndMileMarker
        );
        if (grid.isEmpty()) {
            return empty(
                corridor,
                observedAt,
                sourceZoom,
                "INVALID_MARKER_RANGE",
                "The tracked mile-marker range is unavailable or invalid.",
                0,
                0,
                0
            );
        }
        if (route == null || route.size() < 2) {
            return empty(
                corridor,
                observedAt,
                sourceZoom,
                "ROUTE_UNAVAILABLE",
                "Configured corridor geometry is unavailable; no flow cells were projected.",
                grid.size(),
                0,
                0
            );
        }

        CorridorPathProjector pathProjector = new CorridorPathProjector(route);
        if (pathProjector.routeLengthMeters() <= 0.0) {
            return empty(
                corridor,
                observedAt,
                sourceZoom,
                "ROUTE_UNAVAILABLE",
                "Configured corridor geometry has no measurable length; no flow cells were projected.",
                grid.size(),
                0,
                0
            );
        }

        CorridorFlowPathExtractor.Result extracted = CorridorFlowPathExtractor.extract(
            decodedFeatures,
            pathProjector,
            routeBufferMeters
        );
        List<MappedObservation> observations = extracted.observations().stream()
            .map(observation -> mapObservation(
                observation,
                pathProjector.routeLengthMeters(),
                routeStartMileMarker,
                routeEndMileMarker,
                CorridorFlowCellSnapshot.Direction.COMBINED
            ))
            .filter(observation -> observation.markerSpanMiles() > 0.0)
            .toList();

        Map<CorridorFlowCellSnapshot.Direction, CorridorPathProjector> directionProjectors =
            directionalProjectors(directionalRoutes);
        List<MappedObservation> directionalObservations = extracted.observations().stream()
            .filter(observation -> isCoverage(observation.roadCoverage(), "one_side"))
            .map(observation -> {
                CorridorFlowCellSnapshot.Direction direction = matchedDirection(
                    observation,
                    directionProjectors
                );
                return direction == null ? null : mapObservation(
                    observation,
                    pathProjector.routeLengthMeters(),
                    routeStartMileMarker,
                    routeEndMileMarker,
                    direction
                );
            })
            .filter(java.util.Objects::nonNull)
            .filter(observation -> observation.markerSpanMiles() > 0.0)
            .toList();

        List<CorridorFlowCellSnapshot.Cell> supportedCells = new ArrayList<>();
        for (CorridorFlowCellGrid.Cell cell : grid) {
            CorridorFlowCellSnapshot.Cell projected = projectCell(
                cell,
                observations,
                CorridorFlowCellSnapshot.Direction.COMBINED
            );
            if (projected != null) supportedCells.add(projected);
            for (CorridorFlowCellSnapshot.Direction direction : directionalDirections()) {
                CorridorFlowCellSnapshot.Cell directional = projectCell(
                    cell,
                    directionalObservations.stream()
                        .filter(observation -> observation.direction() == direction)
                        .toList(),
                    direction
                );
                if (directional != null) supportedCells.add(directional);
            }
        }

        long combinedCellCount = supportedCells.stream()
            .filter(cell -> cell.direction() == CorridorFlowCellSnapshot.Direction.COMBINED)
            .count();
        long directionalCellCount = supportedCells.size() - combinedCellCount;
        String status = combinedCellCount == 0 ? "NO_MATCHING_PATHS" : "OBSERVED";
        String detail = combinedCellCount == 0
            ? "No unique speed-bearing motorway paths overlapped the tracked half-mile cells."
            : directionalCellCount == 0
                ? "Cells contain combined-direction, length-weighted observations. No one-side path was distinct enough to assign to a carriageway, so no travel direction is inferred."
                : "Cells retain combined observations and add " + directionalCellCount
                    + " carriageway-specific cells from distinct one-side path matches; ambiguous paths remain combined.";
        return new CorridorFlowCellSnapshot(
            normalizedCorridor(grid, corridor),
            observedAt,
            sourceZoom,
            status,
            detail,
            CorridorFlowCellGrid.CELL_SIZE_MILES,
            grid.size(),
            Math.toIntExact(combinedCellCount),
            observations.size(),
            extracted.duplicatePathCount(),
            List.copyOf(supportedCells)
        );
    }

    private static CorridorFlowCellSnapshot.Cell projectCell(
        CorridorFlowCellGrid.Cell cell,
        List<MappedObservation> observations,
        CorridorFlowCellSnapshot.Direction direction
    ) {
        List<Contribution> contributions = new ArrayList<>();
        for (MappedObservation observation : observations) {
            double overlapStart = Math.max(cell.startMileMarker(), observation.lowMileMarker());
            double overlapEnd = Math.min(cell.endMileMarker(), observation.highMileMarker());
            double overlapMiles = overlapEnd - overlapStart;
            if (overlapMiles > 0.0) {
                contributions.add(new Contribution(observation, overlapStart, overlapEnd, overlapMiles));
            }
        }
        if (contributions.isEmpty()) return null;

        double weightedSpeed = 0.0;
        double weightedSourceSpan = 0.0;
        double totalWeight = 0.0;
        int oneSideCount = 0;
        int fullCount = 0;
        int unknownCoverageCount = 0;
        List<String> closureCoverages = new ArrayList<>();
        MappedObservation finest = null;
        MappedObservation coarsest = null;
        for (Contribution contribution : contributions) {
            MappedObservation observation = contribution.observation();
            weightedSpeed += observation.speedMph() * contribution.overlapMiles();
            weightedSourceSpan += observation.sourceSpanMiles() * contribution.overlapMiles();
            totalWeight += contribution.overlapMiles();

            if (isCoverage(observation.roadCoverage(), "one_side")) oneSideCount++;
            else if (isCoverage(observation.roadCoverage(), "full")) fullCount++;
            else unknownCoverageCount++;

            if (observation.roadClosure()) {
                closureCoverages.add(observation.roadCoverage());
            }
            if (finest == null || observation.sourceSpanMiles() < finest.sourceSpanMiles()) {
                finest = observation;
            }
            if (coarsest == null || observation.sourceSpanMiles() > coarsest.sourceSpanMiles()) {
                coarsest = observation;
            }
        }

        double coveredMarkerMiles = coveredMarkerMiles(contributions);
        double cellLength = cell.endMileMarker() - cell.startMileMarker();
        CorridorFlowCellSnapshot.Quality quality = coveredMarkerMiles + COVERAGE_EPSILON_MILES >= cellLength
            ? CorridorFlowCellSnapshot.Quality.FULL_CELL
            : CorridorFlowCellSnapshot.Quality.PARTIAL_CELL;

        return new CorridorFlowCellSnapshot.Cell(
            cell.id(),
            cell.startMileMarker(),
            cell.endMileMarker(),
            direction,
            weightedSpeed / totalWeight,
            contributions.size(),
            oneSideCount,
            fullCount,
            unknownCoverageCount,
            closureEvidence(closureCoverages),
            rounded(coveredMarkerMiles),
            rounded(finest.sourceSpanMiles()),
            rounded(weightedSourceSpan / totalWeight),
            rounded(coarsest.sourceSpanMiles()),
            rounded(coarsest.lowMileMarker()),
            rounded(coarsest.highMileMarker()),
            quality
        );
    }

    private static MappedObservation mapObservation(
        CorridorFlowPathExtractor.PathObservation observation,
        double routeLengthMeters,
        double routeStartMileMarker,
        double routeEndMileMarker,
        CorridorFlowCellSnapshot.Direction direction
    ) {
        CorridorPathProjector.PathProjection projection = observation.projection();
        double startMarker = markerAt(
            projection.routeStartMeters(),
            routeLengthMeters,
            routeStartMileMarker,
            routeEndMileMarker
        );
        double endMarker = markerAt(
            projection.routeEndMeters(),
            routeLengthMeters,
            routeStartMileMarker,
            routeEndMileMarker
        );
        return new MappedObservation(
            Math.min(startMarker, endMarker),
            Math.max(startMarker, endMarker),
            observation.speedKph() * KPH_TO_MPH,
            observation.roadCoverage(),
            observation.roadClosure(),
            projection.routeSpanMeters() / METERS_PER_MILE,
            direction
        );
    }

    private static Map<CorridorFlowCellSnapshot.Direction, CorridorPathProjector> directionalProjectors(
        Map<String, List<double[]>> directionalRoutes
    ) {
        if (directionalRoutes == null || directionalRoutes.isEmpty()) return Map.of();
        Map<CorridorFlowCellSnapshot.Direction, CorridorPathProjector> projectors =
            new EnumMap<>(CorridorFlowCellSnapshot.Direction.class);
        directionalRoutes.forEach((directionName, route) -> {
            if (route == null || route.size() < 2) return;
            try {
                CorridorFlowCellSnapshot.Direction direction = CorridorFlowCellSnapshot.Direction.valueOf(
                    directionName.trim().toUpperCase(java.util.Locale.ROOT)
                );
                if (direction != CorridorFlowCellSnapshot.Direction.COMBINED) {
                    projectors.put(direction, new CorridorPathProjector(route));
                }
            } catch (IllegalArgumentException ignored) {
                // Unknown direction labels cannot safely identify a carriageway.
            }
        });
        return Map.copyOf(projectors);
    }

    private static CorridorFlowCellSnapshot.Direction matchedDirection(
        CorridorFlowPathExtractor.PathObservation observation,
        Map<CorridorFlowCellSnapshot.Direction, CorridorPathProjector> projectors
    ) {
        if (projectors.size() < 2 || observation.projection().pathLengthMeters() <= 0.0) return null;

        List<DirectionCandidate> candidates = new ArrayList<>();
        for (Map.Entry<CorridorFlowCellSnapshot.Direction, CorridorPathProjector> entry : projectors.entrySet()) {
            CorridorPathProjector.PathProjection projection = entry.getValue().longestContiguousPortion(
                observation.projection().path(),
                DIRECTIONAL_ROUTE_BUFFER_METERS
            );
            if (projection == null || projection.maximumRouteDistanceMeters() > DIRECTIONAL_ROUTE_BUFFER_METERS) {
                continue;
            }
            double coverage = projection.pathLengthMeters() / observation.projection().pathLengthMeters();
            if (coverage < DIRECTIONAL_MIN_PATH_COVERAGE) continue;
            candidates.add(new DirectionCandidate(entry.getKey(), projection.meanRouteDistanceMeters()));
        }
        if (candidates.isEmpty()) return null;

        List<DirectionCandidate> ordered = candidates.stream()
            .sorted(Comparator.comparingDouble(DirectionCandidate::meanDistanceMeters))
            .toList();
        DirectionCandidate best = ordered.get(0);
        if (best.meanDistanceMeters() > DIRECTIONAL_MAX_MEAN_DISTANCE_METERS) return null;
        if (ordered.size() > 1
            && best.meanDistanceMeters() + DIRECTIONAL_MIN_DISTANCE_MARGIN_METERS
                > ordered.get(1).meanDistanceMeters()) {
            return null;
        }
        return best.direction();
    }

    private static List<CorridorFlowCellSnapshot.Direction> directionalDirections() {
        return List.of(
            CorridorFlowCellSnapshot.Direction.NORTHBOUND,
            CorridorFlowCellSnapshot.Direction.SOUTHBOUND,
            CorridorFlowCellSnapshot.Direction.EASTBOUND,
            CorridorFlowCellSnapshot.Direction.WESTBOUND
        );
    }

    private static double markerAt(
        double routeMeters,
        double routeLengthMeters,
        double startMarker,
        double endMarker
    ) {
        double fraction = Math.max(0.0, Math.min(1.0, routeMeters / routeLengthMeters));
        return startMarker + ((endMarker - startMarker) * fraction);
    }

    private static double coveredMarkerMiles(List<Contribution> contributions) {
        List<Contribution> ordered = contributions.stream()
            .sorted(Comparator.comparingDouble(Contribution::overlapStart))
            .toList();
        double covered = 0.0;
        double rangeStart = ordered.get(0).overlapStart();
        double rangeEnd = ordered.get(0).overlapEnd();
        for (int i = 1; i < ordered.size(); i++) {
            Contribution next = ordered.get(i);
            if (next.overlapStart() <= rangeEnd) {
                rangeEnd = Math.max(rangeEnd, next.overlapEnd());
            } else {
                covered += rangeEnd - rangeStart;
                rangeStart = next.overlapStart();
                rangeEnd = next.overlapEnd();
            }
        }
        return covered + (rangeEnd - rangeStart);
    }

    private static CorridorFlowCellSnapshot.ClosureEvidence closureEvidence(List<String> coverages) {
        if (coverages.isEmpty()) return CorridorFlowCellSnapshot.ClosureEvidence.NONE;
        boolean oneSide = coverages.stream().anyMatch(coverage -> isCoverage(coverage, "one_side"));
        boolean full = coverages.stream().anyMatch(coverage -> isCoverage(coverage, "full"));
        boolean unknown = coverages.stream().anyMatch(coverage ->
            !isCoverage(coverage, "one_side") && !isCoverage(coverage, "full")
        );
        int categories = (oneSide ? 1 : 0) + (full ? 1 : 0) + (unknown ? 1 : 0);
        if (categories > 1) return CorridorFlowCellSnapshot.ClosureEvidence.MIXED_REPORTED;
        if (oneSide) return CorridorFlowCellSnapshot.ClosureEvidence.ONE_SIDE_REPORTED;
        if (full) return CorridorFlowCellSnapshot.ClosureEvidence.FULL_REPORTED;
        return CorridorFlowCellSnapshot.ClosureEvidence.UNSPECIFIED_REPORTED;
    }

    private static boolean isCoverage(String actual, String expected) {
        return actual != null && actual.equalsIgnoreCase(expected);
    }

    private static String normalizedCorridor(List<CorridorFlowCellGrid.Cell> grid, String corridor) {
        return grid.isEmpty() ? corridor : grid.get(0).corridor();
    }

    private static CorridorFlowCellSnapshot empty(
        String corridor,
        Instant observedAt,
        int sourceZoom,
        String status,
        String detail,
        int totalCellCount,
        int uniqueSourcePathCount,
        int duplicateSourcePathCount
    ) {
        return new CorridorFlowCellSnapshot(
            corridor,
            observedAt,
            sourceZoom,
            status,
            detail,
            CorridorFlowCellGrid.CELL_SIZE_MILES,
            totalCellCount,
            0,
            uniqueSourcePathCount,
            duplicateSourcePathCount,
            List.of()
        );
    }

    private static double rounded(double value) {
        return Math.round(value * 1_000.0) / 1_000.0;
    }

    private record MappedObservation(
        double lowMileMarker,
        double highMileMarker,
        double speedMph,
        String roadCoverage,
        boolean roadClosure,
        double sourceSpanMiles,
        CorridorFlowCellSnapshot.Direction direction
    ) {
        double markerSpanMiles() {
            return highMileMarker - lowMileMarker;
        }
    }

    private record Contribution(
        MappedObservation observation,
        double overlapStart,
        double overlapEnd,
        double overlapMiles
    ) {}

    private record DirectionCandidate(
        CorridorFlowCellSnapshot.Direction direction,
        double meanDistanceMeters
    ) {}
}
