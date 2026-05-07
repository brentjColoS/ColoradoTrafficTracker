## Summary

Describe the change clearly and concisely.

## Why this change

Explain the problem being solved and impact.

## Validation

List what you ran locally:

- [ ] `./mvnw clean verify`
- [ ] `./scripts/verify-resilience.sh` (if Compose, healthcheck, or watchdog behavior changed)
- [ ] `docker compose up --build` (if relevant)
- [ ] manual endpoint checks (if relevant)

## Documentation

- [ ] README/docs updated (if behavior, config, or API changed)

## Checklist

- [ ] scoped changes only
- [ ] no secrets committed
- [ ] tests added/updated where practical
