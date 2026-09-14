# Data history coverage

This page is the current source of truth for retained traffic history while the
broader data documentation is being reworked.

## Corridor samples

The retention job moves expired `traffic_sample` rows into
`traffic_sample_archive`. Archive-inclusive views keep those scalar corridor
samples available to history and analytics queries.

## Speed-zone samples

Migration `V24` makes `traffic_speed_zone_sample` durable instead of deleting
zone observations when their parent corridor sample moves into the archive.
The existing `sample_id` remains a logical reference:

- while a sample is live, it matches `traffic_sample.id`;
- after retention, it matches `traffic_sample_archive.source_id`.

Detailed zone history cannot be reconstructed for rows deleted before this
change. On August 31, 2026, before the migration was deployed, the earliest
verified zone observation still present was
`2026-08-01T02:15:32.148388Z`. The exact durable coverage start is the oldest
row remaining when `V24` reaches production and must be recorded here after
deployment.

Use this query after deployment to confirm and record that boundary:

```sql
select min(polled_at) as zone_history_coverage_started_at,
       max(polled_at) as latest_zone_observation_at,
       count(*) as retained_zone_rows
from traffic_speed_zone_sample;
```

The table deliberately has no foreign key to only one side of the live/archive
split. Its `sample_id` index still supports joining either storage tier.
