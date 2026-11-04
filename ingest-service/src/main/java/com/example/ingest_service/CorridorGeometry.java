package com.example.ingest_service;

import java.util.List;

record CorridorGeometry(List<double[]> polyline, boolean fromRouting) {
    CorridorGeometry(List<double[]> polyline) {
        this(polyline, false);
    }
}
