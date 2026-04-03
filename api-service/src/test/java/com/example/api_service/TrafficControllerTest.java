package com.example.api_service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
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
class TrafficControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private TrafficSampleRepository repo;

    @MockBean
    private ApiSecurityProps apiSecurityProps;

    @MockBean
    private ApiRateLimitProps apiRateLimitProps;

    @Test
    void latestReturnsBadRequestForBlankCorridor() throws Exception {
        mvc.perform(get("/api/traffic/latest").param("corridor", " "))
            .andExpect(status().isBadRequest());
    }

    @Test
    void latestReturnsDtoPayload() throws Exception {
        TrafficSample sample = sample("I25", 55.0);
        when(repo.findFirstByCorridorOrderByPolledAtDesc("I25")).thenReturn(Optional.of(sample));

        mvc.perform(get("/api/traffic/latest").param("corridor", "I25"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I25"))
            .andExpect(jsonPath("$.avgCurrentSpeed").value(55.0));
    }

    @Test
    void historyReturnsBadRequestForInvalidRange() throws Exception {
        mvc.perform(get("/api/traffic/history").param("corridor", "I25").param("windowMinutes", "0"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/history").param("corridor", "I25").param("limit", "0"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void historyReturnsSamples() throws Exception {
        TrafficSample sample = sample("I70", 43.0);
        when(repo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I70"), any(), eq(PageRequest.of(0, 2))))
            .thenReturn(new PageImpl<>(List.of(sample)));

        mvc.perform(get("/api/traffic/history")
                .param("corridor", "I70")
                .param("windowMinutes", "120")
                .param("limit", "2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I70"))
            .andExpect(jsonPath("$.returned").value(1))
            .andExpect(jsonPath("$.samples[0].avgCurrentSpeed").value(43.0));
    }

    @Test
    void corridorsReturnsDistinctNames() throws Exception {
        when(repo.findDistinctCorridors()).thenReturn(List.of("I25", "I70"));

        mvc.perform(get("/api/traffic/corridors"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0]").value("I25"))
            .andExpect(jsonPath("$[1]").value("I70"));
    }

    @Test
    void anomaliesReturnsBadRequestForInvalidParams() throws Exception {
        mvc.perform(get("/api/traffic/anomalies").param("corridor", "I25").param("windowMinutes", "0"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void anomaliesReturnsDetectedSamples() throws Exception {
        TrafficSample baselineA = sample("I25", 60.0);
        baselineA.setPolledAt(OffsetDateTime.now().minusMinutes(120));
        TrafficSample baselineB = sample("I25", 58.0);
        baselineB.setPolledAt(OffsetDateTime.now().minusMinutes(110));
        TrafficSample baselineC = sample("I25", 62.0);
        baselineC.setPolledAt(OffsetDateTime.now().minusMinutes(100));
        TrafficSample baselineD = sample("I25", 61.0);
        baselineD.setPolledAt(OffsetDateTime.now().minusMinutes(90));
        TrafficSample baselineE = sample("I25", 59.0);
        baselineE.setPolledAt(OffsetDateTime.now().minusMinutes(80));
        TrafficSample baselineF = sample("I25", 60.0);
        baselineF.setPolledAt(OffsetDateTime.now().minusMinutes(70));
        TrafficSample baselineG = sample("I25", 62.0);
        baselineG.setPolledAt(OffsetDateTime.now().minusMinutes(65));
        TrafficSample baselineH = sample("I25", 58.0);
        baselineH.setPolledAt(OffsetDateTime.now().minusMinutes(60));
        TrafficSample baselineI = sample("I25", 61.0);
        baselineI.setPolledAt(OffsetDateTime.now().minusMinutes(55));
        TrafficSample baselineJ = sample("I25", 59.0);
        baselineJ.setPolledAt(OffsetDateTime.now().minusMinutes(50));

        TrafficSample recentAnomaly = sample("I25", 35.0);
        recentAnomaly.setPolledAt(OffsetDateTime.now().minusMinutes(10));

        when(repo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I25"), any(), eq(PageRequest.of(0, 2000))))
            .thenReturn(new PageImpl<>(List.of(
                recentAnomaly,
                baselineJ,
                baselineI,
                baselineH,
                baselineG,
                baselineF,
                baselineE,
                baselineD,
                baselineC,
                baselineB,
                baselineA
            )));

        mvc.perform(get("/api/traffic/anomalies")
                .param("corridor", "I25")
                .param("windowMinutes", "30")
                .param("baselineMinutes", "180")
                .param("zThreshold", "2.0"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I25"))
            .andExpect(jsonPath("$.anomalyCount").value(1))
            .andExpect(jsonPath("$.anomalies[0].observedSpeed").value(35.0));
    }

    @Test
    void forecastReturnsBadRequestForInvalidParams() throws Exception {
        mvc.perform(get("/api/traffic/forecast").param("corridor", "I25").param("horizonMinutes", "10"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/forecast").param("corridor", "I25").param("windowMinutes", "30"))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/traffic/forecast").param("corridor", "I25").param("stepMinutes", "2"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void forecastReturnsNoteWhenNotEnoughSamples() throws Exception {
        TrafficSample s1 = sample("I25", 55.0);
        s1.setPolledAt(OffsetDateTime.now().minusMinutes(15));
        TrafficSample s2 = sample("I25", 56.0);
        s2.setPolledAt(OffsetDateTime.now().minusMinutes(5));

        when(repo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I25"), any(), eq(PageRequest.of(0, 2000))))
            .thenReturn(new PageImpl<>(List.of(s2, s1)));

        mvc.perform(get("/api/traffic/forecast")
                .param("corridor", "I25")
                .param("horizonMinutes", "60")
                .param("windowMinutes", "720")
                .param("stepMinutes", "15"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I25"))
            .andExpect(jsonPath("$.sourceSamples").value(2))
            .andExpect(jsonPath("$.predictions.length()").value(0))
            .andExpect(jsonPath("$.note").value("Not enough source samples for forecasting"));
    }

    @Test
    void forecastReturnsPredictions() throws Exception {
        OffsetDateTime base = OffsetDateTime.now().minusMinutes(120);
        List<TrafficSample> points = List.of(
            timedSample("I25", 44.0, base.plusMinutes(0)),
            timedSample("I25", 46.0, base.plusMinutes(15)),
            timedSample("I25", 47.0, base.plusMinutes(30)),
            timedSample("I25", 49.0, base.plusMinutes(45)),
            timedSample("I25", 50.0, base.plusMinutes(60)),
            timedSample("I25", 52.0, base.plusMinutes(75)),
            timedSample("I25", 53.0, base.plusMinutes(90)),
            timedSample("I25", 55.0, base.plusMinutes(105))
        );

        when(repo.findByCorridorAndPolledAtGreaterThanEqualOrderByPolledAtDesc(eq("I25"), any(), eq(PageRequest.of(0, 2000))))
            .thenReturn(new PageImpl<>(List.of(
                points.get(7),
                points.get(6),
                points.get(5),
                points.get(4),
                points.get(3),
                points.get(2),
                points.get(1),
                points.get(0)
            )));

        mvc.perform(get("/api/traffic/forecast")
                .param("corridor", "I25")
                .param("horizonMinutes", "60")
                .param("windowMinutes", "720")
                .param("stepMinutes", "15"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.corridor").value("I25"))
            .andExpect(jsonPath("$.model").value("local-linear-trend"))
            .andExpect(jsonPath("$.sourceSamples").value(8))
            .andExpect(jsonPath("$.predictions.length()").value(4))
            .andExpect(jsonPath("$.predictions[0].predictedSpeed").isNumber())
            .andExpect(jsonPath("$.predictions[0].lowerBoundSpeed").isNumber())
            .andExpect(jsonPath("$.predictions[0].upperBoundSpeed").isNumber());
    }

    private static TrafficSample timedSample(String corridor, double speed, OffsetDateTime ts) {
        TrafficSample sample = sample(corridor, speed);
        sample.setPolledAt(ts);
        return sample;
    }

    private static TrafficSample sample(String corridor, double speed) {
        TrafficSample sample = new TrafficSample();
        sample.setCorridor(corridor);
        sample.setAvgCurrentSpeed(speed);
        sample.setAvgFreeflowSpeed(60.0);
        sample.setMinCurrentSpeed(speed - 10.0);
        sample.setConfidence(0.85);
        sample.setIncidentsJson("{\"incidents\":[]}");
        sample.setPolledAt(OffsetDateTime.of(2026, 4, 3, 12, 0, 0, 0, ZoneOffset.UTC));
        return sample;
    }
}
