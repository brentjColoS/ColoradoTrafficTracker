package com.example.ingest_service;

import java.util.ArrayList;
import java.util.List;

final class CorridorPathProjector {
    private static final double EARTH_RADIUS_METERS = 6_371_008.8;

    private final List<double[]> route;
    private final double[] cumulativeRouteMeters;

    CorridorPathProjector(List<double[]> route) {
        if (route == null || route.size() < 2) {
            throw new IllegalArgumentException("Corridor route requires at least two points");
        }
        this.route = route;
        this.cumulativeRouteMeters = cumulativeDistances(route);
    }

    PathProjection longestContiguousPortion(List<double[]> path, double routeBufferMeters) {
        if (path == null || path.size() < 2) return null;

        List<PointProjection> vertexProjections = new ArrayList<>(path.size());
        for (double[] point : path) {
            vertexProjections.add(project(point));
        }

        List<List<double[]>> matchingRuns = new ArrayList<>();
        List<double[]> currentRun = null;
        for (int i = 0; i < path.size() - 1; i++) {
            double[] start = path.get(i);
            double[] end = path.get(i + 1);
            boolean startInside = vertexProjections.get(i).distanceMeters() <= routeBufferMeters;
            boolean endInside = vertexProjections.get(i + 1).distanceMeters() <= routeBufferMeters;

            if (startInside && currentRun == null) {
                currentRun = new ArrayList<>();
                currentRun.add(start);
            }

            if (startInside && endInside) {
                currentRun.add(end);
            } else if (startInside) {
                currentRun.add(boundaryPoint(start, end, true, routeBufferMeters));
                matchingRuns.add(currentRun);
                currentRun = null;
            } else if (endInside) {
                currentRun = new ArrayList<>();
                currentRun.add(boundaryPoint(start, end, false, routeBufferMeters));
                currentRun.add(end);
            }
        }
        if (currentRun != null) matchingRuns.add(currentRun);

        PathProjection longest = null;
        for (List<double[]> run : matchingRuns) {
            PathProjection projection = projectRun(run);
            if (projection != null && (longest == null
                || projection.pathLengthMeters() > longest.pathLengthMeters())) {
                longest = projection;
            }
        }
        return longest;
    }

    double routeLengthMeters() {
        return cumulativeRouteMeters[cumulativeRouteMeters.length - 1];
    }

    private PathProjection projectRun(List<double[]> run) {
        if (run == null || run.size() < 2) return null;

        double maximumRouteDistanceMeters = 0.0;
        for (double[] point : run) {
            maximumRouteDistanceMeters = Math.max(
                maximumRouteDistanceMeters,
                project(point).distanceMeters()
            );
        }

        PointProjection start = project(run.get(0));
        PointProjection end = project(run.get(run.size() - 1));
        return new PathProjection(
            List.copyOf(run),
            pathLengthMeters(run),
            start.alongRouteMeters(),
            end.alongRouteMeters(),
            maximumRouteDistanceMeters
        );
    }

    private double[] boundaryPoint(
        double[] start,
        double[] end,
        boolean startInside,
        double routeBufferMeters
    ) {
        double insideFraction = startInside ? 0.0 : 1.0;
        double outsideFraction = startInside ? 1.0 : 0.0;
        for (int i = 0; i < 16; i++) {
            double candidateFraction = (insideFraction + outsideFraction) / 2.0;
            double[] candidate = interpolate(start, end, candidateFraction);
            if (project(candidate).distanceMeters() <= routeBufferMeters) {
                insideFraction = candidateFraction;
            } else {
                outsideFraction = candidateFraction;
            }
        }
        return interpolate(start, end, insideFraction);
    }

    private PointProjection project(double[] point) {
        double bestDistanceMeters = Double.POSITIVE_INFINITY;
        double bestAlongRouteMeters = 0.0;
        for (int i = 0; i < route.size() - 1; i++) {
            SegmentProjection projection = projectToSegment(point, route.get(i), route.get(i + 1));
            if (projection.distanceMeters() < bestDistanceMeters) {
                bestDistanceMeters = projection.distanceMeters();
                bestAlongRouteMeters = cumulativeRouteMeters[i]
                    + (projection.fraction() * (cumulativeRouteMeters[i + 1] - cumulativeRouteMeters[i]));
            }
        }
        return new PointProjection(bestAlongRouteMeters, bestDistanceMeters);
    }

    private static SegmentProjection projectToSegment(double[] point, double[] start, double[] end) {
        double referenceLatitude = Math.toRadians((point[0] + start[0] + end[0]) / 3.0);
        double startX = Math.toRadians(start[1] - point[1]) * EARTH_RADIUS_METERS * Math.cos(referenceLatitude);
        double startY = Math.toRadians(start[0] - point[0]) * EARTH_RADIUS_METERS;
        double endX = Math.toRadians(end[1] - point[1]) * EARTH_RADIUS_METERS * Math.cos(referenceLatitude);
        double endY = Math.toRadians(end[0] - point[0]) * EARTH_RADIUS_METERS;
        double deltaX = endX - startX;
        double deltaY = endY - startY;
        double lengthSquared = (deltaX * deltaX) + (deltaY * deltaY);
        double fraction = lengthSquared == 0.0
            ? 0.0
            : Math.max(0.0, Math.min(1.0, -((startX * deltaX) + (startY * deltaY)) / lengthSquared));
        double closestX = startX + (fraction * deltaX);
        double closestY = startY + (fraction * deltaY);
        return new SegmentProjection(fraction, Math.hypot(closestX, closestY));
    }

    private static double[] cumulativeDistances(List<double[]> route) {
        double[] cumulative = new double[route.size()];
        for (int i = 1; i < route.size(); i++) {
            cumulative[i] = cumulative[i - 1] + haversineMeters(route.get(i - 1), route.get(i));
        }
        return cumulative;
    }

    private static double pathLengthMeters(List<double[]> path) {
        double total = 0.0;
        for (int i = 1; i < path.size(); i++) {
            total += haversineMeters(path.get(i - 1), path.get(i));
        }
        return total;
    }

    private static double haversineMeters(double[] start, double[] end) {
        double latitudeDelta = Math.toRadians(end[0] - start[0]);
        double longitudeDelta = Math.toRadians(end[1] - start[1]);
        double value = Math.sin(latitudeDelta / 2.0) * Math.sin(latitudeDelta / 2.0)
            + Math.cos(Math.toRadians(start[0])) * Math.cos(Math.toRadians(end[0]))
            * Math.sin(longitudeDelta / 2.0) * Math.sin(longitudeDelta / 2.0);
        return 2.0 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(value));
    }

    private static double[] interpolate(double[] start, double[] end, double fraction) {
        return new double[]{
            start[0] + ((end[0] - start[0]) * fraction),
            start[1] + ((end[1] - start[1]) * fraction)
        };
    }

    record PathProjection(
        List<double[]> path,
        double pathLengthMeters,
        double routeStartMeters,
        double routeEndMeters,
        double maximumRouteDistanceMeters
    ) {
        double routeSpanMeters() {
            return Math.abs(routeOrderDeltaMeters());
        }

        double routeOrderDeltaMeters() {
            return routeEndMeters - routeStartMeters;
        }
    }

    private record PointProjection(double alongRouteMeters, double distanceMeters) {}
    private record SegmentProjection(double fraction, double distanceMeters) {}
}
