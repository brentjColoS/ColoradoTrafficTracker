# Experimental dashboard sidecar

This runbook keeps the production dashboard on `main` while serving a reviewed
development revision at `/dashboard-experimental/`. Both dashboards read the
same actively ingested PostgreSQL data. Only the production `ingest-service`
contacts TomTom and CDOT.

The sidecar is intentionally a separate Compose project. It joins the existing
production Docker network, starts one `api-service` image from the experimental
worktree, and publishes that image only on `127.0.0.1:8083`. It does not own or
restart the production database, routes service, ingest service, or API.

```text
Caddy
  /dashboard/                       -> production api-service :8080
  /dashboard-api/                   -> production api-service :8080
  /dashboard-experimental/          -> experimental sidecar :8083
  /dashboard-experimental-api/      -> experimental sidecar :8083
                                              |
production ingest-service -> production PostgreSQL <- read-only connection
```

## Safety boundaries

- Keep the production checkout on `main`. Use a separate worktree for the
  experimental branch.
- Build a clean, committed revision. The helper refuses a dirty checkout and
  tags the image with the full Git commit.
- Give the sidecar a dedicated PostgreSQL login with `SELECT` only and
  `default_transaction_read_only=on`.
- Flyway is disabled and the Hikari connection pool is marked read-only in
  `docker-compose.experimental-dashboard.yml`.
- Do not add provider credentials to `.env.experimental`. The API image has no
  ingestion scheduler and the sidecar receives no TomTom or CDOT keys.
- The public experimental path uses the normal 60-second live refresh. It
  ignores `?replay=1` so a five-second replay loop cannot multiply load against
  the production database. Replay remains available at `/dashboard/?replay=1`
  in an isolated local environment.
- Experimental health is independent. Do not make the production Healthchecks
  heartbeat or deployment rollback depend on this optional sidecar.

The production auto-updater uses the `coloradotraffictracker` Compose project;
the helper always uses `coloradotraffictracker-experimental`. This separation is
what prevents the production updater's `--remove-orphans` from treating the
sidecar as an obsolete production container.

## 1. Prepare a separate worktree

On the VPS, leave `/opt/colorado-traffic-tracker` on `main` and create a second
worktree from the reviewed development revision. Replace the example ref with
the exact approved branch or commit.

```bash
cd /opt/colorado-traffic-tracker
git fetch origin
git worktree add /opt/colorado-traffic-tracker-experimental \
  origin/experiment/corridor-traffic-map-development
cd /opt/colorado-traffic-tracker-experimental
```

Using an exact commit is preferable for a fixed review deployment. A branch is
appropriate when the endpoint is deliberately tracking reviewed development
updates, but every update should still be fast-forwarded and verified before it
is built.

## 2. Create the read-only database login

Open `psql` inside the existing production database container. This uses the
container's configured database owner without printing credentials.

```bash
cd /opt/colorado-traffic-tracker
docker compose --env-file .env.cloud exec db \
  sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Run the following in `psql`. `\password` prompts without placing the password in
shell history.

```sql
CREATE ROLE traffic_dashboard_reader LOGIN;
\password traffic_dashboard_reader
SELECT format(
  'GRANT CONNECT ON DATABASE %I TO traffic_dashboard_reader',
  current_database()
) \gexec
GRANT USAGE ON SCHEMA public TO traffic_dashboard_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO traffic_dashboard_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO traffic_dashboard_reader;
ALTER ROLE traffic_dashboard_reader SET default_transaction_read_only = on;
```

The default-privilege statement must be executed by the same role that applies
Flyway migrations. If migrations use a different owner, run that statement as
the migration owner as well. A future migration that creates objects under a
different owner must grant the reader access before the sidecar is updated to
use those objects.

## 3. Configure the sidecar

```bash
cd /opt/colorado-traffic-tracker-experimental
cp .env.experimental.example .env.experimental
chmod 600 .env.experimental
nano .env.experimental
```

Set a new random `SPRING_DATASOURCE_PASSWORD` matching the role above and a separate
random `EXPERIMENT_API_SECURITY_KEYS` value. Confirm these production resource
names before starting:

- `PRODUCTION_DOCKER_NETWORK=colorado-traffic-tracker_default`
- `PRODUCTION_DB_HOST=traffic-db`
- `PRODUCTION_POSTGRES_DB=traffic`
- `PRODUCTION_ROUTES_HOST=routes-service`

The populated file is ignored by Git and must remain only on the host.

Validate the configuration without starting anything. The helper uses Compose's
quiet validation mode so it does not print the populated secrets:

```bash
./scripts/experimental-dashboard.sh config .env.experimental
```

## 4. Start and verify the loopback upstream

```bash
./scripts/experimental-dashboard.sh start .env.experimental
./scripts/experimental-dashboard.sh status .env.experimental
./scripts/experimental-dashboard.sh verify .env.experimental
```

`start` builds only the current experimental worktree, waits for the container
health check, and verifies health, the dashboard HTML, and a read-only
operational-status query. It does not invoke the production Compose project.

Before changing Caddy, confirm production is still healthy and fresh:

```bash
curl -fsS http://127.0.0.1:8080/actuator/health
curl -fsS http://127.0.0.1:8080/dashboard-api/system/operational-status
curl -fsS http://127.0.0.1:8083/actuator/health
curl -fsS http://127.0.0.1:8083/dashboard-api/system/operational-status
```

The two operational snapshots should report the same latest I-25 and I-70
observation times. Small differences during a one-minute ingest transaction are
normal; repeat the check after the poll completes.

## 5. Add the public path

Use the path-specific handlers in `deploy/caddy/Caddyfile.example`. They rewrite
the experimental public UI and API prefixes to the sidecar's internal
`/dashboard/` and `/dashboard-api/` routes, then leave every other request on the
production API.

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Verify both surfaces from outside the proxy:

```bash
curl -fsS https://coloradotraffictracker.net/actuator/health
curl -fsS https://coloradotraffictracker.net/dashboard/ >/dev/null
curl -fsS https://coloradotraffictracker.net/dashboard-experimental/ >/dev/null
curl -fsS https://coloradotraffictracker.net/dashboard-experimental-health
curl -fsS https://coloradotraffictracker.net/dashboard-experimental-api/system/operational-status
```

Open both dashboards and confirm the production layout remains unchanged while
the experimental path shows the reviewed development UI. Inspect `docker stats`
and PostgreSQL activity with one browser first, then with the expected number of
review sessions.

## Updating the development UI

Only deploy reviewed, committed revisions:

```bash
cd /opt/colorado-traffic-tracker-experimental
git status --short
git pull --ff-only
./scripts/experimental-dashboard.sh start .env.experimental
```

Compose replaces only the experimental container. Its image tag records the
full commit, which keeps production and development images distinct and makes a
previous revision straightforward to rebuild.

## Rollback

Stopping the sidecar never stops production services:

```bash
cd /opt/colorado-traffic-tracker-experimental
./scripts/experimental-dashboard.sh stop .env.experimental
```

Remove the three experimental handlers from Caddy and reload it if the public
endpoint should disappear completely. Leaving the handlers while the sidecar is
stopped produces an error only under the experimental prefixes; `/dashboard/`
and `/dashboard-api/` continue to use the production API.

Revoking the database login is optional after the sidecar is retired:

```sql
REVOKE CONNECT ON DATABASE traffic FROM traffic_dashboard_reader;
```

Do not drop the role until any default privileges granted to it have been
reviewed and removed deliberately.
