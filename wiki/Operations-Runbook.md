![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

The public site runs on a VPS, with Caddy handling HTTPS and proxying to the
containerized application. Operations focus on whether data is arriving,
whether retained history can be recovered and which revision is serving it.
Host procedures live in the linked runbooks.

## Operational observability

Readiness, source freshness and account availability answer different questions.
A running API can serve old data, and a repeated speed can still be a fresh
observation. Checks use successful I-25 and I-70 observations, CDOT snapshot
times and provider metadata rather than changes in the numeric speed.

| Signal | Interpretation and response |
| --- | --- |
| Corridor or CDOT observations exceed the freshness allowance | Inspect the affected collector and provider reason; identify which dataset stopped advancing. |
| One TomTom account is exhausted | Check whether the other can fund a complete batch before treating flow collection as unavailable. |
| An off-site backup is overdue | Inspect the receipt and backup job; an old successful copy does not establish current protection. |
| Available disk is low | Recover headroom while preserving historical tables and backups. |

The documented monitoring policy uses a one-hour flow/CDOT freshness allowance,
an eight-day off-site-backup limit and a 10 GB available-disk warning. A
Healthchecks report runs twice daily.

The [monitoring reference](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/healthchecks-io-monitoring.md)
describes the checks and alert cadence. Status results include a concrete reason
and next action. Account exhaustion is separate from `OUT_OF_SERVICE` while
another account can still provide usable flow.

## Failure isolation and recovery

TomTom flow and CDOT events have independent schedules. Account availability
and the durable quota ledger also have different lifetimes: a restart can
re-evaluate process-local quarantine, but it does not reset recorded spend.
[Provider collection](Provider-Collection) explains retries, refunds and reset
evidence.

On the read side, incident failures leave completed speed and travel results
available. Retained cache values keep their original timestamps during refresh
failure. [Dashboard reads](Dashboard-Reads) explains which values can be reused
and how partial failures are reported.

## Recoverability of the history

Retention moves older observations into queryable archives. Backups address a
different failure: loss or corruption of the database itself. Off-site copies
use checksum verification and disposable restore checks. A checksum establishes
file integrity; a restore demonstrates that the selected backup can recreate a
readable database.

The [off-site backup guide](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/windows-offsite-backups.md)
covers verification and recovery. The
[storage walkthrough](Historical-Storage) covers the identity and query contracts
that retention must preserve.

## Release identity and least privilege

Production runs from a reviewed `main` revision. Delivery verification checks
the exact source revision and deployed artifact, followed by readiness, fresh
traffic and CDOT observations, quota status, historical continuity and required
timers. A successful container build establishes packaging; those runtime checks
establish whether the release is working with the real data.

Dashboard sidecars use a separate release path and a read-only database role.
That least-privilege boundary permits UI review against retained production
history without granting the sidecar collection or migration authority. The
[delivery workflow](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/experimental-delivery-workflow.md)
and [VPS runbook](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/cloud-vps-deployment.md)
record revision checks and rollback procedures.

## Atomic publication of README and wiki images

The image publisher reads stored observations without contacting traffic
providers. Map estimates and the journal refresh every 15 minutes; the calendar
advances daily after a Denver day is complete. Generated snapshots and cached
daily lows remain outside Git. The geographic background changes manually.

A run builds a new snapshot directory before atomically replacing the `current`
symlink. A failed read or render leaves the previous publication and its
timestamps in place. The atomic switch prevents a partially built directory
from becoming current; it does not force separate HTTP requests to use one
generation across a switch. GitHub's image cache can also retain an older image,
so each graphic identifies its snapshot time.

The [publisher guide](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/operations/portfolio/README.md)
contains activation, inspection, calendar rebuild and rollback steps.

[← Testing and verification](Testing-Strategy) · [Wiki home →](Home)
