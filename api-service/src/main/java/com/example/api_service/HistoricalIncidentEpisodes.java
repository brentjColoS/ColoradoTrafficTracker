package com.example.api_service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class HistoricalIncidentEpisodes {
    private static final long WEEK_SECONDS = 7 * 86400L;
    private static final long MONDAY_SECONDS = 4 * 86400L;
    record Key(String corridor, Instant week) {}
    record Episode(String identity, Instant first, Instant last) {}
    record Endpoint(Instant week, String identity, Instant time, boolean first, boolean last) {}
    private final JdbcTemplate jdbc;
    private final ReentrantLock lookup = new ReentrantLock(true);
    private final Cache<Key, List<Episode>> blocks = Caffeine.newBuilder()
        .maximumWeight(50_000).weigher((Key key, List<Episode> value) -> 64 + value.size())
        .expireAfterWrite(Duration.ofMinutes(10)).build();

    static final String QUERY = """
        with observations as (
            select incident.polled_at, incident.history_id,
                date_bin(interval '7 days', incident.polled_at, timestamptz '1970-01-05 00:00:00+00') as week,
                case when nullif(trim(incident.provider_event_id), '') is not null
                    then concat_ws('|', 'provider', incident.incident_provider, incident.provider_event_id)
                    else concat_ws('|', 'legacy', incident.corridor,
                        coalesce(nullif(trim(incident.travel_direction), ''), '?'),
                        coalesce(nullif(trim(incident.normalized_category), ''),
                            nullif(trim(incident.incident_description), ''), cast(incident.icon_category as text), '?'),
                        cast(round(cast(incident.closest_mile_marker as numeric), 1) as text)) end as identity
            from traffic_incident_all incident
            join corridor_ref tracked on tracked.code = incident.corridor
            where incident.corridor = ? and incident.polled_at >= ? and incident.polled_at < ?
              and date_bin(interval '7 days', incident.polled_at, timestamptz '1970-01-05 00:00:00+00') in (%s)
              and coalesce(lower(incident.mile_marker_method), '') <> 'off_corridor'
              and incident.closest_mile_marker between least(tracked.start_mile_marker, tracked.end_mile_marker)
                  and greatest(tracked.start_mile_marker, tracked.end_mile_marker)
              and (upper(coalesce(incident.normalized_category, '')) in
                    ('CRASH', 'CONSTRUCTION', 'CLOSURE', 'DISABLED_VEHICLE')
                  or incident.icon_category in (1, 7, 8, 9, 14))
        ), ordered as (
            select *, lag(polled_at) over lifecycle as previous,
                lead(polled_at) over lifecycle as next
            from observations
            window lifecycle as (partition by week, identity order by polled_at, history_id)
        ), endpoints as (
            select week, identity, polled_at,
                (previous is null or polled_at - previous > interval '3 minutes') as first,
                (next is null or next - polled_at > interval '3 minutes') as last
            from ordered
        )
        select * from endpoints where first or last order by week, identity, polled_at
        """;

    public HistoricalIncidentEpisodes(ObjectProvider<JdbcTemplate> jdbc) { this.jdbc = jdbc.getIfAvailable(); }

    public long count(String corridor, Instant start, Instant end) {
        return count(corridor, start, end, System.nanoTime() + TimeUnit.SECONDS.toNanos(10));
    }

    public long count(String corridor, Instant start, Instant end, long deadline) {
        return count(corridor, start, end, deadline, ignored -> true);
    }

    public long countBefore(String corridor, Instant start, Instant boundary, List<String> durableIdentities, long deadline) {
        Set<String> bridged = Set.copyOf(durableIdentities);
        return count(corridor, start, boundary.minusNanos(1), deadline,
            episode -> !bridged.contains(episode.identity()) || episode.last().isBefore(boundary.minusSeconds(180)));
    }

    private long count(String corridor, Instant start, Instant end, long deadline, Predicate<Episode> include) {
        if (jdbc == null) throw new IllegalStateException("Archived incident connection unavailable");
        List<Key> selected = new ArrayList<>();
        for (Instant week = week(start); !week.isAfter(end); week = week.plusSeconds(WEEK_SECONDS))
            selected.add(new Key(corridor, week));
        var missing = selected.stream().filter(key -> blocks.getIfPresent(key) == null).toList();
        Map<Instant, List<Episode>> loaded = Map.of();
        if (!missing.isEmpty()) {
            try {
                if (!lookup.tryLock(Math.min(TimeUnit.SECONDS.toNanos(5), remaining(deadline)), TimeUnit.NANOSECONDS))
                    throw new IllegalStateException("Archived incident capacity busy");
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt(); throw new IllegalStateException("Archived incident read interrupted", interrupted);
            }
            try {
                missing = selected.stream().filter(key -> blocks.getIfPresent(key) == null).toList();
                var collected = new LinkedHashMap<Instant, List<Episode>>();
                for (int i = 0; i < missing.size();) {
                    int right = i + 1;
                    if (right < missing.size() && missing.get(right).week().equals(missing.get(i).week().plusSeconds(WEEK_SECONDS))) right++;
                    collected.putAll(load(corridor, missing.subList(i, right), deadline));
                    i = right;
                }
                loaded = collected;
            } finally { lookup.unlock(); }
        }
        List<Episode> episodes = new ArrayList<>();
        for (Key key : selected) {
            List<Episode> cached = blocks.getIfPresent(key);
            if (cached == null) cached = loaded.get(key.week());
            if (cached == null) throw new IllegalStateException("Archived incident block expired during read");
            episodes.addAll(cached);
        }
        return count(episodes, start, end, include);
    }

    private static long remaining(long deadline) {
        long remaining = deadline - System.nanoTime();
        if (remaining <= 0) throw new IllegalStateException("Archived incident read deadline reached");
        return remaining;
    }

    private Map<Instant, List<Episode>> load(String corridor, List<Key> missing, long deadline) {
        int seconds = (int)Math.min(5, 1 + (remaining(deadline) - 1) / TimeUnit.SECONDS.toNanos(1));
        List<Object> args = new ArrayList<>(List.of(corridor, missing.getFirst().week().atOffset(ZoneOffset.UTC),
            missing.getLast().week().plusSeconds(WEEK_SECONDS).atOffset(ZoneOffset.UTC)));
        missing.forEach(key -> args.add(key.week().atOffset(ZoneOffset.UTC)));
        String placeholders = String.join(",", java.util.Collections.nCopies(missing.size(), "?"));
        var rows = jdbc.query(connection -> {
            var statement = connection.prepareStatement(QUERY.formatted(placeholders));
            statement.setQueryTimeout(seconds);
            for (int i = 0; i < args.size(); i++) statement.setObject(i + 1, args.get(i));
            return statement;
        }, (rs, index) -> new Endpoint(
            rs.getObject("week", OffsetDateTime.class).toInstant(), rs.getString("identity"),
            rs.getObject("polled_at", OffsetDateTime.class).toInstant(), rs.getBoolean("first"), rs.getBoolean("last")));
        Map<Instant, List<Episode>> loaded = new LinkedHashMap<>();
        missing.forEach(key -> loaded.put(key.week(), new ArrayList<>()));
        Instant first = null;
        for (Endpoint row : rows) {
            if (row.first()) first = row.time();
            if (row.last()) {
                if (first == null) throw new IllegalStateException("Archived incident endpoints incomplete");
                loaded.get(row.week()).add(new Episode(row.identity(), first, row.time()));
                first = null;
            }
        }
        if (first != null) throw new IllegalStateException("Archived incident endpoints incomplete");
        loaded.forEach((week, value) -> blocks.put(new Key(corridor, week), List.copyOf(value)));
        return loaded;
    }

    static Instant week(Instant time) {
        return Instant.ofEpochSecond(Math.floorDiv(time.getEpochSecond() - MONDAY_SECONDS, WEEK_SECONDS)
            * WEEK_SECONDS + MONDAY_SECONDS);
    }

    static long count(List<Episode> rows, Instant start, Instant end) {
        return count(rows, start, end, ignored -> true);
    }

    static long count(List<Episode> rows, Instant start, Instant end, Predicate<Episode> include) {
        var ordered = rows.stream().sorted(Comparator.comparing(Episode::identity).thenComparing(Episode::first)).toList();
        Episode current = null;
        long count = 0;
        for (Episode row : ordered) {
            if (current != null && current.identity().equals(row.identity())
                && !row.first().isAfter(current.last().plusSeconds(180))) {
                current = new Episode(current.identity(), current.first(), row.last().isAfter(current.last()) ? row.last() : current.last());
            } else {
                if (current != null && !current.first().isAfter(end) && !current.last().isBefore(start) && include.test(current)) count++;
                current = row;
            }
        }
        if (current != null && !current.first().isAfter(end) && !current.last().isBefore(start) && include.test(current)) count++;
        return count;
    }
}
