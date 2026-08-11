package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

class RetentionSchedulerConfigTest {

    @Test
    void retentionUsesItsOwnScheduler() throws Exception {
        Method method = TrafficRetentionJob.class.getMethod("archiveAndCleanup");
        Scheduled scheduled = method.getAnnotation(Scheduled.class);

        assertThat(scheduled).isNotNull();
        assertThat(scheduled.scheduler()).isEqualTo("retentionTaskScheduler");

        ThreadPoolTaskScheduler scheduler = new RetentionSchedulerConfig().retentionTaskScheduler();
        assertThat(scheduler.getPoolSize()).isOne();
        assertThat(scheduler.getThreadNamePrefix()).isEqualTo("retention-");
    }
}
