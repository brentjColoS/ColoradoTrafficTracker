package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TileCoveragePlannerTest {
    private final TileCoveragePlanner planner = new TileCoveragePlanner(11);
    private static final CorridorGeometry ROUTE = new CorridorGeometry(
        List.of(new double[]{0, 0}, new double[]{0, 0.01}));

    @Test
    void normalizesOverridesClampsZoomAndIgnoresMalformedEntries() {
        var zooms = planner.requestedZoomByCorridor(List.of(corridor("I25"), corridor("I70")),
            -1, " i70=9,I25:999,I70=bad,missing-pair,=12");

        assertThat(zooms).containsEntry("I25", 22).containsEntry("I70", 9);
        assertThat(planner.requestedZoomByCorridor(List.of(corridor("I25")), -1, ""))
            .containsEntry("I25", 0);
    }

    @Test
    void deduplicatesSharedTilesAcrossCorridorsAndUsesBoundingBoxWithoutGeometry() {
        var plan = planner.build(List.of(corridor("I25"), corridor("I70")),
            Map.of("I25", ROUTE, "I70", ROUTE), Map.of("I25", 10, "I70", 10));

        assertThat(plan.uniqueTiles()).containsExactly(new TrafficTile(10, 512, 512));
        assertThat(plan.tilesByCorridor().get("I25")).isEqualTo(plan.tilesByCorridor().get("I70"));
        var fallback = planner.build(List.of(corridor("I70")), Map.of(), Map.of("I70", 10));
        assertThat(fallback.uniqueTiles()).containsExactlyInAnyOrder(
            new TrafficTile(10, 511, 511), new TrafficTile(10, 511, 512),
            new TrafficTile(10, 512, 511), new TrafficTile(10, 512, 512));
    }

    @Test
    void skipsInvalidCoverageWithoutDiscardingValidCorridors() {
        var bad = new TrafficProps.Corridor("bad", "bad", "bad", "", "", null, null,
            List.of(), "invalid", null, null, null);
        var plan = planner.build(List.of(corridor("I70"), bad), Map.of("I70", ROUTE), Map.of());

        assertThat(plan.tilesByCorridor()).containsOnlyKeys("I70");
        assertThat(plan.uniqueTiles()).hasSize(1);
    }

    @Test
    void budgetPlanningStopsAtWorldCoverageEvenWhenTheTargetCannotBeMet() {
        var plan = planner.resolve(List.of(corridor("I70")), Map.of("I70", ROUTE),
            Map.of("I70", 10), 0, 0, 60);

        assertThat(plan.zoomByCorridor()).containsEntry("I70", 0);
        assertThat(plan.uniqueTiles()).containsExactly(new TrafficTile(0, 0, 0));
        assertThat(TileCoveragePlanner.estimateCallsPerMonth(8, 60)).isEqualTo(357120.0);
        assertThat(TileCoveragePlanner.estimateCallsPerMonth(1, 0)).isEqualTo(2678400.0);
    }

    @Test
    void finerPrecisionExcludesEveryTileUsedByAnotherCorridor() {
        var shared = new TrafficTile(10, 213, 388);
        var exclusive = new TrafficTile(10, 212, 388);
        var plan = new TileCoveragePlan(Map.of("I25", 10, "I70", 10),
            Map.of("I25", Set.of(shared), "I70", Set.of(shared, exclusive)), Set.of(shared, exclusive));
        var geometry = Map.of("I25", ROUTE, "I70", ROUTE);

        assertThat(planner.fineFlowTiles(plan, geometry, TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH))
            .containsExactly(exclusive);
        assertThat(planner.fineFlowTiles(plan, geometry, TrafficPullProps.Precision.DEFAULT)).isEmpty();
        assertThat(planner.fineFlowTiles(plan, Map.of("I70", ROUTE),
            TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH)).isEmpty();
        var alsoShared = new TileCoveragePlan(plan.zoomByCorridor(),
            Map.of("I25", Set.of(shared), "I70", Set.of(exclusive), "other", Set.of(exclusive)), plan.uniqueTiles());
        assertThat(planner.fineFlowTiles(alsoShared, geometry, TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH))
            .isEmpty();
    }

    private static TrafficProps.Corridor corridor(String name) {
        return new TrafficProps.Corridor(name, name, name, "", "", 260.0, 261.0,
            List.of(), "0,0,0,0.01", null, null, null);
    }
}
