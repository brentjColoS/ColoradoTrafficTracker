![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

The [live dashboard](https://coloradotraffictracker.net/dashboard/) and
[API explorer](https://coloradotraffictracker.net/dashboard/api.html) provide
access to the running project. The references below cover local changes and
verification.

## Tools and their roles

| Area | Tools | Role in CTT |
| --- | --- | --- |
| Services | Java 21, Spring Boot | Collection services, scheduled work and REST endpoints. |
| Storage | PostgreSQL / TimescaleDB, Flyway | Historical queries, transactional writes and versioned schema migrations. |
| Dashboard | JavaScript, HTML/CSS, Canvas, MapLibre GL JS | Browser controls, custom chart rendering and geographic map layers. |
| Java tests | JUnit 5, Mockito | Behavior checks with controlled dependencies and database-backed fixtures. |
| Test quality | JaCoCo, PIT | Line/branch coverage and mutation testing of assertions. |
| Browser tests | Playwright | Dashboard interactions, mobile layouts and packaged-API scenarios. |
| Build and CI | Maven, GitHub Actions | Module builds, automated checks and retained test reports. |
| Deployment | Docker Compose, Caddy | Container configuration, HTTPS and reverse proxying. |
| Automation | Python, Bash, PowerShell | SVG publication, host checks and off-site backup workflows. |
| Monitoring | Spring Boot Actuator, Healthchecks.io | Application health/metrics and external monitoring of scheduled checks. |

The [testing guide](Testing-Strategy) connects the checks to specific behaviors.
[Operations and reliability](Operations-Runbook) explains deployment checks,
monitoring and recovery.

## Source and configuration

The Maven multi-module project uses Java 21. Docker Compose defines
PostgreSQL/TimescaleDB and the three services. Environment examples describe
configuration; populated files and provider credentials remain private. TomTom
flow and CDOT roadway reports are configured separately.

Read the [working agreement](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/AGENTS.md)
before changing the application. The
[runtime policy](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/runtime-version-policy.md)
documents version pins, and the
[browser guide](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/browser-testing.md)
contains browser and packaged-runtime commands.

## Useful verification commands

```bash
./mvnw clean verify
./scripts/verify-resilience.sh
python3 -B -m unittest discover -s operations/portfolio -p 'test_*.py'
```

Choose checks for the changed behavior. Fixture-based tests and offline
publisher replay support reviews without live provider collection.

[Testing and verification](Testing-Strategy) explains the evidence those checks
provide. [Operations and reliability](Operations-Runbook) links the host
deployment and recovery runbooks.

[← API reference](API-Reference) · [Wiki home →](Home)
