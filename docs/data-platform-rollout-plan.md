# Historical data and read boundaries

This page replaces the completed data-platform rollout plan. Current code,
migrations and the coverage reference own the behavior; earlier rollout and
investigation records are retained separately.

## What remains available

Scalar corridor samples move from live storage into archive tables. The
archive-inclusive views keep those observations queryable through the same
history and analytics APIs. Speed-zone rows remain durable after their parent
sample is archived.

Current incident maps and timelines use durable provider events and transitions.
New speed samples retain scalar incident context rather than copying full
incident payloads on every poll. Older sample-linked compatibility records
remain available for historical reads.

Current map cells are a separate read model. Their historical record is hourly,
and no older local flow is synthesized from corridor averages. Optional variable
speed-sign history has its own collection boundary.

## Where to read more

- [Architecture](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Architecture)
  explains service and storage responsibilities.
- [Data history coverage](data-history-coverage.md) records verified boundaries,
  the I-70 extent change and unavailable older detail.
- [Dashboard read models](dashboard-read-models.md) and
  [window summaries](dashboard-window-summaries.md) describe bounded reads.
- [Database migrations](../api-service/src/main/resources/db/migration) record
  the additive schema changes.

Changes to storage must preserve retained observations and the archive-inclusive
read contract. Database-image changes require backup and disposable restore
verification under the [runtime policy](runtime-version-policy.md).
