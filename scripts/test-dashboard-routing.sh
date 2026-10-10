#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_BIN="${DOCKER_BIN:-docker}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2-alpine}"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/ctt-dashboard-routing.XXXXXX")"
network="ctt-dashboard-routing-$$-$RANDOM"
containers=()
cleanup() {
  for container in "${containers[@]}"; do "$DOCKER_BIN" rm -fv "$container" >/dev/null 2>&1 || true; done
  "$DOCKER_BIN" network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$test_root"
}
trap cleanup EXIT

cat > "$test_root/respond.sh" <<'EOF'
#!/bin/sh
IFS= read -r request
while IFS= read -r header; do
  [ "$header" = "$(printf '\r')" ] && break
done
case "$request" in
  *service-failure*) code='503 Service Unavailable' ;;
  *) code='200 OK' ;;
esac
body="$FIXTURE_NAME $request"
printf 'HTTP/1.1 %s\r\nContent-Type: text/plain\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' "$code" "${#body}" "$body"
EOF
chmod +x "$test_root/respond.sh"
sed -e 's/traffic.example.com {/http:\/\/:8099 {/' \
  -e 's/127.0.0.1:8080/primary:8080/g' \
  -e 's/127.0.0.1:8083/experimental:8080/g' \
  -e 's/127.0.0.1:8084/old:8080/g' \
  "$ROOT_DIR/deploy/caddy/Caddyfile.example" > "$test_root/Caddyfile"

"$DOCKER_BIN" network create "$network" >/dev/null
fixture() {
  local name="$network-$1"
  containers+=("$name")
  "$DOCKER_BIN" run -d --name "$name" --network "$network" --network-alias "$1" \
    --read-only -v "$test_root/respond.sh:/srv/respond.sh:ro" -e "FIXTURE_NAME=$1" \
    --entrypoint busybox "$CADDY_IMAGE" nc -lk -p 8080 -e /srv/respond.sh >/dev/null
}
fixture primary
proxy="$network-proxy"
containers+=("$proxy")
"$DOCKER_BIN" run -d --name "$proxy" --network "$network" \
  -p 127.0.0.1::8099 -v "$test_root/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$CADDY_IMAGE" caddy run --config /etc/caddy/Caddyfile >/dev/null
origin="http://$("$DOCKER_BIN" port "$proxy" 8099)"
ready=false
for _ in {1..30}; do
  if curl -fsS --max-time 2 "$origin/dashboard/" >/dev/null 2>&1; then ready=true;break;fi
  sleep 0.2
done
[[ "$ready" == true ]] || { "$DOCKER_BIN" logs "$proxy" >&2; exit 1; }

request() {
  status="$(curl -sS --max-time 8 -D "$test_root/headers" -o "$test_root/body" -w '%{http_code}' "$origin$1")"
  [[ "$status" == "$2" ]] || { cat "$test_root/body" >&2;printf 'Unexpected status %s for %s\n' "$status" "$1" >&2;exit 1; }
}
request / 308
grep -Fiq 'Location: /dashboard/' "$test_root/headers"
for variant in old experimental; do
  request "/dashboard-$variant" 308
  for path in "/dashboard-$variant/" "/dashboard-$variant-api/traffic/history" "/dashboard-$variant-health"; do
    request "$path" 404
    grep -Fiq 'X-Robots-Tag: noindex, nofollow' "$test_root/headers"
  done
  fixture "$variant"
  request "/dashboard-$variant/dashboard.js" 200
  grep -Fq "$variant GET /dashboard/dashboard.js" "$test_root/body"
  request "/dashboard-$variant-api/traffic/history?label=/dashboard-$variant/test" 200
  grep -Fq "$variant GET /dashboard-api/traffic/history?label=/dashboard-$variant/test" "$test_root/body"
  request "/dashboard-$variant-health" 200
  grep -Fq "$variant GET /actuator/health" "$test_root/body"
  request "/dashboard-$variant-api/service-failure" 503
done
request /dashboard/dashboard.js 200
grep -Fq 'primary GET /dashboard/dashboard.js' "$test_root/body"
if grep -Fiq 'X-Robots-Tag:' "$test_root/headers"; then exit 1; fi
request /dashboard-oldish/ 200
grep -Fq 'primary GET /dashboard-oldish/' "$test_root/body"
"$DOCKER_BIN" stop "$network-primary" >/dev/null
request /dashboard/ 502
if grep -Fiq 'X-Robots-Tag:' "$test_root/headers"; then exit 1; fi
printf '[test-dashboard-routing] ok\n'
