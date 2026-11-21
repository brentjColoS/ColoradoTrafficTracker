package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

class DashboardStartupPreparationTest {
    private final DashboardPageController page = mock(DashboardPageController.class);
    private final DashboardDataService data = mock(DashboardDataService.class);
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    private final ObjectMapper mapper = new ObjectMapper();

    private DashboardStartupPreparation preparation(boolean publicData, Duration deadline) {
        when(manager.getTransaction(any())).thenAnswer(invocation -> {
            TransactionDefinition definition = invocation.getArgument(0);
            assertTrue(definition.isReadOnly()); assertEquals(8, definition.getTimeout());
            return new SimpleTransactionStatus();
        });
        return new DashboardStartupPreparation(page, data, new DashboardProps(publicData, 20, false),
            mapper, jdbc, manager, deadline);
    }

    private String html(boolean secondCorridor) throws Exception {
        var sections = new LinkedHashMap<String, Object>();
        for (String corridor : secondCorridor ? List.of("I25", "I70") : List.of("I25")) {
            sections.put("/traffic/summary?corridor=" + corridor + "&windowHours=168",
                Map.of("status", 200, "data", Map.of("latest", Map.of("avgCurrentSpeed", 61))));
            sections.put("/traffic/history?corridor=" + corridor + "&windowMinutes=1440",
                Map.of("status", 200, "data", Map.of("samples", List.of())));
        }
        return "<html><head><script id=\"dashboardBootstrap\" type=\"application/json\">"
            + mapper.writeValueAsString(sections) + "</script></head></html>";
    }

    @Test void preparesBothCorridorsInReadOnlyScopeAndDiscardsStartupHealth() throws Exception {
        doAnswer(invocation -> ResponseEntity.ok(html(true))).when(page).page("0", "0", "0", "identity");
        preparation(true, Duration.ofSeconds(2)).run(null);
        verify(jdbc).execute("SET LOCAL statement_timeout = '5s'");
        verify(data).invalidateStartupHealth(); verify(manager).commit(any());
    }

    @Test void skipsPrivateDashboardsWithoutStartingWork() throws Exception {
        preparation(false, Duration.ofSeconds(2)).run(null);
        verifyNoInteractions(page, data, jdbc);
        verify(manager, never()).getTransaction(any());
    }

    @Test void refusesIncompleteCorridorPreparationWithAnOperatorAction() throws Exception {
        doAnswer(invocation -> ResponseEntity.ok(html(false))).when(page).page("0", "0", "0", "identity");
        var error = assertThrows(IllegalStateException.class,
            () -> preparation(true, Duration.ofSeconds(2)).run(null));
        assertTrue(error.getMessage().contains("keep the previous experimental instance"));
        verify(manager).rollback(any()); verify(data).invalidateStartupHealth();
    }

    @Test void cancelsBlockedPreparationInsteadOfLeavingAWorkerRunning() throws Exception {
        var entered = new CountDownLatch(1); var cancelled = new CountDownLatch(1);
        doAnswer(invocation -> {
            entered.countDown();
            try { new CountDownLatch(1).await(); }
            catch (InterruptedException interrupted) { cancelled.countDown(); throw interrupted; }
            return null;
        }).when(page).page("0", "0", "0", "identity");
        var error = assertThrows(IllegalStateException.class,
            () -> preparation(true, Duration.ofMillis(200)).run(null));
        assertEquals(0, entered.getCount()); assertTrue(cancelled.await(1, TimeUnit.SECONDS));
        assertTrue(error.getMessage().contains("deadline")); verify(data).invalidateStartupHealth();
    }
}
