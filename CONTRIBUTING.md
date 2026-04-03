# Contributing

Thank you for your interest in contributing to Colorado Traffic Tracker.

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

Use clear commit messages that explain intent.

Recommended style:

- `docs: expand runbook with failure scenarios`
- `feat(api): add historical corridor endpoint`
- `fix(ingest): avoid retry on client-side validation errors`

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
