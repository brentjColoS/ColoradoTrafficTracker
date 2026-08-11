package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@ExtendWith(MockitoExtension.class)
class TrafficRetentionBatchWriterTest {

    @Mock
    private JdbcTemplate jdbc;

    @Test
    void archivesAndDeletesOneBoundedSampleBatch() {
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(7, 5, 5);
        TrafficRetentionBatchWriter writer = new TrafficRetentionBatchWriter(jdbc);

        RetentionBatchResult result = writer.archiveNext(
            OffsetDateTime.parse("2026-07-12T02:15:00Z"),
            OffsetDateTime.parse("2026-08-11T02:15:00Z"),
            500
        );

        assertThat(result).isEqualTo(new RetentionBatchResult(7, 5, 5));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(3)).update(sql.capture(), any(Object[].class));
        List<String> statements = sql.getAllValues();
        assertThat(statements).allSatisfy(statement -> assertThat(statement)
            .contains("with batch as (")
            .contains("order by polled_at asc, id asc")
            .contains("limit ?"));
        assertThat(statements.get(0))
            .contains("insert into traffic_incident_archive")
            .contains("mile_marker_confidence")
            .contains("provider_event_id")
            .contains("join batch b on b.id = i.sample_id");
        assertThat(statements.get(1))
            .contains("insert into traffic_sample_archive")
            .contains("semantic_flow_signature")
            .contains("incident_source_updated_at")
            .contains("join batch b on b.id = s.id");
        assertThat(statements.get(2))
            .contains("delete from traffic_sample")
            .contains("using batch b");
    }

    @Test
    void eachBatchRunsInItsOwnTransaction() throws Exception {
        Method method = TrafficRetentionBatchWriter.class.getMethod(
            "archiveNext",
            OffsetDateTime.class,
            OffsetDateTime.class,
            int.class
        );

        assertThat(method.getAnnotation(Transactional.class)).isNotNull();
    }
}
