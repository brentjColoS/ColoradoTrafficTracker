# Healthchecks.io monitoring

This is the lightweight external notification path for the production site. A
server timer runs twice a day, evaluates the application, TomTom capacity,
disk, and optional Windows backup receipt, then sends one success or failure
heartbeat to Healthchecks.io. It does not call TomTom or CDOT directly and does
not restart services.

Healthchecks.io supplies the missing-heartbeat check: if the VPS cannot run the
script or cannot reach the internet, no ping arrives and the check eventually
goes down. Explicit failures include the diagnostic output in the POST body.
Healthchecks.io stores at most the first 100 kB of that body.

Official references:

- https://healthchecks.io/docs/configuring_checks/
- https://healthchecks.io/docs/http_api/
- https://healthchecks.io/docs/configuring_notifications/

## Check and notification settings

Use one production check and enable its intended notification integration.
The maintained settings are:

| Field | Value |
| --- | --- |
| Name | `Colorado Traffic Tracker production` |
| Tags | `production traffic hetzner` |
| Schedule | Simple, every 12 hours, with one day of grace. |
| Description | Site, ingest, quota, disk and off-site backup; failure reasons attached. |

A missing heartbeat therefore alerts after approximately 36 hours. Explicit
`/fail` pings report detected problems immediately. Verify the configured email
or other integration using the service's normal setup procedure. Reuse the
existing check rather than creating a duplicate notification path.

The ping URL is a secret because it can alter check history. Keep it in the
private server environment, outside Git, screenshots and public diagnostics.

## Server configuration

Install against the reviewed server checkout as `root`:

```bash
install -d -m 0750 /etc/colorado-traffic-tracker
install -m 0600 /dev/null /etc/colorado-traffic-tracker/healthchecks.env
nano /etc/colorado-traffic-tracker/healthchecks.env
```

Enter the real ping URL and the desired local thresholds:

```dotenv
HEALTHCHECKS_PING_URL=https://hc-ping.com/replace-with-the-check-uuid
REQUIRE_OFFSITE_BACKUP_RECEIPT=false
MAX_OFFSITE_BACKUP_AGE_HOURS=192
DISK_PATH=/
DISK_WARN_FREE_GB=10
DISK_CRITICAL_PERCENT=90
```

Keep `REQUIRE_OFFSITE_BACKUP_RECEIPT=false` until the Windows task has completed
and the VPS contains
`/var/lib/colorado-traffic-tracker/backups/offsite-last-success`. Then change it
to `true` and run the service once. The 192-hour limit is the seven-day backup
interval plus one full day of grace.

Install the timer:

```bash
cd /opt/colorado-traffic-tracker
chmod +x scripts/server-health-check.sh scripts/server-health-report.sh
cp deploy/systemd/colorado-traffic-tracker-health-check.service /etc/systemd/system/
cp deploy/systemd/colorado-traffic-tracker-health-check.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now colorado-traffic-tracker-health-check.timer
systemctl start colorado-traffic-tracker-health-check.service
systemctl status colorado-traffic-tracker-health-check.service
systemctl list-timers colorado-traffic-tracker-health-check.timer
```

The timer runs at approximately 04:15 and 16:15 in the VPS timezone with up to
15 minutes of random delay. `Persistent=true` runs one missed check after the
server comes back online.

## Evaluated conditions

The public operational-status endpoint supplies the application reasons. It
checks actual successful sample times, not whether the speed values changed.
Normal I-70 repetition can therefore remain healthy.

| Check | Healthy | Failure result |
| --- | --- | --- |
| Public site | Operational-status response is reachable | `SITE_UNREACHABLE` with the connection error |
| I-25 flow | Latest usable sample is at most 60 minutes old | `FLOW_SAMPLE_MISSING` or `FLOW_SAMPLE_STALE` |
| I-70 flow | Latest usable sample is at most 60 minutes old | `FLOW_SAMPLE_MISSING` or `FLOW_SAMPLE_STALE` |
| CDOT incidents | Oldest current corridor `incidentFetchedAt` is at most 60 minutes old | `CDOT_SNAPSHOT_MISSING` or `CDOT_SNAPSHOT_STALE` |
| TomTom provider | Guard report is current and has no actionable provider failure | The guard's exact failure code and message |
| TomTom capacity | At least one account is usable and projected combined use stays below the combined target | `TOMTOM_QUOTA_DEGRADED` or `TOMTOM_QUOTA_OUT_OF_SERVICE`, with quota details |
| Disk | More than 10 GB available and usage below 90% | `DISK_WARNING` at 10 GB available or less; `DISK_CRITICAL` at 90% usage |
| Windows backup | The newest backup named by a verified receipt is no more than 192 hours old, when enabled | `OFFSITE_BACKUP_MISSING`, `OFFSITE_BACKUP_RECEIPT_INVALID`, or `OFFSITE_BACKUP_STALE` |

A primary account reaching its planned limit is not a quota failure when the
secondary account can finish the month. Likewise, repeated usable traffic
values do not indicate an outage. `OUT_OF_SERVICE` on the public status is
reserved for loss of recent usable flow across every monitored corridor or an
unreadable database.

CDOT freshness deliberately uses the time this application fetched the
snapshot. An event's upstream `sourceUpdatedAt` may remain old simply because
the event has not changed and is not a liveness signal.

### Historical data and disk headroom

The VPS keeps historical traffic data in its database for long-term views and
future forecasting. `TRAFFIC_RETENTION_DAYS=30` moves older samples into archive
tables; it is not a 30-day history expiry. The `traffic_sample_all` view combines
current and archived samples, and the history API queries that view. Analytics
also include archived samples. Keep this archiving job enabled.

`DISK_WARN_FREE_GB=10` measures available filesystem space in decimal GB
(1 GB = 1,000,000,000 bytes). It replaces the former `DISK_WARN_PERCENT` setting.
On an existing VPS, replace that setting in the private `healthchecks.env` file;
no application restart is needed. The root filesystem currently holds both the
database volume and server backups. Update `DISK_PATH` if database storage moves.

At or below 10 GB available, the next twice-daily check sends a failure heartbeat
through the existing Healthchecks notification integration, including available
space and a suggested action. This is an intervention warning, not an enforced
space reservation: ingestion continues and this check never deletes traffic
history. Notifications can lag the threshold crossing by roughly 12 hours plus
timer jitter. Before space runs out, expand storage or review logs, unused images,
and redundant backup files. Do not automatically prune database history.

The separate 13-copy server backup policy limits recovery-file duplication; it
does not limit queryable history. Windows retains its completed backup copies
indefinitely. Disk alerts concern total filesystem use, not only database size.

Retention supplies the dataset, but does not by itself add annual charts or a
historical forecasting model. Analytics currently accept up to 8,760 hours;
trend responses are capped at 1,000 hourly points. Longer chart views should use
daily or weekly aggregates, and forecasting should account for provider/cadence
changes and missing observations. Those are separate application changes.

## Verify reporting

First confirm the normal run appears as a successful event in Healthchecks.io:

```bash
systemctl start colorado-traffic-tracker-health-check.service
journalctl -u colorado-traffic-tracker-health-check.service -n 50 --no-pager
```

Do not send a deliberate failure unless the owner specifically authorizes it.
If authorized, the alert path can be tested without changing application
settings:

```bash
set -a
. /etc/colorado-traffic-tracker/healthchecks.env
set +a
curl -fsS --data-binary 'Manual alert-path test; no service failure.' "${HEALTHCHECKS_PING_URL%/}/fail"
systemctl start colorado-traffic-tracker-health-check.service
```

Confirm the selected integration reports the down transition and the following
healthy run reports recovery. One intentional test is enough.

## Routine review

The task is designed to need little attention. When an alert arrives, read the
attached reason before acting:

```bash
journalctl -u colorado-traffic-tracker-health-check.service -n 100 --no-pager
curl -fsS https://coloradotraffictracker.net/dashboard-api/system/operational-status
curl -fsS http://127.0.0.1:8082/actuator/health/quotaPressure
```

If the alert is about backup age, follow
[Windows off-site database backups](windows-offsite-backups.md). If the ping is
simply missing, check the timer, outbound HTTPS, and whether the VPS itself is
online.
