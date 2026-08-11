package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

class RetentionSchedulerConfigTest {

    @Test
    void retentionUsesItsOwnScheduler() throws Exception {
        Method method = TrafficRetentionJob.class.getMethod("archiveAndCleanup");
        Scheduled scheduled = method.getAnnotation(Scheduled.class);

        assertThat(scheduled).isNotNull();
        assertThat(scheduled.scheduler()).isEqualTo("retentionTaskScheduler");

        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext(
            RetentionSchedulerConfig.class
        )) {
            ThreadPoolTaskScheduler applicationScheduler = context.getBean(
                "taskScheduler",
                ThreadPoolTaskScheduler.class
            );
            ThreadPoolTaskScheduler retentionScheduler = context.getBean(
                "retentionTaskScheduler",
                ThreadPoolTaskScheduler.class
            );
            assertThat(applicationScheduler).isNotSameAs(retentionScheduler);
            assertThat(applicationScheduler.getScheduledThreadPoolExecutor().getCorePoolSize()).isOne();
            assertThat(applicationScheduler.getThreadNamePrefix()).isEqualTo("scheduling-");
            assertThat(retentionScheduler.getScheduledThreadPoolExecutor().getCorePoolSize()).isOne();
            assertThat(retentionScheduler.getThreadNamePrefix()).isEqualTo("retention-");
        }
    }
}
