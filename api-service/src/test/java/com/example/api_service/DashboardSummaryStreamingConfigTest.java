package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskRejectedException;

class DashboardSummaryStreamingConfigTest {
    @Test void streamsHaveBoundedWorkersAndQueueWithAConcreteCapacityResponse() throws Exception {
        var executor=new DashboardSummaryStreamingConfig().dashboardSummaryStreamingExecutor();
        executor.initialize();
        CountDownLatch running=new CountDownLatch(2),release=new CountDownLatch(1);
        Runnable task=()->{running.countDown();try{release.await(2,TimeUnit.SECONDS);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}};
        try {
            executor.execute(task);executor.execute(task);assertTrue(running.await(2,TimeUnit.SECONDS));
            executor.execute(task);executor.execute(task);
            assertThrows(TaskRejectedException.class,()->executor.execute(task));
            var response=new DashboardSummaryStreamingConfig.CapacityHandler().busy();
            assertEquals(503,response.getStatusCode().value());assertEquals("1",response.getHeaders().getFirst("Retry-After"));
            assertTrue(response.getBody().get("reason").contains("Sync now"));
        } finally {release.countDown();executor.shutdown();}
    }
}
