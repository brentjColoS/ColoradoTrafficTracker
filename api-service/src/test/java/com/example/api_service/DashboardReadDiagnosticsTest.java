package com.example.api_service;

import static com.example.api_service.DashboardReadDiagnostics.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.sql.SQLException;
import java.time.Clock;
import java.util.ArrayList;
import java.util.concurrent.CancellationException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

class DashboardReadDiagnosticsTest {
    @Test void groupsDifferentRequestKeysAndReportsSuppressionWithoutRecordingSensitiveText() {
        var clock = mock(Clock.class);
        var events = new ArrayList<Event>();
        var diagnostics = new DashboardReadDiagnostics(clock, events::add);
        String privateText = "https://origin.invalid/?password=PRIVATE_TEST_SENTINEL";
        var sql = new SQLException("select '" + privateText + "'");
        var error = new DataAccessResourceFailureException(privateText, sql);
        error.setStackTrace(new StackTraceElement[]{
            new StackTraceElement("com.example.api_service.DashboardSectionCache", "load", privateText, 23),
            new StackTraceElement("other.vendor.Untrusted", "render", "Other.java", 99)
        });
        var scope = cacheScope("/traffic/history?asOf=2026-11-20T12:00Z&corridor=I25");
        diagnostics.report(scope, Stage.LOAD, error);
        when(clock.millis()).thenReturn(59_999L);
        for (int n = 0; n < 200; n++) {
            diagnostics.report(cacheScope("/traffic/history?corridor=I25&asOf=" + n + "&other=" + privateText), Stage.LOAD, error);
        }
        assertThat(events).hasSize(1);
        when(clock.millis()).thenReturn(60_000L);
        diagnostics.report(scope, Stage.LOAD, error);
        assertThat(events).hasSize(2);
        assertThat(events.getLast().scope()).isEqualTo(new Scope(Dataset.HISTORY, Corridor.I25));
        assertThat(events.getLast().cause()).isEqualTo(Cause.SOURCE_READ);
        assertThat(events.getLast().suppressed()).isEqualTo(200);
        assertThat(events.getLast().types()).containsExactly(DataAccessResourceFailureException.class.getName(), SQLException.class.getName());
        assertThat(events.getLast().frames()).containsExactly("com.example.api_service.DashboardSectionCache.load");
        assertThat(events.toString()).doesNotContain(privateText, "PRIVATE_TEST_SENTINEL", "select", "2026-11-20", "other.vendor");

        diagnostics.report(cacheScope("/untrusted/PRIVATE_TEST_SENTINEL?corridor=elsewhere"), Stage.LOAD, error);
        diagnostics.report(cacheScope("baseline|I70|false|2026-11-15"), Stage.LOAD, error);
        assertThat(events.get(2).scope()).isEqualTo(new Scope(Dataset.UNKNOWN, Corridor.UNKNOWN));
        assertThat(events.getLast().scope()).isEqualTo(new Scope(Dataset.BASELINES, Corridor.I70));
        diagnostics.report(scope, Stage.LOAD, error);
        when(clock.millis()).thenReturn(360_000L);
        diagnostics.report(scope, Stage.LOAD, error);
        assertThat(events.getLast().suppressed()).isZero();
    }

    @Test void ordinaryCancellationAndWrappedInterruptionAreNotReadFailures() {
        var events = new ArrayList<Event>();
        var diagnostics = new DashboardReadDiagnostics(Clock.systemUTC(), events::add);
        var scope = new Scope(Dataset.BOOTSTRAP, Corridor.ALL);
        diagnostics.report(scope, Stage.STARTUP_PAGE, new CancellationException("ignored"));
        diagnostics.report(scope, Stage.STARTUP_TRANSACTION, new IllegalStateException(new InterruptedException("ignored")));
        assertThat(events).isEmpty();
    }
}
