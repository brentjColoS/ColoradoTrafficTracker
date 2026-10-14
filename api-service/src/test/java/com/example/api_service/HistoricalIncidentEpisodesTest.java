package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementCreator;
import org.springframework.jdbc.core.RowMapper;

class HistoricalIncidentEpisodesTest {
    final Instant boundary=Instant.parse("2026-06-22T00:00:00Z");

    @Test void weeklySeamsDoNotSplitContinuousIncidentsAndGapsDo() {
        var rows=List.of(new HistoricalIncidentEpisodes.Episode("a",boundary.minusSeconds(600),boundary.minusSeconds(30)),
            new HistoricalIncidentEpisodes.Episode("a",boundary.plusSeconds(30),boundary.plusSeconds(600)),
            new HistoricalIncidentEpisodes.Episode("a",boundary.plusSeconds(1000),boundary.plusSeconds(1200)),
            new HistoricalIncidentEpisodes.Episode("b",boundary,boundary));
        assertEquals(3,HistoricalIncidentEpisodes.count(rows,boundary.minusSeconds(3600),boundary.plusSeconds(7200)));
        assertEquals(1,HistoricalIncidentEpisodes.count(rows,boundary.plusSeconds(800),boundary.plusSeconds(7200)));
        assertEquals(0,HistoricalIncidentEpisodes.count(rows,boundary.plusSeconds(1201),boundary.plusSeconds(7200)));
        assertEquals(1,HistoricalIncidentEpisodes.count(rows,boundary.plusSeconds(1200),boundary.plusSeconds(7200)));
    }

    @Test void utcWeeksAreStableAndCountsAreNotCapped() {
        assertEquals(boundary,HistoricalIncidentEpisodes.week(boundary));
        assertEquals(boundary.minusSeconds(7*86400L),HistoricalIncidentEpisodes.week(boundary.minusNanos(1)));
        var rows=java.util.stream.IntStream.range(0,1501)
            .mapToObj(i->new HistoricalIncidentEpisodes.Episode("event"+i,boundary,boundary)).toList();
        assertEquals(1501,HistoricalIncidentEpisodes.count(rows,boundary.minusSeconds(3600),boundary.plusSeconds(3600)));
    }

    @SuppressWarnings("unchecked")
    @Test void nearbyWindowsAndTimeframesReuseTheSameCompactBlocks() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        var first=HistoricalIncidentEpisodes.week(boundary.minusSeconds(3600));
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenReturn(List.of(
            new HistoricalIncidentEpisodes.Endpoint(first,"a",boundary.minusSeconds(300),true,true),
            new HistoricalIncidentEpisodes.Endpoint(boundary,"a",boundary.plusSeconds(60),true,true)));
        var repository=new HistoricalIncidentEpisodes(provider);
        assertEquals(2,repository.count("I25",boundary.minusSeconds(3600),boundary.plusSeconds(3600)));
        assertEquals(2,repository.count("I25",boundary.minusSeconds(7200),boundary.plusSeconds(7200)));
        assertEquals(1,repository.count("I25",boundary.plusSeconds(1),boundary.plusSeconds(7200)));
        verify(jdbc,times(1)).query(any(PreparedStatementCreator.class),any(RowMapper.class));
    }

    @SuppressWarnings("unchecked")
    @Test void failedQueriesAreNotCachedAsEmptyHistory() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class)))
            .thenThrow(new IllegalStateException("Unavailable")).thenReturn(List.of());
        var repository=new HistoricalIncidentEpisodes(provider);
        assertThrows(IllegalStateException.class,()->repository.count("I25",boundary,boundary.plusSeconds(7200)));
        assertEquals(0,repository.count("I25",boundary,boundary.plusSeconds(7200)));
        assertEquals(0,repository.count("I25",boundary.plusSeconds(1),boundary.plusSeconds(7200)));
        verify(jdbc,times(2)).query(any(PreparedStatementCreator.class),any(RowMapper.class));
    }

    @SuppressWarnings("unchecked")
    @Test void simultaneousNearbyReadsJoinTheSameLookupInsteadOfDuplicatingIt() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenAnswer(call->{
            entered.countDown();release.await(2,java.util.concurrent.TimeUnit.SECONDS);
            return List.of(new HistoricalIncidentEpisodes.Endpoint(boundary,"a",boundary.plusSeconds(3600),true,true));
        });
        var repository=new HistoricalIncidentEpisodes(provider);var executor=java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var first=executor.submit(()->repository.count("I25",boundary,boundary.plusSeconds(7200)));
            assertTrue(entered.await(2,java.util.concurrent.TimeUnit.SECONDS));
            var second=executor.submit(()->repository.count("I25",boundary.plusSeconds(1),boundary.plusSeconds(7200)));
            assertThrows(java.util.concurrent.TimeoutException.class,()->second.get(50,java.util.concurrent.TimeUnit.MILLISECONDS));
            release.countDown();assertEquals(1,first.get(2,java.util.concurrent.TimeUnit.SECONDS));assertEquals(1,second.get(2,java.util.concurrent.TimeUnit.SECONDS));
            verify(jdbc,times(1)).query(any(PreparedStatementCreator.class),any(RowMapper.class));
        } finally {release.countDown();executor.shutdownNow();}
    }
}
