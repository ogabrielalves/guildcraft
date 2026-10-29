import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, ENV_PREFIX, TOKEN_QUERY } from '../shared/constants.js';
import type { ProcessHandle, SpawnSpec } from './agents/agent-manager.js';
import { AgentManager } from './agents/agent-manager.js';
import { writeAgentFiles } from './agents/agent-files.js';
import { AgentProcess } from './agents/agent-process.js';
import { AgentRegistry } from './agents/agent-registry.js';
import { listSkins } from './agents/skins.js';
import type { Config } from './config.js';
import { createApp } from './http/app.js';
import { defaultFsDeps, isDirectory } from './http/routes/fs.js';
import type { SignalSource } from './lifecycle.js';
import { Lifecycle } from './lifecycle.js';
import type { ClaudeCommand } from './platform/claude-binary.js';
import { findClaudeBinary } from './platform/claude-binary.js';
import { allowedOrigins, createToken, launchUrl } from './security.js';
import { AgentStore } from './store/agent-store.js';
import { Gateway } from './ws/gateway.js';

export const SHUTDOWN_TIMEOUT_MS = 10_000;
export const DEV_WEB_PORT = 5173;

const DROPPED_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];

export type BootErrorCode = 'CLAUDE_NOT_FOUND' | 'PORT_IN_USE';

export class BootError extends Error {
  constructor(
    readonly code: BootErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface BootDeps {
  rootDir: string;
  devMode: boolean;
  env: NodeJS.ProcessEnv;
  findClaude: (override: string | null) => ClaudeCommand | null;
  createProcess: (spec: SpawnSpec) => ProcessHandle;
  signals: SignalSource | null;
  exit: (code: number) => void;
  log: (message: string) => void;
  shutdownTimeoutMs: number;
}

export interface RunningServer {
  port: number;
  url: string;
  token: string;
  lifecycle: Lifecycle;
  stop: () => Promise<void>;
}

const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));

export function defaultBootDeps(): BootDeps {
  return {
    rootDir: ROOT_DIR,
    devMode: import.meta.url.endsWith('.ts'),
    env: process.env,
    findClaude: findClaudeBinary,
    createProcess: (spec) => new AgentProcess(spec),
    signals: process,
    exit: (code) => process.exit(code),
    log: (message) => {
      process.stderr.write(`${message}\n`);
    },
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  };
}

export function childEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || key.startsWith(ENV_PREFIX) || DROPPED_ENV.includes(key)) continue;
    result[key] = value;
  }
  return result;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new BootError('PORT_IN_USE', `port ${port} is already in use`)
          : error,
      );
    };
    server.once('error', onError);
    server.listen(port, DEFAULT_HOST, () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });
}

function withTimeout(task: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`shutdown took longer than ${ms} ms`));
    }, ms);
    timer.unref();
    task.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}

export async function startServer(
  config: Config,
  overrides: Partial<BootDeps> = {},
): Promise<RunningServer> {
  const deps = { ...defaultBootDeps(), ...overrides };
  const claude = deps.findClaude(config.claudeBin);
  if (!claude) throw new BootError('CLAUDE_NOT_FOUND', 'claude code executable not found');

  const assetsDir = join(deps.rootDir, 'assets');
  const webDir = join(deps.rootDir, 'dist', 'web');
  const scripts = join(deps.rootDir, 'dist', 'bin');
  const hookScript = join(scripts, 'hook.js');
  const mcpScript = join(scripts, 'mcp.js');
  if (!existsSync(hookScript)) deps.log(`warning: ${hookScript} is missing, run npm run build`);

  const server = createServer();
  const port = await listen(server, config.port);
  const token = createToken();
  const store = new AgentStore(config.dataDir);
  const skins = await listSkins(join(assetsDir, 'characters'));
  const skinSet = new Set(skins);
  let gateway: Gateway | null = null;

  const manager = new AgentManager({
    registry: new AgentRegistry(),
    saveAgents: (agents) => store.save(agents),
    writeFiles: (agent) =>
      writeAgentFiles(store.agentDir(agent.id), {
        nodePath: process.execPath,
        hookScript,
        mcpScript,
        port,
        agentId: agent.id,
      }),
    createProcess: deps.createProcess,
    isDirectory,
    hasSkin: (skin) => skinSet.has(skin),
    claude,
    baseEnv: childEnv(deps.env),
    token,
    port,
    emit: (message) => {
      gateway?.broadcast(message);
    },
  });

  const app = createApp({
    manager,
    token,
    fs: defaultFsDeps(),
    webDir: deps.devMode || !existsSync(webDir) ? null : webDir,
    assetsDir,
  });
  server.on('request', app);

  const origins = allowedOrigins(port);
  if (deps.devMode) origins.push(...allowedOrigins(DEV_WEB_PORT));

  const stop = async () => {
    await manager.shutdown();
    await gateway?.close();
    await closeServer(server);
  };
  const lifecycle = new Lifecycle({
    keepAlive: config.keepAlive,
    shutdown: () => withTimeout(stop(), deps.shutdownTimeoutMs),
    exit: deps.exit,
    log: deps.log,
  });
  gateway = new Gateway({
    server,
    manager,
    token,
    origins,
    skins: () => skins,
    onClientsChange: (count) => {
      lifecycle.clientsChanged(count);
    },
    log: deps.log,
  });
  if (deps.signals) lifecycle.watchSignals(deps.signals);

  await manager.restore(await store.load());

  const url = deps.devMode
    ? `http://localhost:${DEV_WEB_PORT}/?${TOKEN_QUERY}=${encodeURIComponent(token)}`
    : launchUrl(port, token);
  return { port, url, token, lifecycle, stop };
}
