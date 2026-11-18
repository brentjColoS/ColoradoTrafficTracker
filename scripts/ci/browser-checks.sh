#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mode="${1:-ui}"
[[ $# == 0 ]] || shift
case "$mode" in ui|api|visual|update-visual) ;; *) echo 'Use ui, api, visual or update-visual.' >&2; exit 2 ;; esac
image='mcr.microsoft.com/playwright:v1.65.0-noble@sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d'
browser="$ROOT_DIR/scripts/tests/browser"
version="$(node -p 'require(process.argv[1]).version' "$browser/node_modules/@playwright/test/package.json")"
[[ "$image" == *":v$version-noble@sha256:"* ]] || {
  echo 'Playwright package and pinned browser image differ; update and review them together.' >&2; exit 1;
}
node_args=(--entrypoint node)
if [[ "$(uname -s)" == Linux ]]; then
  node_args=(-v "$(dirname "$(command -v node)"):/opt/ctt-node:ro" --entrypoint /opt/ctt-node/node)
fi
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image"
if [[ "$mode" != api ]]; then
  args=(--project=chromium --project=mobile-chromium)
  if [[ "$mode" != ui ]]; then
    args=(--project=chromium --grep 'reviewed visual layout')
    [[ "$mode" != update-visual ]] || args+=(--update-snapshots)
  fi
  exec docker run --rm --init --ipc=host -e CI=1 \
    -v "$ROOT_DIR:/work" -w /work/scripts/tests/browser "${node_args[@]}" "$image" \
    node_modules/@playwright/test/cli.js test "${args[@]}" "$@"
fi

python3 --version >/dev/null
name="ctt-browser-server-$(node -p 'crypto.randomUUID()')"
cleanup() {
  result=$?
  trap - EXIT
  trap '' INT TERM
  python3 - "$name" "$browser/api-test-results" "$result" <<'PY'
from pathlib import Path
import re
import subprocess
import sys

name, output, status = sys.argv[1:]
status = int(status)
def owned():
    identity = subprocess.check_output(['docker', 'ps', '--all', '--quiet', '--no-trunc',
        '--filter', 'name=^/'+name+'$', '--filter', 'label=io.coloradotraffictracker.browser-owner='+name],
        text=True, timeout=10).strip()
    if identity and not re.fullmatch('[a-f0-9]{64}', identity):
        raise ValueError('Unexpected owned browser identity')
    return identity
try:
    identity = owned()
    if identity:
        try:
            Path(output).mkdir(parents=True, exist_ok=True)
            with (Path(output) / 'browser-server.log').open('w') as log:
                subprocess.run(['docker', 'logs', '--tail', '200', identity], stdout=log,
                    stderr=subprocess.STDOUT, timeout=10, check=True)
        except (OSError, subprocess.SubprocessError):
            print('Browser diagnostics unavailable for '+name, file=sys.stderr)
        try:
            removal_failed = subprocess.run(['docker', 'rm', '--force', identity], capture_output=True, timeout=10).returncode != 0
        except (OSError, subprocess.SubprocessError):
            removal_failed = True
        if removal_failed and owned():
            raise RuntimeError('Docker could not remove the owned browser')
except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
    print('Browser cleanup could not be confirmed for '+name+': '+str(error)+'. Inspect only this labelled container.', file=sys.stderr)
    status = status or 1
sys.exit(status)
PY
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
container="$(docker run --detach --rm --init --ipc=host --name "$name" \
  --label "io.coloradotraffictracker.browser-owner=$name" \
  --memory=1536m --cpus=2 --pids-limit=256 --publish 127.0.0.1::3000 \
  -v "$ROOT_DIR:/work:ro" -w /work/scripts/tests/browser "${node_args[@]}" "$image" \
  node_modules/playwright/cli.js run-server --host 0.0.0.0 --port 3000)"
[[ "$container" =~ ^[a-f0-9]{64}$ ]] || { echo 'Invalid owned browser container identity.' >&2; exit 1; }
mapping="$(docker port "$container" 3000)"
[[ "$mapping" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || { echo 'Browser server must be loopback-only.' >&2; exit 1; }
export CTT_BROWSER_WS_ENDPOINT="ws://$mapping/"
node - "$mapping" <<'JS'
const origin = 'http://' + process.argv[2];
(async () => {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try {
      const response = await fetch(origin + '/json', {signal: AbortSignal.timeout(1000)});
      if (response.ok && (await response.json()).wsEndpointPath === '/') return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Pinned browser server did not become ready within 15 seconds.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
JS
node "$browser/node_modules/@playwright/test/cli.js" test --config="$browser/playwright.api.config.ts" "$@"
