# Production deployment

Colorado Traffic Tracker runs on one Hetzner VPS behind Caddy/HTTPS at
https://coloradotraffictracker.net/dashboard/. Docker Compose runs PostgreSQL/
TimescaleDB, route metadata, scheduled ingestion and the public API/dashboard.
Only Caddy is public; application/database ports bind to loopback.

The source checkout is `/opt/colorado-traffic-tracker` on `main`. Private
`.env.cloud` configuration remains host-local and root-readable. Provider keys
belong to ingestion. The optional restricted browser-basemap setting is separate
from provider collection credentials. Optional API readers have their own
[read-only lifecycle](dashboard-sidecar-operations.md).

## Inspect a release

Before deployment, compare the current server revision with the reviewed main
revision and its full diff. Confirm readiness, fresh I-25/I-70 observations, CDOT
fetch metadata, provider allowance, disk headroom and active timers. Preserve
previous images and private proxy/application configuration for rollback.

```bash
cd /opt/colorado-traffic-tracker
git status --short --branch
git rev-parse HEAD
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud ps
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud images
curl -fsS http://127.0.0.1:8080/actuator/health/readiness
curl -fsS http://127.0.0.1:8080/dashboard-api/system/operational-status
curl -fsS http://127.0.0.1:8082/actuator/health/quotaPressure
```

Database-image or schema changes require a fresh checksummed backup and a
successful disposable restore. Record original archive-inclusive row totals,
earliest observations and any relevant identity/content fingerprints. Preserve
the original dump outside scheduled pruning through the recovery window. The
[backup guide](windows-offsite-backups.md) owns dump verification and off-site
copies; [coverage](data-history-coverage.md) defines the retained datasets.

## Normal main updates

`colorado-traffic-tracker-auto-update.timer` invokes the reviewed
[`server-auto-update.sh`](../scripts/server-auto-update.sh). It acquires
`/var/lock/colorado-traffic-tracker-auto-update.lock`, refuses tracked local
changes, fetches main and fast-forwards before rebuilding the Compose services.

The updater allows three minutes for API readiness, then six minutes for both
corridors to produce new samples and operational status to become healthy,
including current CDOT data. Failure restores the previous revision and rebuilds
it. The updater does not query CI itself; repository protections and release
review establish the source selected by main.

After confirming main still selects the intended release, a manual invocation
uses the same service:

```bash
systemctl start colorado-traffic-tracker-auto-update.service
systemctl status colorado-traffic-tracker-auto-update.service
journalctl -u colorado-traffic-tracker-auto-update.service -n 100 --no-pager
```

For a deliberately scoped manual release, hold the same updater lock and build
the exact candidate before replacing the affected service. An API-only change
can leave ingestion, routes and the database running. Preserve both the previous
running image and its Compose tag so a restart can select the rollback image.
Do not use a full-stack shutdown or forced checkout reset as routine updating.

## Verify the deployed result

| Check | Required evidence |
| --- | --- |
| Revision and scope | Clean main checkout and intended image/source identities. |
| API readiness | Successful readiness response; container liveness alone is insufficient. |
| Flow | New usable observations for both I-25 and I-70. Repeated speeds can still be fresh. |
| CDOT | Successful snapshot fetch time and provider metadata, independent of event modification time. |
| TomTom | Per-account state, allowance and request-ledger continuity. |
| History | Archive-inclusive totals/earliest observations and relevant frozen fingerprints remain consistent while collection continues. |
| Public behavior | Changed pages/assets and their data paths work from the public mount. |
| Operations | Required updater, health and backup timers remain enabled; optional readers remain independent. |

Record the tested revision and results. Diagnose failed verification before
retrying a release. If rollback is necessary, restore the previous image/tag and
configuration, verify health and new observations, and preserve all database
contents and applied migrations. Coordinate the updater while main still points
to a failed candidate; restore its normal state after the reviewed correction.

## Routine operation

```bash
cd /opt/colorado-traffic-tracker
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud logs --tail=100 api-service
systemctl list-timers --all 'colorado-traffic-tracker-*'
./scripts/server-health-check.sh
```

The main systemd service's stop action takes down the production Compose stack.
Pausing automated updates therefore uses the updater timer/lock, not the main
service. Protect existing volumes and `.env.cloud`; removing volumes destroys
the database independently of Git rollback.

The [monitoring guide](healthchecks-io-monitoring.md) owns failure thresholds and
notification setup. The [runtime policy](runtime-version-policy.md) owns image
pins and upgrade criteria. Initial host provisioning follows the official
[Docker](https://docs.docker.com/engine/install/ubuntu/) and
[Caddy](https://caddyserver.com/docs/install) instructions rather than a separate
copy of vendor installation commands.

README images use a separate static Caddy route and least-privilege timer. Their
[publisher guide](../operations/portfolio/README.md) owns installation, cadence,
verification and rollback; it does not require restarting the application or
database. Wiki publication follows the same guide after main artwork and image
URLs are available.
