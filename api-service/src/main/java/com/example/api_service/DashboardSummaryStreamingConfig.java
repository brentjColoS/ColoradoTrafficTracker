package com.example.api_service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.config.annotation.AsyncSupportConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.util.Map;

@Configuration
public class DashboardSummaryStreamingConfig implements WebMvcConfigurer {
    @Bean
    public ThreadPoolTaskExecutor dashboardSummaryStreamingExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2); executor.setMaxPoolSize(2); executor.setQueueCapacity(2);
        executor.setThreadNamePrefix("dashboard-summary-");
        executor.setAllowCoreThreadTimeOut(true);
        return executor;
    }

    @Override public void configureAsyncSupport(AsyncSupportConfigurer configurer) {
        configurer.setTaskExecutor(dashboardSummaryStreamingExecutor()).setDefaultTimeout(15_000);
    }

    @RestControllerAdvice(assignableTypes = DashboardWindowSummaryController.class)
    public static class CapacityHandler {
        @ExceptionHandler(TaskRejectedException.class)
        public ResponseEntity<Map<String,String>> busy() {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).header("Retry-After", "1")
                .body(Map.of("reason", "Summary capacity is busy; select Sync now to retry."));
        }
    }
}
