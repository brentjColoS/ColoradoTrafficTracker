package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowCallbackHandler;

class StoredObservationRepositoryTest {
    final Clock clock = Clock.fixed(Instant.parse("2026-10-14T23:00:00Z"), ZoneOffset.UTC);

    @Test void combinesBothCorridorsAndUsesOneTimeoutBoundedStatement() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        doAnswer(call -> {
            call.<PreparedStatementCreator>getArgument(0).createPreparedStatement(connection);
            var callback = call.<RowCallbackHandler>getArgument(1);
            for (var entry : Map.of("I25", 100L, "I70", 200L).entrySet()) {
                ResultSet row = mock(ResultSet.class);
                when(row.getString("corridor")).thenReturn(entry.getKey());
                when(row.getLong("observations")).thenReturn(entry.getValue());
                when(row.getTimestamp("first_observed_at")).thenReturn(java.sql.Timestamp.from(
                    Instant.parse(entry.getKey().equals("I25") ? "2026-04-12T00:00:00Z" : "2026-05-01T00:00:00Z")));
                callback.processRow(row);
            }
            return null;
        }).when(jdbc).query(any(PreparedStatementCreator.class), any(RowCallbackHandler.class));
        var result = new StoredObservationRepository(jdbc, clock).totals();
        assertEquals(300,result.total()); assertEquals(clock.instant(),result.observedAt());
        assertEquals(Map.of("I25",100L,"I70",200L),result.corridors());
        assertEquals(Instant.parse("2026-04-12T00:00:00Z"), result.firstObservedAt());
        verify(statement).setQueryTimeout(1);
        verify(jdbc,times(1)).query(any(PreparedStatementCreator.class),any(RowCallbackHandler.class));
    }

    @Test void emptyDatabaseReportsRealZeroAndMissingDatabaseDoesNot() {
        var empty = new StoredObservationRepository(mock(JdbcTemplate.class),clock).totals();
        assertEquals(0,empty.total()); assertEquals(Map.of("I25",0L,"I70",0L),empty.corridors());
        assertNull(empty.firstObservedAt());
        assertThrows(IllegalStateException.class,() -> new StoredObservationRepository(null,clock).totals());
        @SuppressWarnings("unchecked") ObjectProvider<JdbcTemplate> provider = mock(ObjectProvider.class);
        assertThrows(IllegalStateException.class,() -> new StoredObservationRepository(provider).totals());
    }

    @Test void databaseFailureIsNotConvertedToAnEmptyDatabase() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doThrow(new IllegalStateException("Unavailable")).when(jdbc)
            .query(any(PreparedStatementCreator.class),any(RowCallbackHandler.class));
        assertThrows(IllegalStateException.class,() -> new StoredObservationRepository(jdbc,clock).totals());
    }
}
