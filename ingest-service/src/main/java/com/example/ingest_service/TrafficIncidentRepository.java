package com.example.ingest_service;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TrafficIncidentRepository extends JpaRepository<TrafficIncident, Long> {}
