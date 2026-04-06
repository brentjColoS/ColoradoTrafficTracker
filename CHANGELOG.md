# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning for tagged releases.

## [Unreleased]

### Added

- Portfolio-grade root README with architecture, setup, and quality signals.
- Observability baseline for `ingest-service`, including poll-cycle and per-corridor metrics, correlation-friendly logging context fields, and health indicators for ingestion gap and tile quota pressure.
- Productization baseline for `api-service`, including API key authentication, role-based authorization, per-minute throttling, and Caffeine-backed response caching.
- Stretch goals delivered:
  - corridor anomaly detection endpoint with baseline + z-score analysis,
  - congestion forecasting endpoint with local trend projection and prediction bands,
  - dashboard UI for live corridor snapshot, trend charting, anomaly notes, and forecast visualization.
- Expanded testing and quality gates:
  - added unit/regression test suites across services,
  - added JaCoCo coverage checks in Maven `verify`,
  - added PIT mutation testing profile and CI mutation job with report artifacts.
- Documentation suite published in the GitHub Wiki: architecture, API reference, local development, operations runbook, project journey, roadmap, and wiki index pages.
- Community and governance files: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `LICENSE`.
- GitHub automation and collaboration assets: CI workflow (`.github/workflows/ci.yml`), issue templates, PR template, Dependabot config, and CODEOWNERS.

### Changed

- Elevated repository presentation and contributor onboarding for third-party review readiness.
