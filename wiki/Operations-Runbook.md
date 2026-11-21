![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

The public site runs on one VPS. Caddy handles HTTPS and proxies to the
containerized application; the services and database remain behind that public
boundary. This page explains the operating decisions. The linked repository
runbooks hold the host procedures.

## Check the observations

A running container is one signal. I also check whether usable I-25 and I-70
observations are arriving, whether the CDOT snapshot is recent, and whether
the provider state has a reason that explains a degradation.

Repeated speeds can be fresh observations. One exhausted TomTom account is not
an outage while another account can continue collection. A stale or degraded
state should explain what failed and what action would help.

The [monitoring reference](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/healthchecks-io-monitoring.md)
records the freshness allowance and the backup/disk checks. These checks run
independently of visitors opening the dashboard.

## Protect the history

Retention moves older traffic into queryable archives. Database backups are a
separate recovery mechanism, with off-site copies, checksums and disposable
restore checks. A checksum audit establishes file integrity; a successful
restore checks that a selected backup can actually be read as a database.

The [off-site backup guide](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/windows-offsite-backups.md)
distinguishes routine verification from the broader restore procedure. Historical
traffic is not automatically deleted to relieve disk pressure.

## Verify the revision being released

Production runs from a reviewed `main` revision. A release check includes the
actual deployed artifact, readiness, recent observations, provider status,
historical continuity and required timers. Container startup alone does not
complete that check.

The separate dashboard sidecars have their own release boundary and read-only
database role. Reviewing a UI does not require promoting it into production or
changing live data.

## The portfolio images are a separate publication

A small timer regenerates the map estimates and journal every 15 minutes. The
calendar is advanced daily after a Denver day is complete. Its cached daily
lows and generated images live outside Git; the background is reused.

Publication uses a completed snapshot directory and an atomic `current` link.
If an input or render fails, the last good images keep their existing
timestamps. This does not change ingestion or contact the traffic providers.
The [publisher guide](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/operations/portfolio/README.md)
contains activation, inspection and rollback steps.

## Maintainer references

- [VPS deployment](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/cloud-vps-deployment.md)
- [Dashboard delivery workflow](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/experimental-delivery-workflow.md)
- [Provider account operations](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/tomtom-two-account-operations.md)

[← Testing and verification](Testing-Strategy) · [Wiki home →](Home)
