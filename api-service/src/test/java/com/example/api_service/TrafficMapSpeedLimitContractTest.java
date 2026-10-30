package com.example.api_service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class TrafficMapSpeedLimitContractTest {
    @ParameterizedTest
    @ValueSource(strings = {"/api", "/dashboard-api"})
    void preservesPostedSpeedLimitContract(String prefix) throws Exception {
        var references = mock(CorridorRefRepository.class);
        List<CorridorRef> corridors = new ArrayList<>();
        for (String code : List.of("I25", "I70")) {
            var corridor = new CorridorRef();
            corridor.setCode(code);
            corridors.add(corridor);
        }
        when(references.findAllByOrderByCodeAsc()).thenReturn(corridors);
        var mapper = new ObjectMapper();
        var controller = new TrafficMapController(references, mock(TrafficSampleRepository.class),
            mock(CurrentIncidentRepository.class), mapper);
        var mvc = MockMvcBuilders.standaloneSetup(controller)
            .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper)).build();
        var response = mvc.perform(get(prefix + "/traffic/map/corridors"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();

        try (var fixture = getClass().getResourceAsStream("/map-speed-limits.json")) {
            assertNotNull(fixture);
            var expected = mapper.readTree(fixture);
            var features = mapper.readTree(response).path("features");
            assertEquals(2, features.size());
            for (var feature : features) {
                String corridor = feature.path("id").asText();
                var actual = mapper.createObjectNode();
                for (String field : List.of("speedLimitSegments", "speedLimitSource", "speedLimitNote")) {
                    actual.set(field, feature.path("properties").get(field));
                }
                assertEquals(expected.get(corridor), actual, prefix + " " + corridor);
            }
        }
    }
}
