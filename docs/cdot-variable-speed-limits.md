# CDOT variable speed limits on I-70

The experimental dashboard maps CDOT-reported variable speed signs within I-70
MM 206–274. Sign points supplement traffic observations; they do not change
speed calculations, historical baselines, or static speed-zone boundaries.

## Source and bounded ingestion

The existing CDOT subscriber key accesses `GET /api/v1/signs`. The
[CDOT traveler-information guide](https://docs.google.com/document/d/1pVDW5iRiRsAWcixw5Z9umPFRspuOUJUdH2YLpYfltP4/edit)
documents `apiKey`, a singular `id`, `limit`, and pagination `offset`.
Live checks confirmed the singular ID filter. Route, bounding-box, and plural-ID
parameters did not filter results; repeated `id` parameters returned only the
first sign. Runtime polling never falls back to statewide discovery.

`common/src/main/resources/i70-variable-speed-signs.json` contains 42 device
identities verified on October 14, 2026. The catalog contains only VSL devices
inside the monitored range, with east/west direction and verified coordinates.
Paired roadside devices retain separate identities and source status. Review
catalog changes explicitly if devices are added, moved, or the monitored range
changes; there is no automatic broad discovery poll.

`CDOT_VSL_ENABLED=false` is the default. After reviewed ingestion rollout,
set it to `true` on the ingestion service only. `CDOT_VSL_POLL_SECONDS=30`
controls the minimum spacing, with a hard floor of 30 seconds. One invocation
reads one least-recently-attempted catalog device, including devices that failed
on their previous attempt. Successful and failed attempts are persisted.
The existing database scheduler lease prevents simultaneous ingestion instances
or restarts from starting duplicate sweeps. Disabled polling or a missing key
makes no provider requests and acquires no lease.

Each provider request specifies one sign ID and `limit=2`, has a 10-second
request deadline, a 16 KiB decoded response limit, and no automatic retries.
The client rejects multi-record responses, unrelated identities, routes,
directions, and mile markers. A normal full sweep takes approximately 21 minutes
plus request latency; the hard floor permits at most 2,880 reads per day across
the ingestion schedule. There is no startup burst, per-visitor provider polling,
or key exposure in the browser. Errors are sanitized before logging.

## Display and reference limits

Map badges show the reported mph and `E`/`W` direction. Nearby paired devices
are grouped, but disagreements and companion failures remain visible. Regular,
confirmed badges appear when zoomed in; changes and unconfirmed signs remain
visible in the overview. Select a badge for individual source updates and last
successful read times. Error badges are red; unavailable values show a dash and
an exclamation mark. The last reported speed can appear in the popup but is
explicitly unconfirmed when the read or device communication failed.

The I-70 summary and Both Corridors view flag confirmed values that differ from
the configured regular road reference. The feed has no per-sign clear-weather
maximum; comparison uses `CorridorSpeedZones`, with its existing location and
boundary limitations. The notice and popup label this reference explicitly.
No I-25 limit change is inferred. A posted change is not evidence of its cause.

`lastUpdated` is the source sign-state update time, not a polling heartbeat.
An old source timestamp does not make an unchanged, successfully read sign
stale. A failed read becomes unconfirmed immediately; a successful read older
than one hour is stale and cannot confirm a reference-limit difference.

## Storage, API, and history

Additive migration `V27__current_variable_speed_signs.sql` creates a small
current-state table. Each catalog device has at most one row, with a normalized
payload limited to 4 KiB. Existing traffic, incident, quota, and archived history
are untouched. No raw provider payload or credential-bearing URL is stored.

`GET /dashboard-api/traffic/map/variable-speed-limits/current?corridor=I70`
and its protected `/api` alias return the bounded catalog, current values,
source/read times, and availability. Other corridor requests are rejected.
Missing tables or read permissions yield an explicit unavailable sign response
without preventing normal traffic reads.

The existing dashboard batch includes this read once, shared across all current
range selections. Browser corridor changes, map interactions, and zooming cause
no provider requests. The API remains a database-only reader.

This feature retains current sign state only, not historical sign transitions.
Historical chart windows, retained-data mode, and replay hide current signs and
current limit notices. They do not call CDOT or present today's limits as past
limits. A future history feature requires its own additive design.

## Review and rollout boundary

Topic branch: `feature/i70-variable-speed-limits`.
Parent and PR destination: `experiment/dashboard-reconstruction` (accepted
starting revision `710bd91`). This implements a new feature; it does not promote
the experimental dashboard or enable a production ingestion schedule.

Review: [PR #232](https://github.com/brentjColoS/ColoradoTrafficTracker/pull/232).
Implementation commit: `c152225`. The PR records its exact current head and CI
checks; no topic merge or release has been performed. All 30 changed files belong
to the sign layer, bounded ingestion, additive schema, documentation, or tests.

A sidecar-only release cannot collect signs: it has no provider keys, has Flyway
disabled, and uses a read-only database role. Before live enablement, separately
review and deliver the shared ingestion/migration prerequisite through `main`,
verify the sidecar role can SELECT the new table, then release the reviewed
experimental API/UI revision. Keep provider keys on ingestion only.

Take the normal database backup before rollout and verify existing traffic and
incident row continuity afterward. Enable the sign poller deliberately, allow
its first bounded sweep to complete, and check error/off states, timestamps,
map rendering, and reference notices. Disable `CDOT_VSL_ENABLED` to stop reads
without deleting the current records. Missing or unrefreshed signs remain
explicitly unavailable or stale. No existing service needs sign data to remain
usable.

## Validation and delivery checkpoint

Validated October 14, 2026 in the topic checkout at
`/Users/brentj/Documents/ColoradoTrafficTracker`:

- `./mvnw clean verify`: passed with Java 21; 463 tests, two existing skips.
- `node --test scripts/tests/dashboard.test.cjs`: all 400 passed, including
  scoped requests, paired-device disagreement, freshness, complete startup,
  corridor switching, marker reuse, and historical navigation.
- `./scripts/verify-resilience.sh`: passed, including Compose rendering.
- Disposable PostgreSQL migration, upsert, oversized-payload rejection,
  checksum, dump, and restore: passed. Two unrelated history fixture rows were
  preserved; restored sign state matched the original.
- Browser review with synthetic responses: Both Corridors and I-70 indicators,
  I-25 exclusion, current/history boundary, rendered map, direction/update popup,
  communication-error popup, and light/dark appearance verified.

The provider format and singular-ID filter were verified using the existing
CDOT key. Tests and browser fixtures make no CDOT requests. No production or
sidecar deployment, live migration, ingestion enablement, or merge is authorized
by this topic. Its next delivery step is review into the experimental parent;
the separate main prerequisite remains necessary before live collection.
