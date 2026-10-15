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

Map labels use compact chips with the reported mph and a direction tag: teal
`E→` for eastbound and purple `←W` for westbound. The legend spells out both
directions; accessible labels and popups retain the full names. The chips omit
the redundant `SPEED LIMIT` heading and keep minimal padding.
Eastbound signs sit above their locations and westbound signs below, with stems
back to the source point. Map badges and their popups use successful, available
numeric reports that differ from their configured reference only. Unchanged
signs are omitted at every zoom, including from grouped popup details. Failed,
stale, blank, and conflicting readings have no map marker; a failed companion device is omitted from an otherwise available
paired location. Summary counts still report unconfirmed coverage.

At overview zoom, nearby reports become area badges labeled **Speed Limit
Reduced**, or **Speed Limits Changed** when no report is below its configured
reference. Regular readings do not create overview alerts. Pixel collisions
are checked again after each merge so area badges do not overlap each other.
Zooming in restores individual direction/speed chips wherever they fit; crowded
locations remain grouped. Panning and resizing recompute grouping locally,
without data requests. Offscreen locations are excluded from area membership.

Select an area for direction-specific speeds and expandable sign locations,
including their source update and successful-read timestamps. The popup says
these are observations at signs; the gaps are not a verified continuous
restriction. No geographic hazard boundary is inferred from sign spacing.

Individual labels retain their directional side. One placement pass handles both
area and numeric labels, rejects intersections with every projected route segment,
and reserves space around incident circles, visible mile markers, and zone badges.
Labels stay inside the map; if no clear position fits, the label is omitted and
its summary remains available. Basemap text drawn into raster tiles is outside
this application-owned collision system.

Connector stems are independent, noninteractive markers below all label panels.
They share each label's offset, visibility, and cleanup lifecycle. Area connectors
use the same factory and clearance checks as individual signs. Offscreen reports
are excluded rather than accumulated at the map edge. Configured numeric reference
chips remain hidden on I-70; comparison values remain in sign details. I-25 keeps
its reference labels beside the route. The chart heading reserves a readable
column or takes a full row when controls need to wrap.

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
checks; no topic merge or API release has been performed. Changes belong to the
sign layer, bounded ingestion, additive schema, saved-sign demo, documentation,
or tests.

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

- `./mvnw clean verify`: passed with Java 21; 464 tests, two existing skips.
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
CDOT key. Tests and browser fixtures make no CDOT requests. The initial delivery
did not authorize a production or sidecar deployment, live migration, ingestion
enablement, or merge. The later saved-sign demo request authorizes only the
separate static preview. The feature still awaits review into the experimental parent;
the separate main prerequisite remains necessary before live collection.

## Separate saved-sign demo

The requested preview is `/dashboard-experimental/variable-limit-demo/?corridor=I70`.
It serves a separate static export from this feature branch, while ordinary
experimental traffic reads continue through the existing experimental API.
Publishing this preview does not merge the feature or replace either API
container. The sign layer uses a frozen public CDOT snapshot captured October 14,
2026 at 5:06:57 PM MDT: 42 devices, 35 available, five communication errors, and
two unavailable. Nearby devices produce 22 map locations. Its banner and sign
labels distinguish the saved limits from current traffic; source/read times are
preserved. Freshness is evaluated at capture time only inside this demo.

`scripts/prepare-variable-limit-demo.py` exports the dashboard from a specified
source directory and a normalized snapshot. It checks the reviewed ID/location
catalog, limits count and size, exports only public sign fields, disables replay,
and refuses to overwrite an existing export. `variable-limit-demo.js` loads that
local JSON once and adds its section to the existing current traffic batch.
Historical batches receive no sign section, and ordinary dashboard pages never
load the adapter. Missing snapshot data degrades only the sign section.

Example preparation from an archived, checked revision:

```bash
git archive <checked-feature-sha> | tar -x -C <new-source-directory>
python3 <new-source-directory>/scripts/prepare-variable-limit-demo.py \
  --source <new-source-directory> --snapshot <normalized-public-snapshot.json> \
  --output <new-demo-export-directory>
```

Publish only the exported `dashboard` directory under a separate versioned web
root. The matching Caddy route uses `no-store` and the existing experimental
`noindex` policy. Preserve the previous Caddy file, validate the candidate, guard
against concurrent config changes, reload, and verify assets and both existing
readers. No database migration, credential change, scheduled provider read, or
container restart is needed. Preserve the export and Caddy rollback file for
recovery. The live production-ingestion prerequisite remains issue #233.

## Live preview connection

The October 14 backend deployment request authorizes the focused main prerequisite
tracked by issue #233, including V27 and deliberately enabling the scoped poller.
It does not authorize promoting the experimental dashboard into main.

`prepare-variable-limit-demo.py --source <checked-source> --live --output <new-export>`
builds a live version at the same separate preview URL. It reads the primary
API's database-only I-70 sign endpoint once per minute at most per browser,
shared across the existing preload batches. Traffic reads continue through the
experimental API. This needs no experimental container replacement, credentials,
Flyway enablement, or database role changes. Live mode keeps normal freshness
checks and labels the newest successful sign read and initial coverage. It does
not load a saved JSON file or override the observation clock. The saved-snapshot
export remains available for rollback and fixture review.

Live mode, saved mode, response failure, real-time staleness, shared read caching,
and both export modes passed all 404 dashboard tests on October 14, 2026.


Reconciliation source record: continue checked map source `37ad1da`, retain the
changed-only area behavior from `5a0e30d` and heading sizing from `cbb826d`.
The focused feature remains PR #232 to `experiment/dashboard-reconstruction`.
A combined validation preview may additionally retain the existing experimental
history, health, flow, stored-observation, and incident-detail source `fb36be7`;
that integration candidate is separate from this focused PR and from production.

The combined validation preview retains `fb36be7`'s historical card loading,
compact incident facts/full-report disclosure, observed health activity,
stored/visible/history metrics, and responsive illustrated service flow. Shared
batch construction includes both sign and stored-observation dependencies.
Native sign sections take precedence over the static bridge, including explicit
failures, so integration does not add duplicate sign reads. The bridge remains
necessary when exporting onto the existing experimental API revision, whose
native batch has not yet incorporated the sign section.
