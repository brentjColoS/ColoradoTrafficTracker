# Optional dashboard readers

Production uses the normal main Compose project and API on loopback port 8080.
The optional readers are separate Compose projects. They use the existing
production database/network but own no data volumes, ingestion or routes service.
Neither belongs in the production Compose invocation or a boot/update timer.

| Reader | Public UI | Loopback port | Compose project |
| --- | --- | --- | --- |
| Original | `/dashboard-old/` | 8084 | `coloradotraffictracker-old` |
| Development | `/dashboard-experimental/` | 8083 | `coloradotraffictracker-experimental` |

Both default to stopped. Restart policy is `no`: an explicitly started reader
does not return after reboot. Production heartbeat and rollback do not depend
on optional health. Keep these URLs out of public navigation and promotional
copy. The Caddy example marks optional responses noindex and returns 404 for an
unavailable optional upstream. An upstream's actual HTTP error remains visible;
primary upstream failures retain their error status.

## Preserved sources

The helper defaults to these committed sources:

- Original: `0bcedf303746ea28398143e1ba6cffe95e31563f`, remotely preserved as
  `checkpoint/dashboard-old-before-promotion-2026-10-10`.
- Development: `e47a291b64564cf4fac01a5df330ec301bfe44ba`, remotely preserved as
  `checkpoint/dashboard-experimental-before-promotion-2026-10-10`.

An ordinary clone has both tagged histories. For a shallow checkout, fetch the
two checkpoint tags before building. An explicit source ref may select a newer
committed development revision; uncommitted files are never used. The source
revision and reader variant are recorded as image labels and in the image tag.

Build creates a temporary Git archive context, not a copy of the populated host
checkout. For the original reader, `prepare-old-dashboard.py` changes only the
original HTML/script asset prefixes and API request prefix. Road-sign image bytes,
CSS, backend source and retained data remain unchanged. The resulting public API
prefix is `/dashboard-old-api/`; Caddy forwards it to `/dashboard-api/` internally.

The `sidecar1` tag suffix identifies this adaptation recipe. Bump that suffix
deliberately if the build recipe changes. Build preserves an already matching
image instead of replacing its tag. Keep previous images available for rollback.

## Database access and private configuration

Keep the existing experimental reader credentials and `.env.experimental`.
Create a separate `traffic_dashboard_old_reader` login for the original reader.
Use interactive psql through the production database container; do not put its
password into SQL files or shell command arguments:

```sql
CREATE ROLE traffic_dashboard_old_reader LOGIN;
\password traffic_dashboard_old_reader
SELECT format('GRANT CONNECT ON DATABASE %I TO traffic_dashboard_old_reader', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO traffic_dashboard_old_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO traffic_dashboard_old_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO traffic_dashboard_old_reader;
ALTER ROLE traffic_dashboard_old_reader SET default_transaction_read_only = on;
```

Inspect an existing same-named role instead of recreating or overwriting it.
Run the default-privilege grant as the migration owner. Verify that neither login
is a superuser, inherits a write-capable role, owns application objects, or has
non-SELECT application-table grants. New objects created by a different owner
need reader grants before an API uses them.

Copy `.env.old.example` to `.env.old`, populate the new reader password and a
separate API security key, and set mode 600. Confirm the existing external network
is `colorado-traffic-tracker_default`. Never use the database-owner credentials
for a reader. Both Compose files disable Flyway, mark the pool/root filesystem
read-only, limit resources and logs, and omit provider credentials.

## Build and lifecycle

From the primary checkout, build does not require private environment files and
does not start anything:

```bash
./scripts/dashboard-sidecar.sh old build
./scripts/dashboard-sidecar.sh experimental build
```

Validate host-local configuration without rendering secrets, then start only
the selected reader:

```bash
./scripts/dashboard-sidecar.sh old config .env.old
./scripts/dashboard-sidecar.sh old start .env.old
./scripts/dashboard-sidecar.sh old status .env.old
./scripts/dashboard-sidecar.sh old verify .env.old
./scripts/dashboard-sidecar.sh old stop .env.old
```

Replace `old` with `experimental` and `.env.old` with `.env.experimental` for the
other reader. Start refuses a missing or mismatched image. If activation fails,
it restores the previously running image, or removes the new reader to restore
its stopped state. A failed operation returns failure even after rollback.
Stop removes only that Compose project's containers and retains all images/data.

For development, supply the same explicit ref to build and start:

```bash
./scripts/dashboard-sidecar.sh experimental build .env.experimental origin/experiment/dashboard-reconstruction
./scripts/dashboard-sidecar.sh experimental start .env.experimental origin/experiment/dashboard-reconstruction
```

Resolve and record a full SHA before using a moving branch for a review release.
To roll back deliberately, start the previous full SHA with its existing image.
Preserve/restore private configuration separately if it was changed. Do not prune
reader or primary rollback images as part of this lifecycle.

## Verification

After activation, verify readiness, the public HTML/assets and the corresponding
public API prefix. Compare I25/I70 observation times and CDOT metadata with
primary; polls can finish between reads. Inspect resource use and actual reader
permissions. No provider diagnostics or ingestion startup is needed.

Historical navigation reads retained observations, including archive-inclusive
datasets. It neither reconstructs missing coverage nor freezes the whole database
at an earlier schema. The original interface remains a preserved interface and
does not gain the newer historical-scroll controls. Shared-database replay loops
remain disabled; use the guarded local replay workflow for that diagnostic.

After stopping, verify the UI/API/health prefixes return 404 and primary remains
healthy. Validate independent operation with `scripts/test-dashboard-sidecar.sh`
and real proxy behavior with `scripts/test-dashboard-routing.sh`. The latter
uses only isolated Docker fixtures and cleans up its own containers/network.
