package com.example.api_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class DirectionalCorridorGeometryClientTest {

    @Test
    void fetchesDirectionalGeoJsonFromRoutesService() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://routes.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://routes.test/routes/corridors/I25/directions"))
            .andRespond(withSuccess("""
                {"type":"FeatureCollection","features":[]}
                """, MediaType.parseMediaType("application/geo+json")));

        var result = new DirectionalCorridorGeometryClient(builder.build()).fetch("I25");

        assertThat(result).isPresent();
        assertThat(result.orElseThrow().path("type").asText()).isEqualTo("FeatureCollection");
        server.verify();
    }

    @Test
    void reportsAnUnavailableOptionalGeometryResponse() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://routes.test");
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo("http://routes.test/routes/corridors/I70/directions"))
            .andRespond(withServerError());

        assertThat(new DirectionalCorridorGeometryClient(builder.build()).fetch("I70")).isEmpty();
        server.verify();
    }
}
