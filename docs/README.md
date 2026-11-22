# Technical references

The [engineering wiki](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki)
provides a guided explanation of the project. These references document the
contracts, source provenance, verification tools and operating procedures behind it.

## Choose a starting point

| Task | Start here |
| --- | --- |
| Understand the system and its design decisions | [Architecture walkthrough](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Architecture). |
| Trace a dashboard response into code and tests | [Dashboard read models](dashboard-read-models.md#implementation-and-checks). |
| Interpret an older observation or a missing dataset | [Data history coverage](data-history-coverage.md). |
| Inspect test results and measurement limits | [Testing and verification](https://github.com/brentjColoS/ColoradoTrafficTracker/wiki/Testing-Strategy). |
| Operate a reviewed production release | [Production deployment](cloud-vps-deployment.md). |

## Dashboard and data

| Reference | Scope |
| --- | --- |
| [Dashboard behavior](dashboard-primary-behavior.md) | Current views, historical navigation, availability and interaction rules. |
| [Dashboard read models](dashboard-read-models.md) | Snapshot freshness, selected-window summaries, progressive responses and bounded work. |
| [Frontend ownership](frontend-maintainability.md) | Browser modules, dependency direction, styling and focused verification. |
| [Chart paint frames](dashboard-chart-frame-contract.md) | Rendering inputs, history strips and ownership of display policy. |
| [Incident presentation](incident-presentation.md) | Classification, inference, grouping and source-report preservation. |
| [Data history coverage](data-history-coverage.md) | Dataset start dates, archive access, corridor-definition changes and unavailable detail. |
| [Incident event operations](incident-event-operations.md) | Collection leases, durable lifecycle state and historical compatibility. |

## Maps and source data

| Reference | Scope |
| --- | --- |
| [Corridor geometry](corridor-geometry-sources.md) | Source relations, directional matching, anchors and catalog QA. |
| [Map imagery](corridor-map-imagery.md) | Basemap contracts, attribution, geographic context and fallback. |
| [MapLibre renderer](maplibre-renderer.md) | Pinned distribution, integrity hashes and dependency updates. |
| [I-70 variable speed signs](i70-sign-ingestion.md) | Scheduled collection, current and retained readings, interpretation and rollback. |
| [Flow source profiles](traffic-flow-profile-evaluation.md) | Selected cadence, precision options, bounded experiments and dated results. |
| [Road-sign component](road-sign-display.md) | Decorative sign ownership and authoritative artwork sources. |

## Verification and operations

| Reference | Scope |
| --- | --- |
| [CI pipeline](ci-cd-pipeline.md) | Required gates, artifact provenance, mutation partitions and cache validation. |
| [Browser testing](browser-testing.md) | Fixture and packaged-application checks, accessibility, visual baselines and diagnostics. |
| [Production deployment](cloud-vps-deployment.md) | Reviewed releases, readiness, live-data checks and rollback. |
| [Provider accounts](tomtom-two-account-operations.md) | Per-account allowances, reservations, rollover and reset evidence. |
| [Health monitoring](healthchecks-io-monitoring.md) | Freshness thresholds, provider capacity, disk and backup alerts. |
| [Off-site backups](windows-offsite-backups.md) | Catch-up, integrity audits, recovery copies and restore drills. |
| [Optional readers](dashboard-sidecar-operations.md) | Independent read-only previews and their lifecycle. |
| [Experimental releases](experimental-delivery-workflow.md) | Branch destinations, isolation, reviewed artifacts and release verification. |
| [Runtime policy](runtime-version-policy.md) | Version pins, maintenance cadence and upgrade criteria. |
| [Portfolio images](../operations/portfolio/README.md) | Static artwork, scheduled traffic snapshots and wiki publication. |

## Decisions, evidence and artwork

[The primary dashboard cutover](dashboard-promotion-plan.md) records the
October 2026 release decision and verification. Dated records under
[evidence/](evidence/) retain measurement scope, revisions and limitations.
They describe their recorded workloads rather than current production performance.

[Documentation artwork](assets/) and [road-sign sources](artwork/road-signs/)
retain their source and license records. Keep original artwork and attribution
when regenerating derived assets.
