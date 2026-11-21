![Colorado Traffic Tracker](https://raw.githubusercontent.com/brentjColoS/ColoradoTrafficTracker/main/docs/assets/ctt-wordmark.svg)

This is a short maintainer reference. The
[live dashboard](https://coloradotraffictracker.net/dashboard/) and
[API explorer](https://coloradotraffictracker.net/dashboard/api.html) are the
quickest ways to examine the project.

## Source and configuration

The repository is a Maven multi-module project on Java 21, with a Docker Compose
definition for PostgreSQL/TimescaleDB and the three services. The checked-in
environment examples describe the current configuration. Real provider
credentials remain private; the default flow and incident collectors use
separate TomTom and CDOT credentials.

Read the [working agreement](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/AGENTS.md)
before changing the application. The
[runtime policy](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/runtime-version-policy.md)
owns version pins, and the
[browser guide](https://github.com/brentjColoS/ColoradoTrafficTracker/blob/main/docs/browser-testing.md)
owns browser and packaged-runtime commands.

## Useful verification commands

```bash
./mvnw clean verify
./scripts/verify-resilience.sh
python3 -B -m unittest discover -s operations/portfolio -p 'test_*.py'
```

Choose checks appropriate to the change. Fixture-based tests and offline
publisher replay do not require provider collection. Avoid starting live
ingestion merely to review text, images or navigation.

[Testing and verification](Testing-Strategy) explains the evidence those checks
provide. Host deployment and recovery procedures stay in the repository's
maintained runbooks linked from [Operations and reliability](Operations-Runbook).
