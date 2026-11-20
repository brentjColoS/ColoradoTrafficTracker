# Data history coverage

This page is the current source of truth for retained traffic history while the
broader data documentation is being reworked.

## Corridor samples

The retention job moves expired `traffic_sample` rows into
`traffic_sample_archive`. Archive-inclusive views keep those scalar corridor
samples available to history and analytics queries.

Hourly trend and baseline reads aggregate the same archive-inclusive scalar
observations inside indexed timestamp bounds. They still select whole hourly
buckets: a historical endpoint within an hour includes that hour's later
observations when the bucket itself is selected. Null-speed rows remain in the
sample count, and archive counts, incident totals and all speed statistics keep
the existing hourly-view semantics. This is a read-query optimization; it adds
no stored summaries, migrations or maintenance jobs.

I-70 continues to use the same `I70` corridor identity when its monitored
extent expands from MM 206–259 to MM 206–274. Existing scalar samples remain in
the live and archive-inclusive history and are not rewritten. Consumers should
treat the rollout as a corridor-definition boundary: earlier corridor averages
describe the original mountain-corridor extent, while later averages also
include Golden and west Denver through I-25.

## Speed-zone samples

Migration `V24` makes `traffic_speed_zone_sample` durable instead of deleting
zone observations when their parent corridor sample moves into the archive.
The existing `sample_id` remains a logical reference:

- while a sample is live, it matches `traffic_sample.id`;
- after retention, it matches `traffic_sample_archive.source_id`.

Detailed zone history cannot be reconstructed for rows deleted before this
change. The durable production coverage begins at
`2026-08-15T02:15:15.265499Z`, the oldest zone observation present after `V24`
was deployed. A production check on September 24, 2026 found 525,744 retained
zone rows through `2026-09-24T21:59:31.502252Z`.

Use this query to confirm that boundary and the current retained range:

```sql
select min(polled_at) as zone_history_coverage_started_at,
       max(polled_at) as latest_zone_observation_at,
       count(*) as retained_zone_rows
from traffic_speed_zone_sample;
```

The table deliberately has no foreign key to only one side of the live/archive
split. Its `sample_id` index still supports joining either storage tier.

The six existing I-70 speed-zone keys remain unchanged through MM 259 so their
retained histories continue to resolve. Two new keys begin collecting at the
rollout: `I70-259-270_274` and `I70-270_274-274`. No synthetic rows are created
for those new zones before they were monitored.

## Local map flow cells

Migrations `V25` and `V26` add the map's half-mile flow-cell read model. The
current tables replace each corridor snapshot in place; they are current state,
not minute-by-minute history. The hourly table keeps one aggregate per UTC hour,
corridor, cell, and available direction with no automatic time cutoff.

Production map history begins at the UTC hour
`2026-09-24T21:00:00Z`. It is not reconstructed from older corridor or
speed-zone summaries because those rows do not preserve the source paths needed
for truthful short-stretch values. Older dashboard views must continue to show
local flow as unavailable.

## Observed variable speed limits

Additive migration `V29` retains normalized CDOT sign payloads from the existing
scheduled reads in `traffic_variable_speed_sign_history` when ingestion opts in
with `CDOT_VSL_HISTORY_ENABLED=true`. Capture defaults off. Current state commits
before an independent history transaction, so missing or locked history cannot
undo a current update or trigger another provider request. Transaction, statement
and lock deadlines are three, two and one seconds respectively. An append failure
logs an operator action and leaves a gap. Successful, normal, unavailable and failed
reads are retained; identical retries add no duplicate, conflicts cannot overwrite
history and late saves cannot rewind current state. Raw payload values and timestamps
are not rewritten. History begins prospectively; there is no reconstruction from
the current snapshot or activation metadata.

`GET /dashboard-api/traffic/map/variable-speed-limits/history` accepts I70 only,
`windowHours` from 1 to 720, and optional `asOf`. It reads stored rows only, with
one hour of left-edge context, a five-second query deadline and a 6,000-row cap.
An oversized window returns 422 instead of partial history; unavailable storage
returns 503 without breaking the current sign or traffic endpoints. No response
cache or browser persistence is added. The dashboard loads this history only
when I-70 Speed Zones is selected and keeps one bounded window in memory.

Yellow dashed segments mark sign locations within a speed zone, not a zone-wide
posted limit. E/W labels preserve direction. Each fresh reduced observation is
supported until the next normal, conflicting or failed reading, or at most one
hour after its successful read. Six-hour polling gaps stay unconfirmed. The
segments do not claim exact activation, clearance or continuous restriction
times. Current map/advisory confirmation and polling cadence are unchanged.

The production backend foundation is reviewed separately from the experimental
API/UI. Before activation, verify a fresh backup by checksum and disposable restore,
deploy the additive migration with capture off, then opt in and verify a normally
scheduled read. A read-only sidecar cannot collect history; its role needs only
SELECT on the new table. Disable capture and recreate only ingest, or roll back
application code without deleting the table or migration records. Existing history,
archives and retention remain untouched. At 42 reads per six hours this adds about
168 rows/day or 61,320/year, with payloads bounded to 4,096 characters plus database
overhead. There is no automatic deletion; full backups include the table. Measure
actual growth with retained row counts and `pg_total_relation_size`.

Use this query to confirm the retained map-history range:

```sql
select min(hour_start) as map_history_coverage_started_at,
       max(hour_start) as latest_map_history_hour,
       count(*) as retained_map_history_rows
from traffic_flow_cell_hourly;
```

Current-state continuity can be checked separately without treating it as
history:

```sql
select corridor, observed_at, status, supported_cell_count, total_cell_count
from traffic_flow_cell_snapshot_current
order by corridor;
```
