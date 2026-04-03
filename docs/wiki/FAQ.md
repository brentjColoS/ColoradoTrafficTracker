# FAQ

## Why split this into three services?

To isolate route configuration, ingestion responsibilities, and read API concerns. It keeps each unit easier to reason about and evolve.

## Why store incidents as JSON text?

For MVP velocity and schema flexibility while upstream data shape is still evolving. Normalized schema is planned in roadmap milestones.

## Is this production-ready?

It is production-style and deployment-friendly, but still a portfolio MVP. Planned work includes migrations, richer tests, auth, and deeper observability.

## How often does ingest run?

Default is every 60 seconds (`traffic.pollSeconds`).

## What is the easiest local run path?

Use Docker Compose with `.env` configured and call the health endpoints.
