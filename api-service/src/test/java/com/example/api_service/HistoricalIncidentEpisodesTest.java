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

    @SuppressWarnings("unchecked")
    @Test void mixedEraSeamExcludesOnlyContinuousKnownIdentitiesAndIgnoresLaterLegacyCopies() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        Instant week=HistoricalIncidentEpisodes.week(boundary.minusSeconds(3600));
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenReturn(List.of(
            new HistoricalIncidentEpisodes.Endpoint(week,"provider|cdot|bridge",boundary.minusSeconds(30),true,true),
            new HistoricalIncidentEpisodes.Endpoint(week,"provider|cdot|old-gap",boundary.minusSeconds(181),true,true),
            new HistoricalIncidentEpisodes.Endpoint(week,"legacy|unknown",boundary.minusSeconds(30),true,true),
            new HistoricalIncidentEpisodes.Endpoint(week,"finished",boundary.minusSeconds(600),true,true),
            new HistoricalIncidentEpisodes.Endpoint(week,"later-copy",boundary.plusSeconds(60),true,true)));
        var repository=new HistoricalIncidentEpisodes(provider);
        assertEquals(3,repository.countBefore("I25",boundary.minusSeconds(3600),boundary,
            List.of("provider|cdot|bridge","provider|cdot|old-gap"),System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(10)));
    }

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
    @Test void coldReadsBoundEachDatabaseSortAndReuseCompletedBlocks() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenReturn(List.of());
        var repository=new HistoricalIncidentEpisodes(provider);
        assertEquals(0,repository.count("I25",boundary.minusSeconds(3600),boundary.plusSeconds(30*86400L)));
        var creators=org.mockito.ArgumentCaptor.forClass(PreparedStatementCreator.class);
        verify(jdbc,times(3)).query(creators.capture(),any(RowMapper.class));
        for(var creator:creators.getAllValues()) {
            var connection=mock(java.sql.Connection.class);var statement=mock(java.sql.PreparedStatement.class);
            when(connection.prepareStatement(anyString())).thenReturn(statement);creator.createPreparedStatement(connection);
            var left=org.mockito.ArgumentCaptor.forClass(Object.class);var right=org.mockito.ArgumentCaptor.forClass(Object.class);
            verify(statement).setObject(eq(2),left.capture());verify(statement).setObject(eq(3),right.capture());
            long seconds=java.time.Duration.between((java.time.OffsetDateTime)left.getValue(),(java.time.OffsetDateTime)right.getValue()).getSeconds();
            assertTrue(seconds>0 && seconds<=14*86400L);
        }
        assertEquals(0,repository.count("I25",boundary,boundary.plusSeconds(7200)));
        verify(jdbc,times(3)).query(any(PreparedStatementCreator.class),any(RowMapper.class));
    }

    @SuppressWarnings("unchecked")
    @Test void completedBatchesSurviveALaterFailureWithoutInventingEmptyHistory() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class)))
            .thenReturn(List.of()).thenThrow(new IllegalStateException("Cold deadline")).thenReturn(List.of());
        var repository=new HistoricalIncidentEpisodes(provider);
        assertThrows(IllegalStateException.class,()->repository.count("I25",boundary,boundary.plusSeconds(30*86400L)));
        assertEquals(0,repository.count("I25",boundary,boundary.plusSeconds(30*86400L)));
        verify(jdbc,times(4)).query(any(PreparedStatementCreator.class),any(RowMapper.class));
    }

    @SuppressWarnings("unchecked")
    @Test void exhaustedReadBudgetsDoNotStartAnotherDatabaseQuery() {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        var repository=new HistoricalIncidentEpisodes(provider);
        assertThrows(IllegalStateException.class,()->repository.count("I25",boundary,boundary.plusSeconds(7200),System.nanoTime()-1));
        verifyNoInteractions(jdbc);
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
    @SuppressWarnings("unchecked")
    @Test void waitingShortWindowReceivesItsBlockWhileLongRangeContinues() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        var firstEntered=new java.util.concurrent.CountDownLatch(1);var firstRelease=new java.util.concurrent.CountDownLatch(1);
        var laterEntered=new java.util.concurrent.CountDownLatch(1);var laterRelease=new java.util.concurrent.CountDownLatch(1);
        var calls=new java.util.concurrent.atomic.AtomicInteger();
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenAnswer(call->{
            if(calls.incrementAndGet()==1) {firstEntered.countDown();assertTrue(firstRelease.await(2,java.util.concurrent.TimeUnit.SECONDS));}
            else {laterEntered.countDown();assertTrue(laterRelease.await(2,java.util.concurrent.TimeUnit.SECONDS));}
            return List.of();
        });
        var repository=new HistoricalIncidentEpisodes(provider);var executor=java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var longer=executor.submit(()->repository.count("I25",boundary,boundary.plusSeconds(30*86400L)));
            assertTrue(firstEntered.await(2,java.util.concurrent.TimeUnit.SECONDS));
            var shorter=executor.submit(()->repository.count("I25",boundary.plusSeconds(7*86400L),boundary.plusSeconds(7*86400L+3600)));
            assertThrows(java.util.concurrent.TimeoutException.class,()->shorter.get(50,java.util.concurrent.TimeUnit.MILLISECONDS));
            firstRelease.countDown();assertTrue(laterEntered.await(2,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(0,shorter.get(1,java.util.concurrent.TimeUnit.SECONDS));
            assertFalse(longer.isDone());
            laterRelease.countDown();assertEquals(0,longer.get(2,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(3,calls.get());
        } finally {firstRelease.countDown();laterRelease.countDown();executor.shutdownNow();}
    }

    @SuppressWarnings("unchecked")
    @Test void independentWindowsRunAtMostTwoColdDatabaseQueries() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        var entered=new java.util.concurrent.CountDownLatch(2);var release=new java.util.concurrent.CountDownLatch(1);
        var active=new java.util.concurrent.atomic.AtomicInteger();var peak=new java.util.concurrent.atomic.AtomicInteger();
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenAnswer(call->{
            peak.accumulateAndGet(active.incrementAndGet(),Math::max);entered.countDown();
            try {assertTrue(release.await(2,java.util.concurrent.TimeUnit.SECONDS));return List.of();}
            finally {active.decrementAndGet();}
        });
        var repository=new HistoricalIncidentEpisodes(provider);var executor=java.util.concurrent.Executors.newFixedThreadPool(3);
        try {
            var first=executor.submit(()->repository.count("I25",boundary,boundary.plusSeconds(3600)));
            var second=executor.submit(()->repository.count("I70",boundary,boundary.plusSeconds(3600)));
            assertTrue(entered.await(2,java.util.concurrent.TimeUnit.SECONDS));
            var third=executor.submit(()->repository.count("I25",boundary.plusSeconds(21*86400L),boundary.plusSeconds(21*86400L+3600)));
            assertThrows(java.util.concurrent.TimeoutException.class,()->third.get(50,java.util.concurrent.TimeUnit.MILLISECONDS));
            verify(jdbc,times(2)).query(any(PreparedStatementCreator.class),any(RowMapper.class));
            release.countDown();
            assertEquals(0,first.get(2,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(0,second.get(2,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(0,third.get(2,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(2,peak.get());
        } finally {release.countDown();executor.shutdownNow();}
    }

    @SuppressWarnings("unchecked")
    @Test void expiringAWaitingWindowDoesNotCancelTheSharedReconstruction() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenAnswer(call->{
            entered.countDown();assertTrue(release.await(2,java.util.concurrent.TimeUnit.SECONDS));return List.of();
        });
        var repository=new HistoricalIncidentEpisodes(provider);var executor=java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            var owner=executor.submit(()->repository.count("I25",boundary,boundary.plusSeconds(3600)));
            assertTrue(entered.await(2,java.util.concurrent.TimeUnit.SECONDS));
            var failure=assertThrows(IllegalStateException.class,()->repository.count("I25",boundary,boundary.plusSeconds(3600),
                System.nanoTime()+java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(50)));
            assertEquals("Archived incident read deadline reached",failure.getMessage());
            release.countDown();assertEquals(0,owner.get(2,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(0,repository.count("I25",boundary,boundary.plusSeconds(3600)));
            verify(jdbc,times(1)).query(any(PreparedStatementCreator.class),any(RowMapper.class));
        } finally {release.countDown();executor.shutdownNow();}
    }

    @SuppressWarnings("unchecked")
    @Test void sharedFailuresReachAllWindowsAndPermitAFreshRead() throws Exception {
        JdbcTemplate jdbc=mock(JdbcTemplate.class);
        ObjectProvider<JdbcTemplate> provider=mock(ObjectProvider.class);when(provider.getIfAvailable()).thenReturn(jdbc);
        var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);
        when(jdbc.query(any(PreparedStatementCreator.class),any(RowMapper.class))).thenAnswer(call->{
            entered.countDown();assertTrue(release.await(2,java.util.concurrent.TimeUnit.SECONDS));throw new IllegalStateException("Unavailable");
        }).thenReturn(List.of());
        var repository=new HistoricalIncidentEpisodes(provider);var executor=java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var owner=executor.submit(()->repository.count("I25",boundary,boundary.plusSeconds(3600)));
            assertTrue(entered.await(2,java.util.concurrent.TimeUnit.SECONDS));
            var waiter=executor.submit(()->repository.count("I25",boundary,boundary.plusSeconds(3600)));
            assertThrows(java.util.concurrent.TimeoutException.class,()->waiter.get(50,java.util.concurrent.TimeUnit.MILLISECONDS));
            release.countDown();
            for(var result:List.of(owner,waiter)) {
                var failure=assertThrows(java.util.concurrent.ExecutionException.class,()->result.get(2,java.util.concurrent.TimeUnit.SECONDS));
                assertEquals("Unavailable",failure.getCause().getMessage());
            }
            assertEquals(0,repository.count("I25",boundary,boundary.plusSeconds(3600)));
            verify(jdbc,times(2)).query(any(PreparedStatementCreator.class),any(RowMapper.class));
        } finally {release.countDown();executor.shutdownNow();}
    }

}
