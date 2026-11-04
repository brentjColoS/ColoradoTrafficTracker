package com.example.ingest_service;

import java.util.Map;
import java.util.Set;

record TileCoveragePlan(
    Map<String, Integer> zoomByCorridor,
    Map<String, Set<TrafficTile>> tilesByCorridor,
    Set<TrafficTile> uniqueTiles
) {}
