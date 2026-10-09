package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
    @ParameterizedTest
    @ValueSource(strings = {"taskScheduler", "retentionTaskScheduler"})
    void shutdownFinishesRunningWorkAndCancelsFutureSchedules(String schedulerName) throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicBoolean interrupted = new AtomicBoolean();
        try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext(
            RetentionSchedulerConfig.class
        ); var releaser = Executors.newSingleThreadScheduledExecutor()) {
            try {
                ThreadPoolTaskScheduler scheduler = context.getBean(schedulerName, ThreadPoolTaskScheduler.class);
                var running = scheduler.submit(() -> {
                    started.countDown();
                    try {
                        release.await();
                    } catch (InterruptedException exception) {
                        interrupted.set(true);
                        Thread.currentThread().interrupt();
                    }
                });
                assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
                var queued = scheduler.schedule(() -> { }, Instant.now().plusSeconds(3_600));
                releaser.schedule(release::countDown, 250, TimeUnit.MILLISECONDS);

                scheduler.shutdown();

                assertThat(running.isDone()).isTrue();
                assertThat(interrupted).isFalse();
                assertThat(queued.isCancelled()).isTrue();
                assertThat(scheduler.getScheduledThreadPoolExecutor().isTerminated()).isTrue();
            } finally {
                release.countDown();
            }
        }
    }

}
