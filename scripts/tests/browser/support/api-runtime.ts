import {spawn, spawnSync, ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
const output = path.resolve(__dirname, '../api-test-results');
const image = 'postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab';
function run(command: string, args: string[], input?: string): string {
  const result = spawnSync(command, args, {cwd: root, encoding: 'utf8', input, timeout: 120_000, maxBuffer: 4 * 1024 * 1024});
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error}`);
  return result.stdout.trim();
}
async function port(): Promise<number> {
  const socket = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => socket.once('listening', resolve));
  const value = (socket.address() as {port: number}).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return value;
}
async function ready(url: string, child: ChildProcess) {
  const end = Date.now() + 90_000;
  while (Date.now() < end) {
    if (!child.pid || child.exitCode !== null) throw new Error(`Application exited before readiness at ${url}; inspect startup logs`);
    try { if ((await fetch(url, {signal: AbortSignal.timeout(1000)})).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Application did not become ready at ${url}; inspect startup logs`);
}

export default async function setup() {
  fs.mkdirSync(output, {recursive: true});
  const runtime = path.resolve(process.env.BROWSER_RUNTIME_DIR || path.join(root, 'browser-runtime'));
  run('python3', ['scripts/ci/browser_runtime.py', 'verify', runtime]);
  const children: ChildProcess[] = [];
  const streams: fs.WriteStream[] = [];
  let container = '';
  const containerName = 'ctt-browser-' + randomUUID();
  const cleanup = async () => {
    for (const child of children.reverse()) {
      if (child.pid && child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => {child.kill('SIGKILL'); resolve();}, 5000);
          child.once('exit', () => {clearTimeout(timer); resolve();});
        });
      }
    }
    for (const stream of streams) stream.end();
    if (container) run('docker', ['rm', '-fv', container]);
  };
  try {
    container = containerName;
    container = run('docker', ['run', '--detach', '--name', containerName, '--memory', '768m', '--cpus', '1', '--pids-limit', '128', '--label', 'io.coloradotraffictracker.fixture=browser-api',
      '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', image, 'postgres', '-c', 'shared_buffers=16MB', '-c', 'max_connections=30']);
    if (!/^[0-9a-f]{64}$/.test(container)) throw new Error('Invalid disposable database container identity');
    run('docker', ['exec', container, 'sh', '-c', 'for attempt in $(seq 1 60); do pg_isready -U postgres >/dev/null 2>&1 && exit 0; sleep 0.5; done; exit 1']);
    const mapping = run('docker', ['port', container, '5432']);
    const databasePort = mapping.match(/:(\d+)$/)?.[1];
    if (!databasePort) throw new Error('Disposable database loopback port missing');
    const routesPort = await port(), apiPort = await port();
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
    function start(service: string, env: NodeJS.ProcessEnv) {
      const stream = fs.createWriteStream(path.join(output, service + '.log'));
      streams.push(stream);
      const child = spawn(java, ['-Xmx512m', '-jar', path.join(runtime, service + '.jar')], {
        cwd: root, env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.on('error', error => stream.write(String(error)));
      child.stdout?.pipe(stream); child.stderr?.pipe(stream); children.push(child);
      return child;
    }
    const routes = start('routes-service', {SERVER_PORT: String(routesPort)});
    await ready(`http://127.0.0.1:${routesPort}/actuator/health/readiness`, routes);
    const api = start('api-service', {
      SERVER_PORT: String(apiPort), SPRING_DATASOURCE_URL: `jdbc:postgresql://127.0.0.1:${databasePort}/postgres`,
      SPRING_DATASOURCE_USERNAME: 'postgres', SPRING_DATASOURCE_PASSWORD: '',
      ROUTES_BASE_URL: `http://127.0.0.1:${routesPort}`, DASHBOARD_PUBLIC_DATA_ENABLED: 'true',
      API_SECURITY_ENABLED: 'true', API_SECURITY_KEYS: 'browser-fixture-key',
      API_RATE_LIMIT_REQUESTS_PER_MINUTE: '10000', DASHBOARD_TRACESTRACK_API_KEY: '',
    });
    await ready(`http://127.0.0.1:${apiPort}/actuator/health/readiness`, api);
    run('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], `
      insert into traffic_sample(corridor,avg_current_speed,avg_freeflow_speed,min_current_speed,confidence,polled_at,source_mode,speed_sample_count)
      select corridor,case when corridor='I25' then 61 else 54 end,70,45,0.95,
        date_trunc('minute',now())-make_interval(mins=>n),'point',8
      from (values('I25'),('I70')) corridors(corridor) cross join generate_series(0,120) n;
      insert into traffic_sample_archive(source_id,corridor,avg_current_speed,avg_freeflow_speed,polled_at,archived_at,source_mode,confidence,speed_sample_count)
      select 910000+row_number() over(),corridor,case when corridor='I25' then 61 else 54 end,70,
        date_trunc('minute',now())-make_interval(hours=>n),now(),'point',0.95,8
      from (values('I25'),('I70')) corridors(corridor) cross join generate_series(3,72) n;
      insert into traffic_sample_archive(source_id,corridor,avg_current_speed,avg_freeflow_speed,polled_at,archived_at,source_mode)
      values(900001,'I25',47,70,now()-interval '40 days',now(),'point');
    `);
    process.env.BROWSER_API_URL = `http://127.0.0.1:${apiPort}`;
    fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify({revision: process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD']), url: process.env.BROWSER_API_URL, synthetic: true}, null, 2));
    return cleanup;
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) {console.error(cleanupError);}
    throw error;
  }
}
