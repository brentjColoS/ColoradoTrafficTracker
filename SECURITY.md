# Security Policy

## Supported versions

This repository is currently maintained as a single active `main` branch project.

## Reporting a vulnerability

If you discover a security issue, please report it privately and do not create a public issue with exploit details.

Recommended report content:

- affected component/module,
- vulnerability description,
- reproduction steps,
- potential impact,
- suggested mitigation (if known).

For portfolio/public repo usage, you can contact the maintainer through GitHub private channels.

## Scope notes

Primary security-relevant areas:

- environment variable and secret handling,
- external API request behavior,
- exposed API surfaces,
- dependency hygiene,
- container runtime configuration.

## Secret handling requirements

- never commit real keys or credentials,
- keep `.env` untracked,
- rotate keys if accidental exposure occurs.
