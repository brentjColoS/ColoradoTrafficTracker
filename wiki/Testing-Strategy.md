![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

The checks follow the failure modes the project has encountered: interrupted
collection, incomplete provider data, archived observations, browser history
navigation and differences between a fixture and the packaged application.

## What is checked

| Layer | Examples | What it establishes |
| --- | --- | --- |
| Java behavior and database tests | Request budgets, retained history, incident transitions, cache/security boundaries | Data behavior and service contracts under controlled conditions. |
| Frontend regression tests | Chart calculations, source labels, timezones, map state and shared motion controls | Decisions that can be tested without a browser renderer. |
| Playwright browser tests | History navigation, map lifecycle, incident filters, accessibility and mobile controls | Behavior in an actual browser against the selected test surface. |
| Packaged API checks | Browser reads against the built application and database fixtures | That the packaged runtime supplies the contract its client expects. |
| Operational tests | Monitoring reasons, backup checksums, recovery and delivery boundaries | How the scripts behave when a dependency fails or a publication is incomplete. |

The [CI workflow](https://github.com/brentjColoS/ColoradoTrafficTracker/actions/workflows/ci.yml)
is the place to inspect results for a specific revision. The
[pipeline reference](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/ci-cd-pipeline.md)
describes the jobs and retained reports.

## Coverage and mutation checks

JaCoCo measures line and branch coverage. PIT mutation analysis changes selected
Java behavior to check whether tests detect it. Their scopes and thresholds are
defined in the Maven configuration, so this page does not maintain a competing
set of numbers.

Passing those checks supports the behavior they exercise. It does not prove
that an upstream provider is currently available or that a deployed server is
running the tested commit. Release verification checks the actual artifact and
current observations separately.

## The README graphics have data checks too

The publisher tests Denver midnight and both DST transitions, pagination at a
full-page boundary, missing observations and the distinction between a corridor
average and a segment minimum. Failed generation leaves the previous
publication in place. Calendar values and their source record stay unchanged
between daily updates.

## Inspect a useful starting point

- [Provider accounting](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/ingest-service/src/main/java/com/example/ingest_service/TomTomAccountQuotaManager.java)
- [Browser scenarios](https://github.com/brentjColoS/ColoradoTrafficTracker/tree/main/scripts/tests/browser/specs)
- [Packaged-runtime harness](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/scripts/ci/browser_runtime.py)
- [Publisher tests](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/operations/portfolio/test_portfolio.py)

The [browser-testing guide](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/browser-testing.md)
contains the maintained commands and scope rules.

[← Data and interpretation](FAQ) · [Operations and reliability →](Operations-Runbook)
