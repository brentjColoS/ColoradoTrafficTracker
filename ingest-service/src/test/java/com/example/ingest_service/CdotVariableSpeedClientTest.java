package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import com.example.common.I70VariableSpeedSigns;
import com.example.common.VariableSpeedSign;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

class CdotVariableSpeedClientTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Instant NOW = Instant.parse("2026-10-14T23:00:00Z");
    private static final I70VariableSpeedSigns.Device DEVICE = I70VariableSpeedSigns.device("OpenTMS-Sign475239");

    static String feature(String fields) {
        return "{\"type\":\"FeatureCollection\",\"features\":[{\"properties\":{"
            + "\"id\":\"OpenTMS-Sign475239\",\"routeName\":\"I-70E\",\"direction\":\"east\",\"marker\":231.2,"
            + fields + "}}]}";
    }

    private VariableSpeedSign map(String fields) throws Exception {
        return CdotVariableSpeedClient.map(MAPPER.readTree(feature(fields)), DEVICE, NOW);
    }

    @Test void scopesEveryReadToOneKnownSignAndCapsTheResponse() {
        AtomicInteger reads = new AtomicInteger();
        WebClient http = WebClient.builder().baseUrl("https://data.cotrip.org").exchangeFunction(request -> {
            reads.incrementAndGet();
            assertThat(request.url().getPath()).isEqualTo("/api/v1/signs");
            assertThat(request.url().getQuery()).isEqualTo("apiKey=fixture-key&id=OpenTMS-Sign475239&limit=2");
            return Mono.just(ClientResponse.create(HttpStatus.OK).header(HttpHeaders.CONTENT_TYPE,"application/json")
                .body(feature("\"communicationStatus\":\"operational\",\"displayStatus\":\"on\",\"speed\":45,\"messageText\":\"45\"")) .build());
        }).build();
        VariableSpeedSign result = new CdotVariableSpeedClient(http).fetch("fixture-key", DEVICE, NOW).block();
        assertThat(reads).hasValue(1);
        assertThat(result.reportedLimitMph()).isEqualTo(45);
        assertThat(result.regularLimitMph()).isEqualTo(65);
        assertThat(result.belowRegularLimit()).isTrue();
        assertThat(result.direction()).isEqualTo("EAST");
    }

    @Test void sourceStateCanBeOldWhileTheSuccessfulReadIsFresh() throws Exception {
        VariableSpeedSign sign = map("\"communicationStatus\":\"operational\",\"displayStatus\":\"on\",\"speed\":65,"
            + "\"lastUpdated\":\"2023-10-14T23:00:00Z\",\"activationTime\":\"2023-10-14T23:00:00Z\"");
        assertThat(sign.at(NOW).status()).isEqualTo("AVAILABLE");
        assertThat(sign.sourceUpdatedAt()).isEqualTo(Instant.parse("2023-10-14T23:00:00Z"));
        assertThat(sign.activatedAt()).isEqualTo(sign.sourceUpdatedAt());
        assertThat(sign.at(NOW.plusSeconds(3601)).status()).isEqualTo("STALE");
    }

    @Test void errorAndBlankDisplaysNeverCountAsReductions() throws Exception {
        VariableSpeedSign error = map("\"communicationStatus\":\"error\",\"displayStatus\":\"on\",\"speed\":45");
        assertThat(error.status()).isEqualTo("COMMUNICATION_ERROR");
        assertThat(error.reportedLimitMph()).isEqualTo(45);
        assertThat(error.belowRegularLimit()).isFalse();
        VariableSpeedSign off = map("\"communicationStatus\":\"operational\",\"displayStatus\":\"off\",\"speed\":45");
        assertThat(off.status()).isEqualTo("UNAVAILABLE");
        assertThat(off.belowRegularLimit()).isFalse();
    }

    @Test void acceptsTheDocumentedMessageOnlyFormatButRejectsInvalidAndConflictingValues() throws Exception {
        String prefix = "\"communicationStatus\":\"operational\",\"displayStatus\":\"on\",";
        assertThat(map(prefix + "\"messageText\":\"50\"").reportedLimitMph()).isEqualTo(50);
        for (String value : new String[]{"\"speed\":0", "\"speed\":120", "\"speed\":45,\"messageText\":\"65\"", "\"messageText\":\"USE CAUTION\""}) {
            assertThat(map(prefix + value).status()).isEqualTo("UNAVAILABLE");
        }
        assertThat(map(prefix + "\"speed\":65,\"lastUpdated\":\"invalid\"").sourceUpdatedAt()).isNull();
    }

    @Test void rejectsIgnoredFiltersWrongDirectionAndOffCorridorResponses() throws Exception {
        String valid = feature("\"communicationStatus\":\"operational\",\"displayStatus\":\"on\",\"speed\":65");
        for (String body : new String[]{valid.replace("OpenTMS-Sign475239", "OpenTMS-Sign469719"),
            valid.replace("I-70E", "I-25E"), valid.replace("east", "west"), valid.replace("231.2", "205.0"),
            "{\"type\":\"FeatureCollection\",\"features\":[{},{}]}"}) {
            assertThatThrownBy(() -> CdotVariableSpeedClient.map(MAPPER.readTree(body), DEVICE, NOW))
                .isInstanceOf(IllegalArgumentException.class);
        }
        VariableSpeedSign missing = CdotVariableSpeedClient.map(MAPPER.readTree("{\"type\":\"FeatureCollection\",\"features\":[]}"),DEVICE,NOW);
        assertThat(missing.status()).isEqualTo("UNAVAILABLE");
        assertThat(missing.fetchedAt()).isEqualTo(NOW);
    }

    @Test void refusesUntrackedDevicesAndMissingKeysWithoutProviderReads() {
        AtomicInteger reads = new AtomicInteger();
        CdotVariableSpeedClient client = new CdotVariableSpeedClient(WebClient.builder().exchangeFunction(request -> {
            reads.incrementAndGet(); return Mono.error(new IllegalStateException("Unexpected request"));
        }).build());
        assertThatThrownBy(() -> client.fetch("",DEVICE,NOW).block()).hasMessageContaining("key unavailable");
        assertThatThrownBy(() -> client.fetch("fixture-key",null,NOW).block()).hasMessageContaining("outside");
        assertThat(reads).hasValue(0);
    }

    @Test void failuresAreNotRetriedAndCannotExposeTheCredentialBearingUrl() {
        AtomicInteger reads = new AtomicInteger();
        CdotVariableSpeedClient client = new CdotVariableSpeedClient(WebClient.builder().baseUrl("https://data.cotrip.org")
            .exchangeFunction(request -> {reads.incrementAndGet();return Mono.just(ClientResponse.create(HttpStatus.FORBIDDEN).build());}).build());
        assertThatThrownBy(() -> client.fetch("fixture-key",DEVICE,NOW).block())
            .hasMessage("Scoped CDOT sign read failed (HTTP 403)").hasNoCause();
        assertThat(reads).hasValue(1);
    }

    @Test void rejectsOversizedResponsesWithoutAnotherProviderRequest() {
        AtomicInteger reads = new AtomicInteger();
        reactor.netty.DisposableServer server = reactor.netty.http.server.HttpServer.create().host("127.0.0.1").port(0)
            .handle((request, response) -> {
                reads.incrementAndGet();
                return response.header(HttpHeaders.CONTENT_TYPE, "application/json")
                    .sendString(Mono.just("{\"oversized\":\"" + "x".repeat(20_000) + "\"}"));
            }).bindNow();
        try {
            CdotVariableSpeedClient client = new CdotVariableSpeedClient(WebClient.builder()
                .baseUrl("http://127.0.0.1:" + server.port()).build());
            assertThatThrownBy(() -> client.fetch("fixture-key",DEVICE,NOW).block())
                .hasMessage("Scoped CDOT sign read failed (RESPONSE_TOO_LARGE)").hasNoCause();
            assertThat(reads).hasValue(1);
        } finally { server.disposeNow(); }
    }

    @Test void oversizedStatusFieldsCannotPreventSavingAFailedAttemptAndAdvancingTheSweep() {
        for (String field : new String[]{"displayStatus", "communicationStatus"}) {
            String fields = "\"" + field + "\":\"" + "x".repeat(5000) + "\",\"speed\":45";
            assertThatThrownBy(() -> map(fields)).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("storage limit");
        }
    }

    @Test void aSlowScopedReadTimesOutWithASafeRetryableReasonAndNoHiddenRetry() {
        AtomicInteger reads = new AtomicInteger();
        CdotVariableSpeedClient client = new CdotVariableSpeedClient(WebClient.builder().baseUrl("https://data.cotrip.org")
            .exchangeFunction(request -> { reads.incrementAndGet(); return Mono.never(); }).build());
        reactor.test.StepVerifier.withVirtualTime(() -> client.fetch("fixture-secret", DEVICE, NOW))
            .thenAwait(java.time.Duration.ofSeconds(10))
            .expectErrorSatisfies(error -> {
                assertThat(error).isInstanceOf(CdotVariableSpeedClient.ReadFailure.class)
                    .hasMessage("Scoped CDOT sign read failed (TIMEOUT)").hasNoCause();
                assertThat(((CdotVariableSpeedClient.ReadFailure) error).retryable()).isTrue();
            }).verify(java.time.Duration.ofSeconds(3));
        assertThat(reads).hasValue(1);
    }

    @Test void classifiesFailuresWithoutPreservingCredentialBearingMessagesOrCauses() {
        for (int status : new int[]{401, 403, 408, 429, 500, 503}) {
            var failure = CdotVariableSpeedClient.readFailure(org.springframework.web.reactive.function.client.WebClientResponseException
                .create(status,"fixture-secret",HttpHeaders.EMPTY,new byte[0],null));
            assertThat(failure).hasMessage("Scoped CDOT sign read failed (HTTP " + status + ")").hasNoCause();
            assertThat(failure.retryable()).isEqualTo(status == 408 || status >= 500);
        }
        assertThat(CdotVariableSpeedClient.readFailure(new IllegalArgumentException("fixture-secret")))
            .hasMessage("Scoped CDOT sign read failed (INVALID_RESPONSE)").hasNoCause();
        var request = new org.springframework.web.reactive.function.client.WebClientRequestException(
            new java.net.ConnectException("fixture-secret"),org.springframework.http.HttpMethod.GET,
            java.net.URI.create("https://example.invalid?apiKey=fixture-secret"),HttpHeaders.EMPTY);
        assertThat(CdotVariableSpeedClient.readFailure(request).retryable()).isTrue();
        assertThat(CdotVariableSpeedClient.readFailure(request)).hasMessage("Scoped CDOT sign read failed (CONNECTION)").hasNoCause();
        assertThat(CdotVariableSpeedClient.readFailure(new IllegalStateException("fixture-secret")))
            .hasMessage("Scoped CDOT sign read failed (UNAVAILABLE)").hasNoCause();
    }

    @Test void recognizesWrappedTransportFailuresWithoutRetryingTlsOrInvalidData() {
        for(Throwable error:new Throwable[]{new java.util.concurrent.TimeoutException("fixture-secret"),
            new java.net.SocketTimeoutException("fixture-secret"),io.netty.handler.timeout.ReadTimeoutException.INSTANCE}) {
            var failure=CdotVariableSpeedClient.readFailure(new IllegalStateException("fixture-secret",error));
            assertThat(failure).hasMessage("Scoped CDOT sign read failed (TIMEOUT)").hasNoCause();
            assertThat(failure.retryable()).isTrue();
            assertThat(CdotVariableSpeedClient.readFailure(failure)).isSameAs(failure);
        }
        var tls=CdotVariableSpeedClient.readFailure(new javax.net.ssl.SSLException("fixture-secret"));
        assertThat(tls).hasMessage("Scoped CDOT sign read failed (TLS)").hasNoCause();
        assertThat(tls.retryable()).isFalse();
        var invalid=CdotVariableSpeedClient.readFailure(new org.springframework.core.codec.DecodingException("fixture-secret"));
        assertThat(invalid).hasMessage("Scoped CDOT sign read failed (INVALID_RESPONSE)").hasNoCause();
        assertThat(invalid.retryable()).isFalse();
    }

    @Test void validSpeedEndpointsAndBoundedUnknownStatusesRemainReadable() throws Exception {
        for(int speed:new int[]{5,85}) {
            assertThat(map("\"communicationStatus\":\"operational\",\"displayStatus\":\"on\",\"speed\":"+speed).status())
                .isEqualTo("AVAILABLE");
        }
        for(String field:new String[]{"displayStatus","communicationStatus"}) {
            assertThat(map("\""+field+"\":\""+"x".repeat(64)+"\"").status()).isEqualTo("UNAVAILABLE");
            assertThatThrownBy(() -> map("\""+field+"\":\""+"x".repeat(65)+"\""))
                .isInstanceOf(IllegalArgumentException.class);
        }
    }
}
