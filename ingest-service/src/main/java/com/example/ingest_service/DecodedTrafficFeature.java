package com.example.ingest_service;

import java.util.List;
import java.util.Map;

record DecodedTrafficFeature(
    String layerName,
    List<List<double[]>> paths,
    Map<String, Object> tags
) {}
