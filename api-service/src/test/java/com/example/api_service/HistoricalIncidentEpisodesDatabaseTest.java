package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

@EnabledIfEnvironmentVariable(named = "CTT_COUNTER_DISPOSABLE_DB_URL", matches = ".+")
class HistoricalIncidentEpisodesDatabaseTest {
    @Test void bytewiseIdentityOrderingPreservesReferenceEpisodesAndExactWindowCounts() throws Exception {
        var source = new SingleConnectionDataSource(System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL"), "postgres", "", true);
        try {
            var jdbc = new JdbcTemplate(source);
            jdbc.setQueryTimeout(10);
            jdbc.execute("""
                create temporary table corridor_ref(code text, start_mile_marker float8, end_mile_marker float8);
                insert into corridor_ref values ('I25',271,208),('I70',206,274);
                create temporary table traffic_incident_all(history_id bigint, polled_at timestamptz,
                    corridor text, incident_provider text, provider_event_id text, travel_direction text,
                    normalized_category text, incident_description text, icon_category int,
                    closest_mile_marker float8, mile_marker_method text);
                insert into traffic_incident_all
                select id, timestamptz '2026-06-22T00:00:00Z'+offset_seconds*interval '1 second',
                    c, 'fixture', event, direction, category, description, icon, marker, method
                from (values
                    (1,-30.0,'seam','N','CRASH','crash',1,240.0,'exact'),
                    (2,150.0,'seam','S','CLOSURE','changed',8,241.0,'exact'),
                    (3,330.000001,'seam','N','CRASH','crash',1,240.0,'exact'),
                    (-4,330.000001,'seam','N','CRASH','duplicate',1,240.0,'exact'),
                    (5,0.0,null,'N','CRASH','crash',1,240.01,'exact'),
                    (-6,180.0,' ','N','CRASH','crash',1,240.04,'exact'),
                    (7,360.000001,null,'N','CRASH','crash',1,240.01,'exact'),
                    (8,0.0,null,'S','CRASH','crash',1,240.01,'exact'),
                    (9,0.0,'off','N','CRASH','crash',1,240.0,'off_corridor'),
                    (10,0.0,'outside','N','CRASH','crash',1,300.0,'exact'),
                    (11,0.0,'jam','N','JAM','jam',5,240.0,'exact'),
                    (12,0.0,null,null,null,null,14,241.0,'exact'),
                    (13,60.0,null,null,null,null,14,241.0,'exact'),
                    (14,604799.999999,'next-seam','N','CRASH','crash',1,240.0,'exact'),
                    (15,604979.999999,'next-seam','N','CRASH','crash',1,240.0,'exact'),
                    (16,0.0,'Event','N','CRASH','crash',1,240.0,'exact'),
                    (17,0.0,'event','N','CRASH','crash',1,240.0,'exact'),
                    (18,0.0,'évent','N','CRASH','crash',1,240.0,'exact'),
                    (19,0.0,'café','N','CRASH','crash',1,240.0,'exact'),
                    (20,0.0,'café','N','CRASH','crash',1,240.0,'exact')
                ) f(id,offset_seconds,event,direction,category,description,icon,marker,method)
                cross join (values ('I25'),('I70')) corridors(c);
                insert into traffic_incident_all
                select n, timestamptz '2026-06-22T00:00:01Z', 'I25','fixture','uncapped-'||n,
                    'N','CRASH','crash',1,240,'exact' from generate_series(1,1501) n;
                insert into traffic_incident_all
                select n, timestamptz '2026-06-19T00:00:00Z'
                    +make_interval(secs=>n*60+(n/7)*181)+e*interval '1 microsecond',
                    c,'fixture','generated-'||e,'N','CRASH','crash',1,240,'exact'
                from generate_series(0,240) n cross join generate_series(1,12) e
                cross join (values ('I25'),('I70')) corridors(c);
                """);
            String reference;
            // Frozen endpoint query from accepted experimental 28db3a84.
            try (var input = getClass().getResourceAsStream("/historical-episode-reference.sql")) {
                reference = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            }
            var beans = new StaticListableBeanFactory();
            beans.addBean("jdbc", jdbc);
            Instant boundary = Instant.parse("2026-06-22T00:00:00Z");
            for (String timezone : List.of("UTC", "America/Denver")) {
                jdbc.execute("set time zone '" + timezone + "'");
                var repository = new HistoricalIncidentEpisodes(beans.getBeanProvider(JdbcTemplate.class));
                for (String corridor : List.of("I25", "I70", "EMPTY")) {
                    var expected = new ArrayList<HistoricalIncidentEpisodes.Episode>();
                    for (int week : List.of(-1, 0, 1)) {
                        var from = boundary.plusSeconds(week * 7 * 86400L).atOffset(ZoneOffset.UTC);
                        Object[] args = {corridor, from, from.plusDays(7), from};
                        var original = episodes(jdbc, reference, args);
                        assertEquals(original, episodes(jdbc, HistoricalIncidentEpisodes.QUERY, args), timezone + " " + corridor + " " + week);
                        expected.addAll(original);
                    }
                    if (corridor.equals("I25")) assertEquals(1501,
                        expected.stream().filter(e -> e.identity().startsWith("provider|fixture|uncapped-")).count());
                    assertTrue(expected.stream().noneMatch(e -> e.identity().matches(".*\\|(off|outside|jam)$")));
                    for (long start : List.of(-604800L, -30L, 0L, 150L, 330L, 604799L)) {
                        for (long extraNanos : List.of(0L, 1L, 1000L)) {
                            Instant since = boundary.plusSeconds(start).plusNanos(extraNanos);
                            Instant until = since.plusSeconds(7200);
                            assertEquals(HistoricalIncidentEpisodes.count(expected, since, until), repository.count(corridor, since, until),
                                timezone + " " + corridor + " " + since);
                        }
                    }
                }
            }
        } finally { source.destroy(); }
    }

    private static List<HistoricalIncidentEpisodes.Episode> episodes(JdbcTemplate jdbc, String query, Object[] args) {
        var endpoints = jdbc.query(query.formatted("?"), (rs, index) -> new HistoricalIncidentEpisodes.Endpoint(
            rs.getObject("week", OffsetDateTime.class).toInstant(), rs.getString("identity"),
            rs.getObject("polled_at", OffsetDateTime.class).toInstant(), rs.getBoolean("first"), rs.getBoolean("last")), args);
        var result = new ArrayList<HistoricalIncidentEpisodes.Episode>();
        Instant first = null;
        for (var endpoint : endpoints) {
            if (endpoint.first()) first = endpoint.time();
            if (endpoint.last()) {
                assertNotNull(first);
                result.add(new HistoricalIncidentEpisodes.Episode(endpoint.identity(), first, endpoint.time()));
                first = null;
            }
        }
        assertNull(first);
        return result.stream().sorted(java.util.Comparator.comparing(HistoricalIncidentEpisodes.Episode::identity)
            .thenComparing(HistoricalIncidentEpisodes.Episode::first)).toList();
    }
}
