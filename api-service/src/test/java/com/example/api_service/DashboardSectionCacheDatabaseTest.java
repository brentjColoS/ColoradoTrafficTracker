package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.SQLException;
import java.time.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

@EnabledIfEnvironmentVariable(named="CTT_COUNTER_DISPOSABLE_DB_URL", matches=".+")
class DashboardSectionCacheDatabaseTest {
    @Test void slowBackgroundQueryIsCancelledWithoutRenewingRetainedEvidence() throws Exception {
        var source=new DriverManagerDataSource(System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL"),
            System.getenv().getOrDefault("CTT_COUNTER_DISPOSABLE_DB_USER","postgres"),
            System.getenv().getOrDefault("CTT_COUNTER_DISPOSABLE_DB_PASSWORD",""));
        var jdbc=new JdbcTemplate(source);
        var transaction=new TransactionTemplate(new DataSourceTransactionManager(source));
        transaction.setReadOnly(true);transaction.setTimeout(1);
        var now=new AtomicReference<>(Instant.parse("2026-11-09T12:00:00Z"));
        Clock clock=new Clock() {
            public ZoneId getZone(){return ZoneOffset.UTC;}
            public Clock withZone(ZoneId zone){return this;}
            public Instant instant(){return now.get();}
        };
        var worker=Executors.newSingleThreadExecutor();
        var cache=new DashboardSectionCache(new ObjectMapper(),clock,worker);
        cache.useRefreshTransactions(transaction);
        var finished=new CountDownLatch(1);
        var failure=new AtomicReference<DataAccessException>();
        try {
            var original=cache.read("/traffic/history?corridor=I25",10,()->ResponseEntity.ok("retained"));
            now.set(now.get().plusSeconds(11));
            var retained=cache.read("/traffic/history?corridor=I25",10,()->{
                try {
                    assertEquals("on",jdbc.queryForObject("show transaction_read_only",String.class));
                    jdbc.execute("select pg_sleep(5)");
                    return ResponseEntity.ok("unexpected");
                } catch(DataAccessException error) {failure.set(error);throw error;}
                finally {finished.countDown();}
            });
            assertTrue(retained.refreshing());assertEquals(original.fetchedAt(),retained.fetchedAt());
            assertTrue(finished.await(3,TimeUnit.SECONDS),"The one-second transaction timeout must cancel the five-second query");
            assertNotNull(failure.get());
            var sql=assertInstanceOf(SQLException.class,failure.get().getMostSpecificCause());
            assertEquals("57014",sql.getSQLState());
            worker.submit(()->{}).get(3,TimeUnit.SECONDS);
            now.set(now.get().plusSeconds(10));
            assertEquals("recovered",cache.read("/traffic/history?corridor=I25",10,()->{
                assertEquals(1,jdbc.queryForObject("select 1",Integer.class));
                return ResponseEntity.ok("recovered");
            }).data());
        } finally {cache.close();worker.shutdownNow();assertTrue(worker.awaitTermination(3,TimeUnit.SECONDS));}
    }
}
