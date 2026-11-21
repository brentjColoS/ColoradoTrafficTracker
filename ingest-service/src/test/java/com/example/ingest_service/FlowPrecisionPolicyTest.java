package com.example.ingest_service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.net.URI;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.*;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.context.properties.bind.*;
import org.springframework.boot.context.properties.source.MapConfigurationPropertySource;
import org.springframework.core.io.buffer.DefaultDataBufferFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.*;
import reactor.core.publisher.*;

class FlowPrecisionPolicyTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String PRODUCT = "traffic-flow-incidents-vector-tiles";
    private static final TrafficProps PROPS = new TrafficProps("test-only",60,"tile",10,"",1,500,0,0,0,false);

    @Test
    void defaultAndRollbackOmitThePrecisionParameterAndKeepEightCalls() throws Exception {
        var run = run(TrafficPullProps.Precision.DEFAULT, "", corridors(), uri -> new byte[0]);
        assertThat(run.requests).hasSize(8).allSatisfy(uri -> assertThat(uri.getQuery()).doesNotContain("trafficLevelStep"));
        assertThat(run.requests.stream().map(URI::getPath).distinct()).hasSize(8);
        verify(run.budget).reserveMonthlyForAccount("tomtom","primary",PRODUCT,8,195000);
        assertThat(run.store.latest("I70").orElseThrow().collectionProfile()).doesNotContain("1kph");
    }

    @Test
    void fineModeOnlyChangesFourExclusiveRequestsAndNeverDuplicatesSharedTile() throws Exception {
        var run = run(TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH,"",corridors(),uri -> new byte[0]);
        assertThat(run.requests).hasSize(8);
        assertThat(run.requests.stream().filter(u -> u.getQuery().contains("trafficLevelStep=1"))).hasSize(4);
        assertThat(run.requests.stream().filter(u -> u.getPath().endsWith("/213/388.pbf")))
            .singleElement().satisfies(uri -> assertThat(uri.getQuery()).doesNotContain("trafficLevelStep"));
        verify(run.budget).reserveMonthlyForAccount("tomtom","primary",PRODUCT,8,195000);
        assertThat(run.store.latest("I25").orElseThrow().collectionProfile()).doesNotContain("1kph");
        assertThat(run.store.latest("I70").orElseThrow().collectionProfile())
            .contains("matcher=nearest","10/213/388=default","=1kph");
    }

    @Test
    void missingOtherCorridorOrMixedZoomFallsBackBeforeAnyFineRequest() throws Exception {
        for (var configuration : List.of(
            run(TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH,"",List.of(corridors().get(1)),u -> new byte[0]),
            run(TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH,"I25=9",corridors(),u -> new byte[0]))) {
            assertThat(configuration.requests).isNotEmpty().allSatisfy(uri ->
                assertThat(uri.getQuery()).doesNotContain("trafficLevelStep"));
        }
    }

    @Test
    void rejectedFineRequestDoesNotRetryWithCoarseDataOrPersistAPartialBatch() throws Exception {
        List<URI> requests = new ArrayList<>();
        TrafficSampleWriter writer = mock(TrafficSampleWriter.class);
        var budget = budget();
        var client = WebClient.builder().exchangeFunction(request -> {
            requests.add(request.url());
            return Mono.just(ClientResponse.create(request.url().getQuery().contains("trafficLevelStep")
                ? HttpStatus.BAD_REQUEST : HttpStatus.OK).body("").build());
        }).build();
        var poller = poller(client,TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH,"",writer,budget,
            new CorridorFlowCellStore(mock(CorridorFlowCellWriter.class)));
        assertThatThrownBy(() -> poller.pollFlowAndPersist(corridors())).hasMessageContaining("400");
        assertThat(requests.stream().filter(u -> u.getQuery().contains("trafficLevelStep"))).hasSize(1);
        verifyNoInteractions(writer);
        verify(budget).reserveMonthlyForAccount("tomtom","primary",PRODUCT,8,195000);
    }

    @Test
    void nearestZerosAndMissingCoverageAreNotReplacedWithPositiveAverages() throws Exception {
        var type=Class.forName(TileTrafficPoller.class.getName()+"$FlowCandidate");
        var constructor=type.getDeclaredConstructor(double.class,List.class);constructor.setAccessible(true);
        var zero=constructor.newInstance(0.0,List.of(List.of(new double[]{39.70,-105.00001},new double[]{39.72,-105.00001})));
        var moving=constructor.newInstance(62.0,List.of(List.of(new double[]{39.70,-104.9999},new double[]{39.72,-104.9999})));
        var method=TileTrafficPoller.class.getDeclaredMethod("projectedSpeedForSample",String.class,double.class,double.class,List.class,double.class);
        method.setAccessible(true);
        assertThat((Double)method.invoke(null,"I70",39.71,-105.0,List.of(zero,moving),150.0)).isZero();
        assertThat(method.invoke(null,"I70",0.0,0.0,List.of(zero,moving),150.0)).isNull();
    }

    @Test
    void invalidPrecisionFailsConfigurationInsteadOfSilentlyEnablingAnUnknownMode() {
        var valid = new Binder(new MapConfigurationPropertySource(Map.of(
            "traffic.pull.flow.precision","I70_EXCLUSIVE_1KPH","traffic.pull.flow.tile-zoom","10")));
        assertThat(valid.bind("traffic.pull.flow",Bindable.of(TrafficPullProps.Flow.class)).get().precision())
            .isEqualTo(TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH);
        var binder = new Binder(new MapConfigurationPropertySource(Map.of("traffic.pull.flow.precision","typo")));
        assertThatThrownBy(() -> binder.bind("traffic.pull.flow",Bindable.of(TrafficPullProps.Flow.class)))
            .isInstanceOf(BindException.class);
    }

    @Test
    @EnabledIfEnvironmentVariable(named="CTT_PRECISION_CAPTURES",matches=".+")
    void replaysRealBatchesThroughActualRequestPolicyAndPreservesEveryI25Reading() throws Exception {
        Path root = Path.of(System.getenv("CTT_PRECISION_CAPTURES"));
        Map<String,byte[]> defaults = new HashMap<>(), fine = new HashMap<>();
        load(root.resolve("ctt-i70-precision-capture-20261020"),defaults,fine);
        // Use I25's own unchanged default bytes for its four tiles, including the shared tile.
        Map<String,byte[]> i25Default = new HashMap<>(), unused = new HashMap<>();
        load(root.resolve("ctt-i25-precision-capture-20261020"),i25Default,unused);
        defaults.putAll(i25Default);
        Function<URI,byte[]> source = uri -> {
            Map<String,byte[]> selected = uri.getQuery().contains("trafficLevelStep") ? fine : defaults;
            byte[] raw = selected.get(uri.getPath());
            assertThat(raw).as("No unrecorded request %s",uri.getPath()).isNotNull();
            return raw;
        };
        var base = run(TrafficPullProps.Precision.DEFAULT,"",corridors(),source);
        var candidate = run(TrafficPullProps.Precision.I70_EXCLUSIVE_1KPH,"",corridors(),source);
        var rollback = run(TrafficPullProps.Precision.DEFAULT,"",corridors(),source);
        assertThat(candidate.snapshots.get("I25").sampledSpeeds()).hasSize(123)
            .isEqualTo(base.snapshots.get("I25").sampledSpeeds());
        assertThat(candidate.snapshots.get("I70").sampledSpeeds()).hasSize(135)
            .isNotEqualTo(base.snapshots.get("I70").sampledSpeeds());
        for (String corridor : List.of("I25","I70")) {
            assertThat(rollback.snapshots.get(corridor).sampledSpeeds()).isEqualTo(base.snapshots.get(corridor).sampledSpeeds());
            assertThat(candidate.store.latest(corridor).orElseThrow().supportedCellCount())
                .isEqualTo(base.store.latest(corridor).orElseThrow().supportedCellCount());
            assertThat(rollback.store.latest(corridor).orElseThrow().cells())
                .isEqualTo(base.store.latest(corridor).orElseThrow().cells());
        }
        assertThat(candidate.store.latest("I25").orElseThrow().cells())
            .isEqualTo(base.store.latest("I25").orElseThrow().cells());
        assertThat(candidate.requests).hasSize(8);
        var samples = org.mockito.ArgumentCaptor.forClass(TrafficSample.class);
        verify(candidate.writer,times(2)).saveSampleWithZones(samples.capture(),anyList());
        assertThat(samples.getAllValues()).allSatisfy(s -> assertThat(s.getFlowCollectionProfile()).isNotBlank());
        Path out = Path.of("target/precision-policy-replay.json");
        JSON.writerWithDefaultPrettyPrinter().writeValue(out.toFile(),Map.of(
            "note","Mixed I70 source profile; captured spatial data, not a simultaneous historical timeline. HTTP mocked, zero provider calls.",
            "base",base.snapshots,"candidate",candidate.snapshots,"rollback",rollback.snapshots,
            "mapDirections",candidate.store.snapshot().stream().collect(java.util.stream.Collectors.toMap(
                CorridorFlowCellSnapshot::corridor,s -> s.cells().stream().collect(java.util.stream.Collectors.groupingBy(
                    cell -> cell.direction().name(),java.util.stream.Collectors.counting())))),
            "profiles",samples.getAllValues().stream().collect(java.util.stream.Collectors.toMap(TrafficSample::getCorridor,TrafficSample::getFlowCollectionProfile))));
    }

    private static void load(Path root,Map<String,byte[]> defaults,Map<String,byte[]> fine) throws Exception {
        JsonNode manifest = JSON.readTree(root.resolve("manifest.json").toFile());
        for (JsonNode frame : manifest.path("frames")) {
            if (frame.path("round").asInt()!=0) continue;
            for (JsonNode tile : frame.path("tiles")) {
                byte[] bytes = Files.readAllBytes(root.resolve(tile.path("file").asText()));
                assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)))
                    .isEqualTo(tile.path("sha256").asText());
                String key = "/traffic/map/4/tile/flow/absolute/"+tile.path("z").asInt()+"/"+tile.path("x").asInt()+"/"+tile.path("y").asInt()+".pbf";
                (frame.path("precision").asText().equals("default")?defaults:fine).put(key,bytes);
            }
        }
    }

    private record Run(List<URI> requests,Map<String,ProviderCycleSnapshot> snapshots,
        TrafficSampleWriter writer,TrafficRequestBudget budget,CorridorFlowCellStore store) {}

    private static Run run(TrafficPullProps.Precision precision,String overrides,List<TrafficProps.Corridor> corridors,
        Function<URI,byte[]> source) {
        List<URI> requests = new ArrayList<>();
        var client = WebClient.builder().exchangeFunction(request -> {
            requests.add(request.url());
            return Mono.just(ClientResponse.create(HttpStatus.OK).body(Flux.just(
                DefaultDataBufferFactory.sharedInstance.wrap(source.apply(request.url())))).build());
        }).build();
        var writer=mock(TrafficSampleWriter.class);var budget=budget();
        var store=new CorridorFlowCellStore(mock(CorridorFlowCellWriter.class));
        return new Run(requests,poller(client,precision,overrides,writer,budget,store).pollFlowAndPersist(corridors),writer,budget,store);
    }

    private static TileTrafficPoller poller(WebClient client,TrafficPullProps.Precision precision,String overrides,
        TrafficSampleWriter writer,TrafficRequestBudget budget,CorridorFlowCellStore store) {
        return new TileTrafficPoller(client,PROPS,new TrafficPullProps(
            new TrafficPullProps.Flow(true,"tomtom",60,10,overrides,precision),null,null),writer,
            mock(CorridorGeometryStore.class),mock(TrafficProviderGuardService.class),
            new TomTomAccountQuotaManager(new TomTomAccountPool(PROPS,new TomTomAccountsProps("secondary-test",true,true)),budget),
            mock(TomTomRequestGovernor.class),new IncidentSnapshotStore(),new FlowSpatialEvidenceStore(),store,new SimpleMeterRegistry());
    }

    private static TrafficRequestBudget budget() {
        var budget=mock(TrafficRequestBudget.class);var start=LocalDate.of(2026,10,1);var end=start.plusMonths(1);
        when(budget.monthlyUsageForAccount(anyString(),anyString(),anyString())).thenReturn(
            new TrafficRequestBudget.MonthlyUsage(0,start,end,"tomtom","primary",PRODUCT));
        when(budget.reserveMonthlyForAccount(anyString(),anyString(),anyString(),anyInt(),anyInt()))
            .thenAnswer(i -> new TrafficRequestBudget.MonthlyReservation(true,i.getArgument(3),
                ((Integer)i.getArgument(3)).longValue(),i.getArgument(4),start,end,"tomtom","primary",PRODUCT));
        return budget;
    }

    private static List<TrafficProps.Corridor> corridors() throws Exception {
        List<TrafficProps.Corridor> result=new ArrayList<>();
        for (String name : List.of("I25","I70")) {
            Path path=Path.of("../routes-service/src/main/resources/routes/"+name.toLowerCase()+".geojson");
            Path directions=Path.of("../routes-service/src/main/resources/routes/directional/"
                +(name.equals("I25")?"v1":"v2")+"/"+name.toLowerCase()+".geojson");
            result.add(new TrafficProps.Corridor(name,name,name,"","",name.equals("I25")?271.0:206.0,
                name.equals("I25")?208.0:274.0,List.of(),"",Files.readString(path),null,550.0)
                .withDirectionalRoutes(RoutesClient.parseDirectionalRoutes(JSON.readTree(Files.readString(directions)))));
        }
        return result;
    }
}
