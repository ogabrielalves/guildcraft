import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentView } from '../../shared/agent.js';
import { TOKEN_HEADER } from '../../shared/constants.js';
import type { AppOptions } from './app.js';
import { createApp } from './app.js';
import type { FsDeps } from './routes/fs.js';
import { defaultFsDeps } from './routes/fs.js';
import { waitTimeout } from './routes/hooks.js';

const TOKEN = 'secret';

const VIEW: AgentView = {
  id: 'b1',
  name: 'Corvin',
  cwd: '/repo/web',
  skin: 'corvin',
  status: 'tool',
  permissionMode: 'default',
  tool: { name: 'Edit', detail: 'App.tsx' },
  waitingFor: null,
  model: null,
  effort: null,
  queued: 2,
};

let root: string;
let server: Server;
let base: string;
let manager: {
  hook: ReturnType<typeof vi.fn>;
  openPermission: ReturnType<typeof vi.fn>;
  waitPermission: ReturnType<typeof vi.fn>;
  others: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
};

async function start(overrides: Partial<AppOptions> = {}) {
  const app = createApp({
    manager,
    token: TOKEN,
    fs: defaultFsDeps(),
    webDir: join(root, 'web'),
    assetsDir: join(root, 'assets'),
    ...overrides,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function request(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set(TOKEN_HEADER, token);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guildcraft-http-'));
  await mkdir(join(root, 'web'));
  await mkdir(join(root, 'assets', 'maps'), { recursive: true });
  await writeFile(join(root, 'web', 'index.html'), '<title>Guildcraft</title>');
  await writeFile(join(root, 'assets', 'maps', 'workshop.json'), '{"ok":true}');
  manager = {
    hook: vi.fn(() => ({ ok: true, value: undefined })),
    openPermission: vi.fn(() => ({ ok: true, value: { ok: true, id: 'p1', expiresAt: 9 } })),
    waitPermission: vi.fn(() => Promise.resolve({ status: 'pending' })),
    others: vi.fn(() => ({ ok: true, value: [VIEW] })),
    sendMessage: vi.fn(() => ({ ok: true, value: { queued: 1, busy: false } })),
  };
  await start();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

describe('static files', () => {
  it('serves the web build and assets without a token', async () => {
    expect(await (await fetch(`${base}/`)).text()).toContain('Guildcraft');
    expect(await (await fetch(`${base}/assets/maps/workshop.json`)).json()).toEqual({ ok: true });
  });

  it('returns 404 for missing assets', async () => {
    expect((await fetch(`${base}/assets/nope.png`)).status).toBe(404);
  });

  it('works without a web build', async () => {
    await new Promise((resolve) => server.close(resolve));
    await start({ webDir: null });
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it('hides the framework header', async () => {
    expect((await fetch(`${base}/`)).headers.get('x-powered-by')).toBeNull();
  });
});

describe('hardening', () => {
  function withHost(host: string): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}/`, { headers: { host } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('rejects requests for a foreign host such as a rebound domain', async () => {
    expect(await withHost('evil.test')).toBe(403);
    expect(await withHost('localhost:5173')).toBe(200);
  });

  it('sends security headers', async () => {
    const { headers } = await fetch(`${base}/`);
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
  });
});

describe('auth', () => {
  it.each([
    ['POST', '/hook/a1/Stop'],
    ['GET', '/api/a1/villagers'],
    ['POST', '/api/a1/messages'],
    ['POST', '/api/fs/pick'],
  ])('rejects %s %s without the token', async (method, path) => {
    const response = await request(path, { method }, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED' });
  });

  it('rejects a wrong token', async () => {
    expect((await request('/api/fs/pick', { method: 'POST' }, 'nope')).status).toBe(401);
    expect(manager.others).not.toHaveBeenCalled();
  });
});

describe('hooks', () => {
  it('forwards the hook payload to the manager', async () => {
    const body = JSON.stringify({ tool_name: 'Bash' });
    const response = await request('/hook/a1/PreToolUse', { method: 'POST', body });
    expect(response.status).toBe(204);
    expect(manager.hook).toHaveBeenCalledWith('a1', 'PreToolUse', { tool_name: 'Bash' });
  });

  it('rejects unknown events', async () => {
    const response = await request('/hook/a1/Explode', { method: 'POST', body: '{}' });
    expect(response.status).toBe(400);
    expect(manager.hook).not.toHaveBeenCalled();
  });

  it('maps manager errors to http status', async () => {
    manager.hook.mockReturnValue({ ok: false, code: 'AGENT_NOT_FOUND' });
    const response = await request('/hook/x/Stop', { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'AGENT_NOT_FOUND' });
  });

  it('rejects malformed json', async () => {
    expect((await request('/hook/a1/Stop', { method: 'POST', body: '{oops' })).status).toBe(400);
  });

  it('rejects oversized bodies', async () => {
    const body = JSON.stringify({ message: 'x'.repeat(1_100_000) });
    expect((await request('/hook/a1/Stop', { method: 'POST', body })).status).toBe(413);
  });
});

describe('permission hooks', () => {
  it('opens a request', async () => {
    const body = JSON.stringify({ tool_name: 'Bash' });
    const response = await request('/hook/a1/permission', { method: 'POST', body });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'p1', expiresAt: 9 });
    expect(manager.openPermission).toHaveBeenCalledWith('a1', { tool_name: 'Bash' });
    expect(manager.hook).not.toHaveBeenCalled();
  });

  it('tells the hook to skip', async () => {
    manager.openPermission.mockReturnValue({ ok: true, value: { ok: false, skip: 'no-viewers' } });
    const response = await request('/hook/a1/permission', { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skip: 'no-viewers' });
  });

  it('maps open failures to http status', async () => {
    manager.openPermission.mockReturnValue({ ok: false, code: 'AGENT_NOT_FOUND' });
    const response = await request('/hook/x/permission', { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
  });

  it('long-polls for the decision with a capped timeout', async () => {
    manager.waitPermission.mockResolvedValue({
      status: 'decided',
      decision: { behavior: 'allow' },
    });
    const response = await request('/hook/a1/permission/p1?timeout=99');
    expect(await response.json()).toEqual({ status: 'decided', decision: { behavior: 'allow' } });
    expect(manager.waitPermission).toHaveBeenCalledWith('a1', 'p1', 25_000);
  });

  it('returns 404 for an unknown request', async () => {
    manager.waitPermission.mockReturnValue(null);
    const response = await request('/hook/a1/permission/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'PERMISSION_NOT_FOUND' });
  });
});

describe('waitTimeout', () => {
  it.each([
    ['5', 5_000],
    ['0.5', 500],
    ['99', 25_000],
    ['0', 25_000],
    ['x', 25_000],
    [undefined, 25_000],
  ])('turns %s seconds into %d ms', (raw, ms) => {
    expect(waitTimeout(raw)).toBe(ms);
  });
});

describe('villagers', () => {
  it('lists the other agents for the mcp tool', async () => {
    const response = await request('/api/a1/villagers');
    expect(manager.others).toHaveBeenCalledWith('a1');
    expect(await response.json()).toEqual([
      { name: 'Corvin', cwd: '/repo/web', status: 'tool', doing: 'Edit: App.tsx', queued: 2 },
    ]);
  });

  it('reports idle villagers as doing nothing', async () => {
    manager.others.mockReturnValue({ ok: true, value: [{ ...VIEW, status: 'idle', tool: null }] });
    expect(await (await request('/api/a1/villagers')).json()).toMatchObject([{ doing: null }]);
  });

  it('returns 404 for an unknown caller', async () => {
    manager.others.mockReturnValue({ ok: false, code: 'AGENT_NOT_FOUND' });
    const response = await request('/api/x/villagers');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'AGENT_NOT_FOUND' });
  });

  it('sends messages', async () => {
    const body = JSON.stringify({ to: 'Corvin', message: 'api ready' });
    const response = await request('/api/a1/messages', { method: 'POST', body });
    expect(await response.json()).toEqual({ queued: 1, busy: false });
    expect(manager.sendMessage).toHaveBeenCalledWith('a1', 'Corvin', 'api ready');
  });

  it.each([{}, { to: 'Corvin' }, { to: 1, message: 'x' }])('rejects body %j', async (payload) => {
    const response = await request('/api/a1/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'INVALID_MESSAGE' });
  });

  it.each([
    ['QUEUE_FULL', 429],
    ['AGENT_OFFLINE', 409],
    ['EMPTY_PROMPT', 400],
  ])('maps %s to %i', async (code, status) => {
    manager.sendMessage.mockReturnValue({ ok: false, code });
    const body = JSON.stringify({ to: 'Corvin', message: 'x' });
    expect((await request('/api/a1/messages', { method: 'POST', body })).status).toBe(status);
  });
});

describe('fs', () => {
  const pick = (body: unknown, overrides: Partial<FsDeps> = {}) =>
    start({ fs: { ...defaultFsDeps(), ...overrides } }).then(() =>
      request('/api/fs/pick', { method: 'POST', body: JSON.stringify(body) }),
    );

  it('returns the folder chosen in the native dialog', async () => {
    const pickFolder = vi.fn(() => Promise.resolve(root));
    const response = await pick({ path: join(root, 'web') }, { pickFolder });
    expect(await response.json()).toEqual({ path: root });
    expect(pickFolder).toHaveBeenCalledWith(join(root, 'web'));
  });

  it('opens the dialog without a start folder when the path is not a folder', async () => {
    const pickFolder = vi.fn(() => Promise.resolve(null));
    const response = await pick({ path: join(root, 'nope') }, { pickFolder });
    expect(await response.json()).toEqual({ path: null });
    expect(pickFolder).toHaveBeenCalledWith(null);
  });

  it('ignores a selection that is not a folder', async () => {
    const response = await pick({}, { pickFolder: () => Promise.resolve(join(root, 'nope')) });
    expect(await response.json()).toEqual({ path: null });
  });

  it('reports a missing native dialog', async () => {
    const response = await pick({}, { pickFolder: () => Promise.reject(new Error('none')) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'SPAWN_FAILED' });
  });
});
