#!/usr/bin/env node
import { createRequire } from 'node:module';
import { runCli } from '../server/cli.js';
import { defaultDataDir } from '../server/config.js';
import { startServer } from '../server/index.js';
import { openBrowser } from '../server/platform/open-browser.js';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const code = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  nodeVersion: process.version,
  version,
  defaultDataDir: defaultDataDir(),
  start: (config) => startServer(config),
  open: openBrowser,
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
if (code !== null) process.exit(code);
