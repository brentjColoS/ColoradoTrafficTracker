package com.example.api_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(TrafficController.class)
@AutoConfigureMockMvc(addFilters = false)
class TrafficControllerRegressionTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficSampleRepository sampleRepo;

    @MockBean
    private TrafficHistorySampleRepository historyRepo;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @Test
    void anomaliesReturnsVarianceNoteForFlatBaseline() throws Exception {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        List<TrafficSample> samples = new ArrayList<>();

        TrafficSample recent = sample("I25", 55.0, now.minusMinutes(5));
        samples.add(recent);
        for (int i = 0; i < 10; i++) {
            samples.add(sample("I25", 60.0, now.minusMinutes(50 + i)));
        }

        when(historyRepo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I25"), any(), eq(PageRequest.of(0, 2000))))
            .thenReturn(new PageImpl<>(samples.stream().map(TrafficControllerRegressionTest::historySample).toList()));

        mvc.perform(get("/api/traffic/anomalies")
                .param("corridor", "I25")
                .param("windowMinutes", "30")
                .param("baselineMinutes", "180")
                .param("zThreshold", "2.0"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.baselineCount").value(10))
            .andExpect(jsonPath("$.checkedSamples").value(1))
            .andExpect(jsonPath("$.anomalyCount").value(0))
            .andExpect(jsonPath("$.note").value("Baseline variance is too small for z-score anomaly detection"));
    }

    @Test
    void forecastForFlatTrendReturnsStablePredictionBand() throws Exception {
        OffsetDateTime base = OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(120);
        List<TrafficSample> pointsDesc = List.of(
            sample("I25", 50.0, base.plusMinutes(105)),
            sample("I25", 50.0, base.plusMinutes(90)),
            sample("I25", 50.0, base.plusMinutes(75)),
            sample("I25", 50.0, base.plusMinutes(60)),
            sample("I25", 50.0, base.plusMinutes(45)),
            sample("I25", 50.0, base.plusMinutes(30)),
            sample("I25", 50.0, base.plusMinutes(15)),
            sample("I25", 50.0, base.plusMinutes(0))
        );

        when(historyRepo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I25"), any(), eq(PageRequest.of(0, 2000))))
            .thenReturn(new PageImpl<>(pointsDesc.stream().map(TrafficControllerRegressionTest::historySample).toList()));

        mvc.perform(get("/api/traffic/forecast")
                .param("corridor", "I25")
                .param("horizonMinutes", "60")
                .param("windowMinutes", "720")
                .param("stepMinutes", "15"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.sourceSamples").value(8))
            .andExpect(jsonPath("$.predictions.length()").value(4))
            .andExpect(jsonPath("$.predictions[0].predictedSpeed").value(50.0))
            .andExpect(jsonPath("$.predictions[0].lowerBoundSpeed").value(48.0))
            .andExpect(jsonPath("$.predictions[0].upperBoundSpeed").value(52.0));
    }

    private static TrafficSample sample(String corridor, double speed, OffsetDateTime timestamp) {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(corridor);
        sample.setAvgCurrentSpeed(speed);
        sample.setAvgFreeflowSpeed(60.0);
        sample.setMinCurrentSpeed(Math.max(0.0, speed - 8.0));
        sample.setConfidence(0.8);
        sample.setIncidentsJson("{\"incidents\":[]}");
        sample.setPolledAt(timestamp);
        return sample;
    }

    private static TrafficHistorySample historySample(TrafficSample sample) {
        TrafficHistorySample history = new TrafficHistorySample();
        history.setHistoryId(sample.getPolledAt().toEpochSecond());
        history.setSampleRefId(sample.getPolledAt().toEpochSecond());
        history.setCorridor(sample.getCorridor());
        history.setAvgCurrentSpeed(sample.getAvgCurrentSpeed());
        history.setAvgFreeflowSpeed(sample.getAvgFreeflowSpeed());
        history.setMinCurrentSpeed(sample.getMinCurrentSpeed());
        history.setConfidence(sample.getConfidence());
        history.setSourceMode(sample.getSourceMode());
        history.setIncidentCount(sample.getIncidentCount());
        history.setIncidentsJson(sample.getIncidentsJson());
        history.setPolledAt(sample.getPolledAt());
        history.setIngestedAt(sample.getIngestedAt());
        history.setIsArchived(false);
        return history;
    }
}
