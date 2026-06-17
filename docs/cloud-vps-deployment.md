# Cloud VPS Deployment

This is the recommended path for hosting Colorado Traffic Tracker online without
using your own computer. It keeps the repo's normal Docker Compose shape: one VPS
runs PostgreSQL/TimescaleDB, `routes-service`, `ingest-service`, and `api-service`;
Caddy terminates HTTPS and proxies public traffic to the dashboard/API.

## Recommendation

Use a single VPS first.

Best value pick: Hetzner Cloud `CX33` in Germany/Finland if that region is fine
for you. It has 4 vCPU, 8 GB RAM, and 80 GB SSD, which gives this stack real
headroom. Hetzner's June 2026 price-adjustment table lists the Germany/Finland
`CX33` at `$9.99/month` after the adjustment, excluding IPv4. The U.S. Hetzner
plans are much more expensive after the adjustment, so DigitalOcean is simpler
if you specifically want a U.S.-hosted VPS.

U.S.-friendly pick: DigitalOcean Basic/Premium Droplet with 8 GB RAM. DigitalOcean
shows 8 GiB memory / 160 GiB storage / 5,000 GiB bandwidth at `$48/month`.

Avoid free PaaS for this app. Render and Railway are nice for smaller web apps,
but this repository needs multiple always-on services plus a database and
continuous ingest. Render's free docs explicitly say free instances are not for
production, and Railway's free plan is limited to 0.5 GB RAM per service after
trial, which is too small for this stack.

References:

- Hetzner price adjustment table: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner cloud specs page: https://www.hetzner.com/cloud-made-in-germany
- DigitalOcean Droplets: https://www.digitalocean.com/products/droplets
- Render free instance limitations: https://render.com/docs/free
- Railway pricing and limits: https://railway.com/pricing
- Docker Engine on Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- Caddy install docs: https://caddyserver.com/docs/install
- Caddy reverse proxy quick start: https://caddyserver.com/docs/quick-starts/reverse-proxy

## Target Architecture

```text
internet
  |
  v
Caddy :443 / :80
  |
  v
api-service :8080 on 127.0.0.1
  |
  +--> static dashboard
  +--> dashboard/API endpoints
  +--> PostgreSQL/TimescaleDB on Docker network

ingest-service polls TomTom and writes to PostgreSQL.
routes-service serves corridor metadata to ingest-service.
```

Only Caddy is public. Compose binds the application and database ports to
`127.0.0.1` through `.env.cloud`.

## 1. Create The Server

Recommended baseline:

- Ubuntu 24.04 LTS
- 8 GB RAM
- 80 GB or larger SSD
- SSH key login
- Firewall allowing only `22`, `80`, and `443`

Create DNS:

```text
traffic.example.com A <server-ipv4>
```

Wait for DNS to resolve before asking Caddy to issue HTTPS certificates.

## 2. Install Dependencies

SSH in:

```bash
ssh root@traffic.example.com
```

Install base tools:

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git ufw
```

Install Docker using Docker's official Ubuntu repository:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker run --rm hello-world
```

Install Caddy using the current official Caddy package instructions:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Enable a simple firewall:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## 3. Install The App

```bash
mkdir -p /opt/colorado-traffic-tracker
git clone https://github.com/brentjColoS/ColoradoTrafficTracker.git /opt/colorado-traffic-tracker
cd /opt/colorado-traffic-tracker
cp .env.cloud.example .env.cloud
nano .env.cloud
```

Required edits:

- `TOMTOM_API_KEY`
- `API_SECURITY_KEYS`
- `POSTGRES_PASSWORD`

Keep `HOST_BIND_ADDRESS=127.0.0.1` so only Caddy is public.

Start the Compose stack:

```bash
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud up -d --build
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud ps
```

Verify locally on the VPS:

```bash
curl http://127.0.0.1:8080/actuator/health
curl http://127.0.0.1:8080/api/traffic/health
curl http://127.0.0.1:8080/dashboard-api/system/provider-status
```

## 4. Configure HTTPS

Copy the example and edit the domain:

```bash
cp deploy/caddy/Caddyfile.example /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Open:

```text
https://traffic.example.com/dashboard/
```

## 5. Enable Boot Startup

```bash
cp deploy/systemd/colorado-traffic-tracker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now colorado-traffic-tracker.service
systemctl status colorado-traffic-tracker.service
```

## 6. Day-Two Commands

Status:

```bash
cd /opt/colorado-traffic-tracker
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud ps
docker stats
```

Logs:

```bash
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud logs -f --tail=200
```

Snapshot/repair helpers:

```bash
./scripts/local-recovery-drill.sh status .env.cloud
./scripts/local-recovery-drill.sh snapshot .env.cloud
./scripts/local-recovery-drill.sh repair .env.cloud
```

Update:

```bash
cd /opt/colorado-traffic-tracker
git pull
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud up -d --build
```

Backup:

```bash
mkdir -p backups
APP_ENV_FILE=.env.cloud docker compose --env-file .env.cloud exec -T db \
  pg_dump -U traffic traffic | gzip > "backups/traffic-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

Stop:

```bash
systemctl stop colorado-traffic-tracker.service
```

Destroying the server or running `docker compose down -v` deletes data unless
you have a backup.
