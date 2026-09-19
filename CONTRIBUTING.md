# Contributing

Thank you for your interest in contributing to Colorado Traffic Tracker.

Coding agents and maintainers continuing an existing task should read
[`AGENTS.md`](AGENTS.md) first. It captures the project's repository-specific
workflow, data-preservation rules, operational checks, and handoff expectations.

## Contribution principles

- Keep changes scoped and intentional.
- Prefer explicit behavior over hidden magic.
- Document new configuration and API contract changes.
- Add tests for behavior changes whenever practical.

## Development workflow

1. Fork the repository.
2. Create a feature branch from `main`.
3. Implement your changes with focused commits.
4. Run validation locally.
5. Open a pull request using the template.

## Local validation

```bash
./mvnw clean verify
```

If your change touches Docker assets:

```bash
docker compose up --build
```

## Commit guidance

Use short, imperative commit messages that explain intent in normal language.
Conventional-commit prefixes are optional rather than required.

Recommended style:

- `Expand the runbook with failure scenarios`
- `Add the historical corridor endpoint`
- `Avoid retrying client-side validation errors`

## Pull request expectations

A high-quality PR should include:

- concise problem statement,
- implementation summary,
- testing evidence,
- documentation updates when behavior/config changes.

## Code style

- Java: follow existing Spring Boot project conventions.
- Keep methods focused and readable.
- Avoid introducing unnecessary framework complexity.

## Documentation changes

Any of the following should include doc updates:

- new env vars,
- new endpoints,
- changed operational behavior,
- deployment/runtime assumptions.

## Security

Do not commit secrets or live API keys. Use `.env.example` patterns and environment variables.

See [SECURITY.md](SECURITY.md) for vulnerability reporting.
