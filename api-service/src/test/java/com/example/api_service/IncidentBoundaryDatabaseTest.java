package com.example.api_service;

import static org.junit.jupiter.api.Assertions.*;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypes;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;

@EnabledIfEnvironmentVariable(named="CTT_COUNTER_DISPOSABLE_DB_URL", matches=".+")
class IncidentBoundaryDatabaseTest {
    @Test void nativeBoundaryRetainsItsPrecisionThroughTheRealRepository() {
        var source=new SingleConnectionDataSource(System.getenv("CTT_COUNTER_DISPOSABLE_DB_URL"),"postgres","",true);
        var factory=new LocalContainerEntityManagerFactoryBean();
        try {
            var jdbc=new JdbcTemplate(source);
            jdbc.execute("create temporary table traffic_incident_event_corridor(event_id bigint, corridor text, first_matched_at timestamptz)");
            jdbc.execute("insert into traffic_incident_event_corridor values(1,'I25','2026-08-01T01:29:56.950709Z')");
            factory.setDataSource(source);
            factory.setManagedTypes(PersistenceManagedTypes.of(TrafficHistoryIncident.class.getName()));
            factory.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
            factory.setJpaPropertyMap(Map.of("hibernate.hbm2ddl.auto","none"));factory.afterPropertiesSet();
            var manager=factory.getObject().createEntityManager();
            try {
                var repository=new JpaRepositoryFactory(manager).getRepository(CurrentIncidentRepository.class);
                assertEquals(Instant.parse("2026-08-01T01:29:56.950709Z"),repository.firstDurableObservation("I25"));
                assertNull(repository.firstDurableObservation("I70"));
            } finally {manager.close();}
        } finally {factory.destroy();source.destroy();}
    }
}
