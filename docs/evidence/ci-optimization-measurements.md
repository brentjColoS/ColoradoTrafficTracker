# Recorded CI optimization measurements

These comparisons were recorded during pipeline development. Hosted run links
identify the original executions; local figures are diagnostic comparisons and
do not establish current hosted duration. Test counts and mutation identities
belong to those revisions. The [CI reference](../ci-cd-pipeline.md) owns current
gates, partitions and cache policy.

## Service parallelism and test startup

The successful main run [37061512856](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/37061512856)
on October 2, 2026 took about seven minutes. Its sequential mutation reactor took
5 minutes 14 seconds: routes 26 seconds, ingest 71 seconds, and API 215 seconds.
API mutation analysis is the main bottleneck. Running services in parallel removes
about 97 seconds of sequential work; runner setup, cache misses, and queueing affect
the actual result. The first matrix run [37549281367](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/37549281367)
passed all gates, but its API shard still took 5 minutes 6 seconds. Runner variance
and the API bottleneck limited the overall gain; service parallelism alone is not
a claim of a measured 97-second improvement.

Three large controller suites now use standalone MockMvc for their existing HTTP
requests and assertions. They previously bootstrapped Spring MVC slices while
mocking repositories and disabling security filters. Full Spring integration suites
still test application wiring, public/protected routes, and rate limiting. The
standalone setup retains plain-text responses and Boot's ISO timestamp format.
An isolated same-machine Java 21 comparison reduced API PIT analysis from 81 to
74 seconds and the Maven invocation from 96 to 85 seconds. Both comparison runs generated the
same 1,401 mutation identities and passed the original thresholds. These local
measurements are diagnostic evidence; GitHub runner timings are the delivery
measurement.

Ingest tests also had a repeatable 30-second JVM shutdown stall. The Surefire
thread dump identified Spring waiting for future scheduled work during shutdown.
Both application and retention schedulers now cancel queued delayed tasks when
shutdown begins, while retaining the existing wait for active tasks to finish.
A parameterized regression verifies cancellation, completion without interruption,
and executor termination for both schedulers. The full local Maven verification
passed 366 tests, fell from 64 to 40 seconds in successive runs, and no longer
produced the forced-JVM-shutdown warning. This is also a runtime shutdown
change; normal polling and retention behavior while the application runs are
unchanged.
## Initial API partition comparison

Before API sharding, verified PR run
[37552089599](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/37552089599)
finished CI in 4 minutes 42 seconds, with API mutation testing taking 3 minutes
28 seconds. A disposable local comparison of the two partitions reproduced all
1,401 mutation identities and statuses from the full run: 944 detected. Local
timings are diagnostic only; compare GitHub job and pipeline elapsed times,
including report aggregation and runner queueing, to assess the delivered gain.

## Application-layer cache export

The scopes end in `-dependencies-v1` to avoid importing old application-layer caches.
The first run must populate these scopes; compare cold and warm runs before claiming
a timing improvement. The triggering API job in run
[38033314009](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/runs/38033314009)
built in about 30 seconds but spent 18 minutes exporting application build layers.
The dependency-only export removes that per-edit upload; this is not a guarantee
against registry, Maven Central, or GitHub cache outages.
