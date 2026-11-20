# Data history coverage

This page is the current source of truth for retained traffic history while the
broader data documentation is being reworked.

## Corridor samples

The retention job moves expired `traffic_sample` rows into
`traffic_sample_archive`. Archive-inclusive views keep those scalar corridor
samples available to history and analytics queries.

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

## Variable speed sign observations

Migration `V29` adds `traffic_variable_speed_sign_history`. Opt-in ingestion with
`CDOT_VSL_HISTORY_ENABLED=true` retains the normalized payload and original read
timestamps from existing CDOT sign reads, including normal, unavailable and failed
reads. It does not add provider requests, alter the staggered six-hour schedule,
backfill the current snapshot or rewrite older data. Capture defaults off.

Current state commits before the independent history transaction. History errors
leave an explicit gap, log an operator action and do not roll back current state
or trigger another provider request. Each transaction has a three-second deadline,
two-second statement limit and one-second lock limit. Identical retries add no
duplicate; conflicting observations cannot overwrite retained history. Late reads
cannot rewind current state.

At 42 sign reads per six hours, normal growth is about 168 rows/day or 61,320/year.
Each payload is limited to 4,096 characters (normally much smaller); table/index
overhead is additional. There is no automatic deletion. Existing full database
backups include the table. Query actual growth with `pg_total_relation_size` and
the retained row count rather than treating this rate estimate as a storage cap.

Before activation, verify the fresh database backup by checksum and disposable
restore, apply the additive migration through the normal main release, and verify
current sign updates with capture disabled. Enable capture in the private ingest
environment and verify the next normally scheduled read. Reader roles need SELECT
on the new table, never write access. History starts at the first retained read,
not the deployment time. Six-hour polling cannot establish exact change times.

To stop recording, set `CDOT_VSL_HISTORY_ENABLED=false` and recreate only ingest
with the reviewed image. An application rollback leaves the additive table and
its observations intact; do not drop it or undo applied migration records. A
missed append is not reconstructed from a later snapshot. Traffic samples,
archives, quotas, incident events and existing retention remain unchanged.

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
