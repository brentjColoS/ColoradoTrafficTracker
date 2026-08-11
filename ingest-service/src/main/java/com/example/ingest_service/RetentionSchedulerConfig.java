package com.example.ingest_service;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration
public class RetentionSchedulerConfig {

    @Bean(name = "taskScheduler")
    ThreadPoolTaskScheduler applicationTaskScheduler() {
        return scheduler("scheduling-");
    }

    @Bean(name = "retentionTaskScheduler")
    ThreadPoolTaskScheduler retentionTaskScheduler() {
        return scheduler("retention-");
    }

    private static ThreadPoolTaskScheduler scheduler(String threadNamePrefix) {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix(threadNamePrefix);
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(30);
        return scheduler;
    }
}
