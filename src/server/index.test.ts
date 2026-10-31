import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { TOKEN_HEADER } from '../shared/constants.js';
import type { ServerMessage } from '../shared/protocol.js';
import type { ProcessHandle, SpawnSpec } from './agents/agent-manager.js';
import type { Config } from './config.js';
import type { BootDeps, RunningServer } from './index.js';
import { BootError, DEV_WEB_PORT, childEnv, startServer } from './index.js';

class FakeProcess implements ProcessHandle {
  running = false;
  pid = null;
  constructor(
    readonly spec: SpawnSpec,
    private readonly hang: boolean,
  ) {}
  start() {
    this.running = true;
  }
  write = vi.fn();
  resize = vi.fn();
  snapshot() {
    return Promise.resolve('');
  }
  stop() {
    this.running = false;
    return this.hang ? new Promise<void>(() => undefined) : Promise.resolve();
  }
  dispose = vi.fn();
  onOutput() {
    return () => undefined;
  }
  onExit() {
    return () => undefined;
  }
}

let root: string;
let config: Config;
let spawned: FakeProcess[];
let hang: boolean;
let running: RunningServer[];
let logs: string[];

function deps(overrides: Partial<BootDeps> = {}): Partial<BootDeps> {
  return {
    rootDir: root,
    devMode: false,
    env: { PATH: '/bin', GUILDCRAFT_PORT: '1', CLAUDECODE: '1' },
    findClaude: () => ({ command: 'claude', args: [] }),
    createProcess: (spec) => {
      const process = new FakeProcess(spec, hang);
      spawned.push(process);
      return process;
    },
    signals: null,
    exit: vi.fn(),
    log: (message) => logs.push(message),
    shutdownTimeoutMs: 200,
    ...overrides,
  };
}

async function boot(overrides: Partial<BootDeps> = {}, configOverrides: Partial<Config> = {}) {
  const server = await startServer({ ...config, ...configOverrides }, deps(overrides));
  running.push(server);
  return server;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guildcraft-boot-'));
  await mkdir(join(root, 'assets', 'characters', 'oren'), { recursive: true });
  await writeFile(join(root, 'assets', 'characters', 'oren', 'oren.json'), '{}');
  await mkdir(join(root, 'dist', 'web'), { recursive: true });
  await writeFile(join(root, 'dist', 'web', 'index.html'), '<p>workshop</p>');
  config = {
    port: 0,
    open: false,
    claudeBin: null,
    dataDir: join(root, 'data'),
  };
  spawned = [];
  hang = false;
  running = [];
  logs = [];
});

afterEach(async () => {
  hang = false;
  for (const server of running) await server.stop().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe('startServer', () => {
  it('serves the web app and protects the api with the session token', async () => {
    const { port, token, url } = await boot();
    expect(url).toBe(`http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(await page.text()).toBe('<p>workshop</p>');
    const denied = await fetch(`http://127.0.0.1:${port}/api/fs/pick`, { method: 'POST' });
    expect(denied.status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${port}/api/unknown`, {
      method: 'POST',
      headers: { [TOKEN_HEADER]: token },
    });
    expect(allowed.status).toBe(404);
    expect(logs[0]).toContain('hook.js is missing');
  });

  it('greets websocket clients with the agents and skins', async () => {
    const { port, token } = await boot();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
      origin: `http://127.0.0.1:${port}`,
    });
    const first = await new Promise<ServerMessage>((resolve) => {
      socket.once('message', (data: Buffer) => {
        resolve(JSON.parse(data.toString()) as ServerMessage);
      });
    });
    expect(first).toEqual({
      type: 'session:init',
      agents: [],
      events: [],
      skins: ['oren'],
      permissions: [],
      activities: [],
    });
    socket.close();
  });

  it('restores saved agents with per-agent files and a clean environment', async () => {
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(
      join(config.dataDir, 'agents.json'),
      JSON.stringify([{ id: 'a1', name: 'Oren', cwd: root, skin: 'oren', permissionMode: 'plan' }]),
    );
    const { port, token } = await boot();
    expect(spawned).toHaveLength(1);
    const spec = spawned[0]?.spec;
    expect(spec?.cwd).toBe(root);
    expect(spec?.args).toContain('plan');
    expect(spec?.env).toMatchObject({
      PATH: '/bin',
      GUILDCRAFT_TOKEN: token,
      GUILDCRAFT_PORT: String(port),
      GUILDCRAFT_AGENT_ID: 'a1',
    });
    expect(spec?.env.CLAUDECODE).toBeUndefined();
    const settings = await readFile(join(config.dataDir, 'agents', 'a1', 'settings.json'), 'utf8');
    expect(settings).toContain(`${port} a1 Stop`);
  });

  it('accepts the vite origin and links to it in dev mode', async () => {
    const { port, token, url } = await boot({ devMode: true });
    expect(url).toBe(`http://localhost:${DEV_WEB_PORT}/?token=${encodeURIComponent(token)}`);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.status).toBe(404);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
      origin: `http://localhost:${DEV_WEB_PORT}`,
    });
    await new Promise((resolve) => socket.once('open', resolve));
    socket.close();
  });

  it('fails when claude code is missing', async () => {
    await expect(boot({ findClaude: () => null })).rejects.toMatchObject({
      code: 'CLAUDE_NOT_FOUND',
    });
  });

  it('fails when the port is taken', async () => {
    const { port } = await boot();
    const error: unknown = await boot({}, { port }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BootError);
    expect(error).toMatchObject({ code: 'PORT_IN_USE' });
  });

  it('exits cleanly through the lifecycle', async () => {
    const exit = vi.fn();
    const { lifecycle, port } = await boot({ exit });
    await lifecycle.stop('test');
    expect(exit).toHaveBeenCalledWith(0);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  it('gives up on a shutdown that hangs', async () => {
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(
      join(config.dataDir, 'agents.json'),
      JSON.stringify([
        { id: 'a1', name: 'Oren', cwd: root, skin: 'oren', permissionMode: 'default' },
      ]),
    );
    hang = true;
    const exit = vi.fn();
    const { lifecycle } = await boot({ exit });
    await lifecycle.stop('test');
    expect(exit).toHaveBeenCalledWith(1);
    expect(logs).toContain('shutdown failed: Error: shutdown took longer than 200 ms');
    running = [];
  });
});

describe('childEnv', () => {
  it('drops guildcraft and parent session variables but keeps claude config', () => {
    expect(
      childEnv({
        PATH: '/bin',
        GUILDCRAFT_TOKEN: 'x',
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_CODE_CHILD_SESSION: '1',
        CLAUDE_CODE_SESSION_ID: 's',
        CLAUDE_CODE_MESSAGING_TOKEN: 't',
        CLAUDE_PID: '42',
        CLAUDE_CODE_USE_BEDROCK: '1',
        ANTHROPIC_API_KEY: 'k',
        EMPTY: undefined,
      }),
    ).toEqual({ PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_API_KEY: 'k' });
  });
});
