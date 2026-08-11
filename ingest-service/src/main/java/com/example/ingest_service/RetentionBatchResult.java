package com.example.ingest_service;

record RetentionBatchResult(
    int archivedIncidents,
    int archivedSamples,
    int deletedSamples
) {}
