package com.example.api_service;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class IncidentRevisionRepository {
    private final JdbcTemplate jdbc;
    public IncidentRevisionRepository(ObjectProvider<JdbcTemplate> jdbc) { this.jdbc = jdbc.getIfAvailable(); }

    public String revision(String corridor) {
        if (jdbc == null) throw new IllegalStateException("Incident database is unavailable");
        return jdbc.queryForObject("""
            select concat(coalesce(max(e.updated_at)::text, ''), '|',
                coalesce(max(c.last_matched_at)::text, ''), '|', count(*))
            from traffic_incident_event e
            join traffic_incident_event_corridor c on c.event_id = e.id
            where c.corridor = ?
            """, String.class, corridor);
    }
}
