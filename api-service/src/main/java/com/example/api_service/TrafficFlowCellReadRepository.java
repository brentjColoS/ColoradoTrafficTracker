package com.example.api_service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface TrafficFlowCellReadRepository extends Repository<TrafficSample, Long> {
    @Query(
        value = """
            select
                corridor as corridor,
                observed_at as observedAt,
                source_zoom as sourceZoom,
                status as status,
                detail as detail,
                cell_size_miles as cellSizeMiles,
                total_cell_count as totalCellCount,
                supported_cell_count as supportedCellCount,
                unique_source_path_count as uniqueSourcePathCount,
                duplicate_source_path_count as duplicateSourcePathCount
            from traffic_flow_cell_snapshot_current
            where corridor = :corridor
            """,
        nativeQuery = true
    )
    List<CurrentFlowCellSnapshotProjection> findCurrentSnapshot(
        @Param("corridor") String corridor
    );

    @Query(
        value = """
            select
                cell_id as cellId,
                observed_at as observedAt,
                start_mile_marker as startMileMarker,
                end_mile_marker as endMileMarker,
                direction as direction,
                speed_mph as speedMph,
                source_path_count as sourcePathCount,
                one_side_source_count as oneSideSourceCount,
                full_source_count as fullSourceCount,
                unknown_coverage_source_count as unknownCoverageSourceCount,
                closure_evidence as closureEvidence,
                covered_marker_miles as coveredMarkerMiles,
                finest_source_span_miles as finestSourceSpanMiles,
                length_weighted_source_span_miles as lengthWeightedSourceSpanMiles,
                coarsest_source_span_miles as coarsestSourceSpanMiles,
                coarsest_source_start_mile_marker as coarsestSourceStartMileMarker,
                coarsest_source_end_mile_marker as coarsestSourceEndMileMarker,
                quality as quality
            from traffic_flow_cell_current
            where corridor = :corridor
            order by start_mile_marker asc, direction asc
            """,
        nativeQuery = true
    )
    List<CurrentFlowCellProjection> findCurrentCells(@Param("corridor") String corridor);

    @Query(
        value = """
            select
                cell_id as cellId,
                direction as direction,
                start_mile_marker as startMileMarker,
                end_mile_marker as endMileMarker,
                source_zoom_min as sourceZoomMin,
                source_zoom_max as sourceZoomMax,
                observation_count as observationCount,
                avg_speed_mph as avgSpeedMph,
                min_speed_mph as minSpeedMph,
                max_speed_mph as maxSpeedMph,
                full_cell_observation_count as fullCellObservationCount,
                partial_cell_observation_count as partialCellObservationCount,
                closure_observation_count as closureObservationCount,
                min_finest_source_span_miles as minFinestSourceSpanMiles,
                avg_length_weighted_source_span_miles as avgLengthWeightedSourceSpanMiles,
                max_coarsest_source_span_miles as maxCoarsestSourceSpanMiles,
                first_observed_at as firstObservedAt,
                last_observed_at as lastObservedAt
            from traffic_flow_cell_hourly
            where corridor = :corridor
              and hour_start = :hourStart
            order by start_mile_marker asc, direction asc
            """,
        nativeQuery = true
    )
    List<HourlyFlowCellProjection> findHourlyCells(
        @Param("corridor") String corridor,
        @Param("hourStart") OffsetDateTime hourStart
    );
}

interface CurrentFlowCellSnapshotProjection {
    String getCorridor();
    Instant getObservedAt();
    Integer getSourceZoom();
    String getStatus();
    String getDetail();
    Double getCellSizeMiles();
    Integer getTotalCellCount();
    Integer getSupportedCellCount();
    Integer getUniqueSourcePathCount();
    Integer getDuplicateSourcePathCount();
}

interface CurrentFlowCellProjection {
    String getCellId();
    Instant getObservedAt();
    Double getStartMileMarker();
    Double getEndMileMarker();
    String getDirection();
    Double getSpeedMph();
    Integer getSourcePathCount();
    Integer getOneSideSourceCount();
    Integer getFullSourceCount();
    Integer getUnknownCoverageSourceCount();
    String getClosureEvidence();
    Double getCoveredMarkerMiles();
    Double getFinestSourceSpanMiles();
    Double getLengthWeightedSourceSpanMiles();
    Double getCoarsestSourceSpanMiles();
    Double getCoarsestSourceStartMileMarker();
    Double getCoarsestSourceEndMileMarker();
    String getQuality();
}

interface HourlyFlowCellProjection {
    String getCellId();
    String getDirection();
    Double getStartMileMarker();
    Double getEndMileMarker();
    Integer getSourceZoomMin();
    Integer getSourceZoomMax();
    Integer getObservationCount();
    Double getAvgSpeedMph();
    Double getMinSpeedMph();
    Double getMaxSpeedMph();
    Integer getFullCellObservationCount();
    Integer getPartialCellObservationCount();
    Integer getClosureObservationCount();
    Double getMinFinestSourceSpanMiles();
    Double getAvgLengthWeightedSourceSpanMiles();
    Double getMaxCoarsestSourceSpanMiles();
    Instant getFirstObservedAt();
    Instant getLastObservedAt();
}
