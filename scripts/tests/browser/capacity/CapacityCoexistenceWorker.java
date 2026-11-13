package com.example.ingest_service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.jdbc.core.JdbcTemplate;

/** Disposable, provider-free driver of the packaged production writers. */
public final class CapacityCoexistenceWorker {
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();
    private static Path report;

    private static synchronized void emit(String event, Map<String, ?> detail) throws Exception {
        Files.writeString(report, JSON.writeValueAsString(Map.of("event", event,
            "at", OffsetDateTime.now(ZoneOffset.UTC).toString(), "detail", detail)) + "\n",
            StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }

    public static void main(String[] args) throws Exception {
        report = Path.of(args[0]);
        Path gate = Path.of(args[1]), stop = Path.of(args[2]);
        int seconds = Integer.parseInt(args[3]);
        int oldSamples = Integer.parseInt(args[4]);
        if (oldSamples != 600 && oldSamples != 6000) throw new IllegalArgumentException("Bounded fixture backlog required");
        if (seconds < 120 || seconds > 1860) throw new IllegalArgumentException("Bounded fixture duration required");
        var failed = new AtomicBoolean();
        var executor = new ScheduledThreadPoolExecutor(2);
        try (var context = new SpringApplicationBuilder(IngestApplication.class)
                .web(WebApplicationType.NONE).run()) {
            var jdbc = context.getBean(JdbcTemplate.class);
            jdbc.execute("create table capacity_coexistence_ids(sample_id bigint primary key, kind text not null, zone_count integer not null)");
            var samples = context.getBean(TrafficSampleWriter.class);
            var incidents = context.getBean(TrafficIncidentRepository.class);
            var retention = new TrafficRetentionJob(context.getBean(TrafficRetentionBatchWriter.class),
                new TrafficRetentionProps(true, 30, "-", 500, 2));
            for (int n = 0; n < oldSamples / 2; n++) for (String corridor : List.of("I25", "I70")) {
                var time = OffsetDateTime.now(ZoneOffset.UTC).minusDays(35).plusSeconds(n);
                var sample = persist(samples, jdbc, corridor, time, "old");
                var incident = new TrafficIncident();
                incident.setSample(sample); incident.setCorridor(corridor);
                incident.setRoadNumber(corridor.equals("I25") ? "I-25" : "I-70");
                incident.setIconCategory(1); incident.setIncidentDescription("Synthetic retention canary " + n);
                incident.setDelaySeconds(n); incident.setGeometryType("Point");
                incident.setGeometryJson("[-105,39.75]");
                incident.setTravelDirection(corridor.equals("I25") ? "N" : "E");
                incident.setClosestMileMarker(240.0); incident.setMileMarkerMethod("provider");
                incident.setIncidentProvider("capacity-fixture"); incident.setIncidentProduct("retention-check");
                incident.setProviderEventId(corridor + "-retention-" + n);
                incident.setNormalizedCategory("CRASH"); incident.setNormalizedStatus("CLOSED");
                incident.setPolledAt(time); incidents.save(incident);
            }
            emit("ready", Map.of("oldSamples", oldSamples, "oldIncidents", oldSamples, "oldZones", oldSamples * 7));
            long gateDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(180);
            while (!Files.exists(gate)) {
                if (Files.exists(stop) || System.nanoTime() > gateDeadline) throw new IllegalStateException("Start gate deadline reached");
                Thread.sleep(200);
            }
            Runnable write = () -> {
                try {
                    long before = System.nanoTime();
                    for (String corridor : List.of("I25", "I70"))
                        persist(samples, jdbc, corridor, OffsetDateTime.now(ZoneOffset.UTC), "current");
                    emit("ingestion", Map.of("samples", 2, "zones", 14, "milliseconds", TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-before)));
                } catch (Exception error) { failed.set(true); recordFailure("ingestion", error); }
            };
            Runnable archive = () -> {
                try {
                    long before = System.nanoTime();
                    long archivedBefore = archivedCanaries(jdbc);
                    retention.archiveAndCleanup();
                    long archivedAfter = archivedCanaries(jdbc);
                    emit("retention", Map.of("milliseconds", TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-before),
                        "archivedOld", archivedAfter - archivedBefore, "remainingOld", oldSamples - archivedAfter));
                } catch (Exception error) { failed.set(true); recordFailure("retention", error); }
            };
            executor.scheduleWithFixedDelay(write, 0, 60, TimeUnit.SECONDS);
            executor.scheduleWithFixedDelay(archive, 0, 60, TimeUnit.SECONDS);
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
            while (!Files.exists(stop) && !failed.get() && System.nanoTime() < deadline) Thread.sleep(200);
            executor.shutdown();
            if (!executor.awaitTermination(20, TimeUnit.SECONDS)) throw new IllegalStateException("Writer shutdown deadline reached");
            emit("stopped", Map.of("failed", failed.get()));
        } catch (Exception error) {
            failed.set(true); recordFailure("worker", error);
        } finally { executor.shutdownNow(); }
        if (failed.get()) System.exit(1);
    }

    private static long archivedCanaries(JdbcTemplate jdbc) {
        return jdbc.queryForObject("select count(*) from traffic_sample_archive s join capacity_coexistence_ids k on k.sample_id=s.source_id where k.kind='old'", Long.class);
    }

    private static void recordFailure(String phase, Exception error) {
        try { emit("failure", Map.of("phase", phase, "type", error.getClass().getSimpleName())); }
        catch (Exception ignored) { System.err.println("Could not record bounded fixture failure"); }
    }

    private static TrafficSample persist(TrafficSampleWriter writer, JdbcTemplate jdbc, String corridor,
            OffsetDateTime time, String kind) {
        double speed = corridor.equals("I25") ? 61 : 54;
        var sample = new TrafficSample(); sample.setCorridor(corridor);
        sample.setPolledAt(time); sample.setSourceMode("tile"); sample.setSpeedSampleCount(8);
        sample.setAvgCurrentSpeed(speed); sample.setAvgFreeflowSpeed(70.0); sample.setMinCurrentSpeed(speed-5);
        sample.setConfidence(0.95); sample.setIncidentCount(kind.equals("old") ? 1 : 0);
        sample.setFlowProvider("capacity-fixture"); sample.setFlowProduct("writer-check");
        var zones = new ArrayList<TrafficSpeedZoneSample>();
        for (int n = 1; n <= (corridor.equals("I25") ? 6 : 8); n++) {
            var zone = new TrafficSpeedZoneSample();
            zone.setZoneKey(n <= 6 ? corridor + "-capacity-" + n : n == 7 ? "I70-259-270_274" : "I70-270_274-274");
            zone.setZoneOrder(n); zone.setZoneLabel(zone.getZoneKey());
            double start = corridor.equals("I25") ? 208+(n-1)*10.5 : n <= 6 ? 206+(n-1)*53.0/6 : n == 7 ? 259 : 270.274;
            double end = corridor.equals("I25") ? 208+n*10.5 : n <= 6 ? 206+n*53.0/6 : n == 7 ? 270.274 : 274;
            zone.setStartMileMarker(start); zone.setEndMileMarker(end); zone.setPostedSpeedMph(65);
            zone.setAvgCurrentSpeed(speed-n*0.25); zone.setMinCurrentSpeed(speed-5); zone.setSpeedSampleCount(8);
            zones.add(zone);
        }
        var saved = writer.saveSampleWithZones(sample, zones);
        jdbc.update("insert into capacity_coexistence_ids values (?, ?, ?)", saved.getId(), kind, zones.size());
        return saved;
    }
}
