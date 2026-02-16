package com.example.routes_service;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/routes")
public class CorridorController {

    private final RoutesProps routesProps;

    public CorridorController(RoutesProps routesProps) {
        this.routesProps = routesProps;
    }

    @GetMapping("/corridors")
    public List<RoutesProps.Corridor> corridors() {
        if (routesProps.corridors() == null) {
            return List.of();
        }
        return routesProps.corridors();
    }
}
