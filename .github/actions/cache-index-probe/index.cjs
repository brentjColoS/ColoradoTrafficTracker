const { createHash } = require('node:crypto');

async function main() {
  const endpoint = process.env.ACTIONS_RESULTS_URL;
  const token = process.env.ACTIONS_RUNTIME_TOKEN;
  if (!endpoint || !token) throw new Error('Runtime cache service is unavailable');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const scope = hash('refs/heads/experiment/dashboard-reconstruction').slice(0, 8);
  const version = hash('|go-actionscache-1.0');
  for (const suffix of ['', '#']) {
    const key = `index-api-service-dependencies-v1-1-${scope}${suffix}`;
    const response = await fetch(new URL('twirp/github.actions.results.api.v1.CacheService/GetCacheEntryDownloadURL', endpoint), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, restore_keys: [key], version }),
    });
    if (!response.ok) throw new Error(`Cache metadata request returned ${response.status}`);
    const result = await response.json();
    console.log(JSON.stringify({ requested: key, found: result.ok, matched: result.matched_key }));
    if (!result.ok) continue;
    const archive = await fetch(result.signed_download_url);
    if (!archive.ok) throw new Error(`Cache index read returned ${archive.status}`);
    const index = await archive.json();
    console.log(JSON.stringify({
      matched: result.matched_key,
      layers: index.layers?.length,
      records: index.records?.map(record => ({ digest: record.digest, layers: record.layers, inputs: record.inputs })),
    }));
  }
}

main().catch(() => { console.error('Cache index probe failed; no credentials or signed URLs logged'); process.exitCode = 1; });
