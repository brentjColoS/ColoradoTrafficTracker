package com.example.api_service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@ConditionalOnProperty(name = "dashboard.startup-preparation.enabled", havingValue = "true")
public class DashboardStartupPreparation implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(DashboardStartupPreparation.class);
    private static final String BOOTSTRAP = "<script id=\"dashboardBootstrap\" type=\"application/json\">";
    private final DashboardPageController page;
    private final DashboardDataService data;
    private final DashboardProps props;
    private final ObjectMapper mapper;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final Duration deadline;

    @org.springframework.beans.factory.annotation.Autowired
    public DashboardStartupPreparation(DashboardPageController page, DashboardDataService data,
            DashboardProps props, ObjectMapper mapper, JdbcTemplate jdbc, PlatformTransactionManager manager) {
        this(page, data, props, mapper, jdbc, manager, Duration.ofSeconds(10));
    }

    DashboardStartupPreparation(DashboardPageController page, DashboardDataService data,
            DashboardProps props, ObjectMapper mapper, JdbcTemplate jdbc, PlatformTransactionManager manager,
            Duration deadline) {
        this.deadline = deadline;
        this.page = page; this.data = data; this.props = props; this.mapper = mapper; this.jdbc = jdbc;
        transaction = new TransactionTemplate(manager);
        transaction.setReadOnly(true);
        transaction.setTimeout(8);
    }

    @Override public void run(ApplicationArguments args) throws Exception {
        if (!props.publicDataEnabled()) return;
        long started = System.nanoTime();
        var worker = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "dashboard-startup-preparation");
            thread.setDaemon(true); return thread;
        });
        var task = worker.submit(() -> transaction.executeWithoutResult(status -> {
            jdbc.execute("SET LOCAL statement_timeout = '5s'");
            prepare();
        }));
        try {
            task.get(deadline.toMillis(), TimeUnit.MILLISECONDS);
            log.info("Dashboard startup preparation completed in {} ms",
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
        } catch (TimeoutException timeout) {
            throw unavailable("exceeded its ten-second deadline");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); throw unavailable("was interrupted");
        } catch (ExecutionException failed) {
            throw unavailable("failed (" + failed.getCause().getClass().getSimpleName() + ")");
        } finally {
            task.cancel(true); worker.shutdownNow();
            // The preparation runs before readiness, so its cached lifecycle health is temporary.
            data.invalidateStartupHealth();
            try {
                if (!worker.awaitTermination(1, TimeUnit.SECONDS)) throw unavailable("could not stop its worker");
            } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
        }
    }

    private void prepare() {
        try {
            Object body = page.page("0", "0", "0", "identity").getBody();
            String html = body instanceof byte[] bytes ? new String(bytes, StandardCharsets.UTF_8) : String.valueOf(body);
            int start = html.indexOf(BOOTSTRAP), end = start < 0 ? -1 : html.indexOf("</script>", start);
            if (start < 0 || end < 0) throw new IllegalStateException("Initial dashboard data was not prepared");
            JsonNode sections = mapper.readTree(html.substring(start + BOOTSTRAP.length(), end));
            for (String corridor : List.of("I25", "I70")) {
                boolean summary = false, history = false;
                var entries = sections.fields();
                while (entries.hasNext()) {
                    var entry = entries.next(); JsonNode value = entry.getValue();
                    if (value.path("status").asInt() != 200) continue;
                    if (entry.getKey().startsWith("/traffic/summary?corridor=" + corridor + "&"))
                        summary = value.path("data").path("latest").path("avgCurrentSpeed").isNumber();
                    if (entry.getKey().startsWith("/traffic/history?corridor=" + corridor + "&"))
                        history = !value.path("data").isMissingNode() && !value.path("data").isNull();
                }
                if (!summary || !history) throw new IllegalStateException("Initial corridor observations were unavailable");
            }
        } catch (Exception failed) {
            throw new IllegalStateException("Initial dashboard preparation was incomplete");
        }
    }

    private IllegalStateException unavailable(String reason) {
        return new IllegalStateException("Dashboard startup preparation " + reason
            + "; keep the previous experimental instance and check read-only database access and query limits");
    }
}
