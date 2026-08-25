package com.example.ingest_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.web.reactive.function.client.WebClient;

class TrafficPollerRepeatedPayloadLoggingTest {

    @Test
    void repeatedCorridorDetailsRemainDebugOnly() {
        Logger logger = (Logger) LoggerFactory.getLogger(TrafficPoller.class);
        Level originalLevel = logger.getLevel();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.DEBUG);

        try {
            TrafficPoller poller = poller();
            List<ProviderCycleSnapshot> snapshots = List.of(
                new ProviderCycleSnapshot("I25", List.of(61.0, 62.0), "same-i25")
            );

            for (int cycle = 0; cycle < 10; cycle++) {
                poller.logRepeatedCorridorPayloads("tile", snapshots);
            }

            assertThat(appender.list)
                .filteredOn(event -> event.getLevel() == Level.WARN)
                .isEmpty();
            assertThat(appender.list)
                .filteredOn(event -> event.getLevel() == Level.DEBUG)
                .extracting(ILoggingEvent::getFormattedMessage)
                .containsExactly(
                    "Corridor I25 in tile mode has repeated the same sampled payload for 10 consecutive cycles; avgSpeed=61.5 sampleCount=2"
                );
        } finally {
            logger.detachAppender(appender);
            logger.setLevel(originalLevel);
            appender.stop();
        }
    }

    private static TrafficPoller poller() {
        return new TrafficPoller(
            WebClient.builder().build(),
            new TrafficProps("key", 60, "tile", 10, "", 1, 500, 0, 0, 0, false),
            mock(RoutesClient.class),
            mock(TrafficSampleWriter.class),
            mock(CorridorMetadataSyncService.class),
            mock(CorridorGeometryStore.class),
            new TrafficPullProps(
                new TrafficPullProps.Flow(true, "tomtom", 60, 10, ""),
                new TrafficPullProps.Incidents(true, "cdot", 900, 9),
                new TrafficPullProps.MonthlyRequestBudget(190_000, 195_000, 200_000)
            ),
            List.of(),
            mock(TrafficSchedulerLease.class),
            mock(TomTomRequestGovernor.class),
            mock(TrafficProviderGuardService.class),
            new SimpleMeterRegistry()
        );
    }
}
