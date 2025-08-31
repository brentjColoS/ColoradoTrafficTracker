package com.example.ingest_service;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@ConfigurationPropertiesScan
public class TrafficBackendApplication {
	public static void main(String[] args) {
		SpringApplication.run(TrafficBackendApplication.class, args);
	}
}
