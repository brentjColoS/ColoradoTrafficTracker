package com.example.api_service;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CorridorRefRepository extends JpaRepository<CorridorRef, String> {
    List<CorridorRef> findAllByOrderByCodeAsc();
}
