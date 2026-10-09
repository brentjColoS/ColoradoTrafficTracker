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
