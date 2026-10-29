import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 7787;
const BOOT_TIMEOUT_MS = 20_000;

const tarball = resolve(process.argv[2] ?? '');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'guildcraft-package-'));

function run(command) {
  return execSync(command, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function boot() {
  const cli = join(dir, 'node_modules', 'guildcraft', 'dist', 'bin', 'cli.js');
  const args = ['--no-open', '--port', String(PORT), '--claude-bin', process.execPath];
  const server = spawn(process.execPath, [cli, ...args, '--data-dir', join(dir, 'data')], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('the server did not start')), BOOT_TIMEOUT_MS);
    server.on('exit', (code) => fail(new Error(`the server exited with ${code}`)));
    server.stdout.on('data', (data) => {
      if (!String(data).includes('is running on')) return;
      clearTimeout(timer);
      done();
    });
  });
  return { server, ready };
}

const { server, ready } = (() => {
  writeFileSync(join(dir, 'package.json'), '{ "private": true }');
  run(`npm install --no-audit --no-fund "${tarball}"`);
  const installed = run('npx --no-install guildcraft --version').trim();
  check(installed === version, `expected version ${version}, got ${installed}`);
  return boot();
})();

try {
  await ready;
  const page = await fetch(`http://127.0.0.1:${PORT}/`);
  check(page.ok, `the web app answered ${page.status}`);
  check((await page.text()).includes('<script'), 'the web app is missing its bundle');
  console.log(`guildcraft ${version} installs, runs and serves the web app`);
} finally {
  server.removeAllListeners('exit');
  server.kill();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
