import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { AgentView, VillageEvent } from '../../shared/agent.js';
import { UNAUTHORIZED_CLOSE_CODE } from '../../shared/constants.js';
import type { ServerMessage } from '../../shared/protocol.js';
import { allowedOrigins } from '../security.js';
import type { GatewayOptions } from './gateway.js';
import { Gateway, INTERNAL_ERROR_CLOSE_CODE } from './gateway.js';

const TOKEN = 'secret';

const VIEW: AgentView = {
  id: 'a1',
  name: 'Mortis',
  cwd: '/repo/api',
  skin: 'mortis',
  status: 'idle',
  permissionMode: 'default',
  tool: null,
  waitingFor: null,
  queued: 0,
};

const EVENT: VillageEvent = { kind: 'joined', agentId: 'a1', at: 1 };

let server: Server;
let port: number;
let gateway: Gateway;
let logs: string[];
let manager: {
  views: ReturnType<typeof vi.fn>;
  recentEvents: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  permissions: ReturnType<typeof vi.fn>;
  decidePermission: ReturnType<typeof vi.fn>;
  input: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  removeAll: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
  setSkin: ReturnType<typeof vi.fn>;
  sendPrompt: ReturnType<typeof vi.fn>;
};

async function start(overrides: Partial<GatewayOptions> = {}) {
  server = createServer((_req, res) => res.end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  gateway = new Gateway({
    server,
    manager,
    token: TOKEN,
    origins: allowedOrigins(port),
    skins: () => ['mortis', 'lyra'],
    log: (message) => logs.push(message),
    ...overrides,
  });
}

interface Connection {
  socket: WebSocket;
  messages: ServerMessage[];
  next: (count?: number) => Promise<ServerMessage[]>;
}

function connect({
  token = TOKEN,
  origin,
  path = '/ws',
  host,
}: { token?: string; origin?: string; path?: string; host?: string } = {}): Connection {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}?token=${token}`, {
    origin: origin ?? `http://127.0.0.1:${port}`,
    ...(host ? { headers: { host } } : {}),
  });
  const messages: ServerMessage[] = [];
  let waiter: (() => void) | null = null;
  socket.on('message', (data: Buffer) => {
    messages.push(JSON.parse(data.toString()) as ServerMessage);
    waiter?.();
  });
  let read = 0;
  const next = async (count = 1) => {
    const target = read + count;
    while (messages.length < target) {
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
    read = target;
    return messages.slice(target - count, target);
  };
  return { socket, messages, next };
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', resolve));
}

function failed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
    });
  });
}

beforeEach(() => {
  logs = [];
  const ok = { ok: true, value: undefined };
  manager = {
    views: vi.fn(() => [VIEW]),
    recentEvents: vi.fn(() => [EVENT]),
    snapshot: vi.fn(() => Promise.resolve('screen')),
    permissions: vi.fn(() => []),
    decidePermission: vi.fn(() => ok),
    input: vi.fn(() => ok),
    resize: vi.fn(() => ok),
    create: vi.fn(() => Promise.resolve({ ok: true, value: VIEW })),
    remove: vi.fn(() => Promise.resolve(ok)),
    removeAll: vi.fn(() => Promise.resolve()),
    restart: vi.fn(() => Promise.resolve(ok)),
    interrupt: vi.fn(() => ok),
    setSkin: vi.fn(() => Promise.resolve(ok)),
    sendPrompt: vi.fn(() => ({ ok: true, value: [] })),
  };
});

afterEach(async () => {
  await gateway.close();
  await new Promise((resolve) => server.close(resolve));
});

describe('gateway handshake', () => {
  it('sends the session and a snapshot per agent', async () => {
    await start();
    const { next } = connect();
    expect(await next(2)).toEqual([
      {
        type: 'session:init',
        agents: [VIEW],
        events: [EVENT],
        skins: ['mortis', 'lyra'],
        permissions: [],
      },
      { type: 'term:snapshot', agentId: 'a1', data: 'screen' },
    ]);
    expect(gateway.clientCount).toBe(1);
  });

  it('skips empty or failed snapshots', async () => {
    await start();
    manager.views.mockReturnValue([VIEW, { ...VIEW, id: 'b2' }, { ...VIEW, id: 'c3' }]);
    manager.snapshot
      .mockResolvedValueOnce('')
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValueOnce('third');
    const { next } = connect();
    const [init, snapshot] = await next(2);
    expect(init?.type).toBe('session:init');
    expect(snapshot).toEqual({ type: 'term:snapshot', agentId: 'c3', data: 'third' });
  });

  it('holds broadcasts until the snapshots are sent', async () => {
    await start();
    let release: (data: string) => void = () => undefined;
    manager.snapshot.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    const { next } = connect();
    const [init] = await next();
    expect(init?.type).toBe('session:init');
    gateway.broadcast({ type: 'term:output', agentId: 'a1', data: 'late' });
    release('screen');
    expect(await next(2)).toEqual([
      { type: 'term:snapshot', agentId: 'a1', data: 'screen' },
      { type: 'term:output', agentId: 'a1', data: 'late' },
    ]);
  });

  it('closes with the unauthorized code on a bad token', async () => {
    await start();
    const { socket } = connect({ token: 'wrong' });
    expect(await closed(socket)).toBe(UNAUTHORIZED_CLOSE_CODE);
    expect(gateway.clientCount).toBe(0);
  });

  it('rejects a foreign origin before the upgrade', async () => {
    await start();
    const { socket } = connect({ origin: 'http://evil.test' });
    expect(await failed(socket)).toBe(403);
    expect(logs).toEqual(['ws: rejected origin http://evil.test']);
  });

  it('rejects a foreign host such as a rebound domain', async () => {
    await start();
    const { socket } = connect({ host: `evil.test:${port}` });
    expect(await failed(socket)).toBe(403);
    expect(logs).toEqual([`ws: rejected host evil.test:${port}`]);
  });

  it('rejects other paths', async () => {
    await start();
    const { socket } = connect({ path: '/other' });
    expect(await failed(socket)).toBe(404);
  });

  it('accepts extra origins such as the dev server', async () => {
    await start({ origins: ['http://localhost:5173'] });
    const { next } = connect({ origin: 'http://localhost:5173' });
    expect((await next())[0]?.type).toBe('session:init');
  });
});

describe('gateway messages', () => {
  it('broadcasts to every connected client', async () => {
    await start();
    const a = connect();
    const b = connect();
    await a.next(2);
    await b.next(2);
    gateway.broadcast({ type: 'agent:removed', agentId: 'a1' });
    expect(await a.next()).toEqual([{ type: 'agent:removed', agentId: 'a1' }]);
    expect(await b.next()).toEqual([{ type: 'agent:removed', agentId: 'a1' }]);
  });

  it('dispatches valid messages to the manager', async () => {
    await start();
    const { socket, next } = connect();
    await next(2);
    socket.send(JSON.stringify({ type: 'term:input', agentId: 'a1', data: 'ls\r' }));
    await vi.waitFor(() => {
      expect(manager.input).toHaveBeenCalledWith('a1', 'ls\r');
    });
  });

  it('replies with the error code to the sender only', async () => {
    await start();
    manager.interrupt.mockReturnValue({ ok: false, code: 'AGENT_NOT_FOUND' });
    const a = connect();
    const b = connect();
    await a.next(2);
    await b.next(2);
    a.socket.send(JSON.stringify({ type: 'agent:interrupt', agentId: 'x' }));
    expect(await a.next()).toEqual([
      { type: 'error', code: 'AGENT_NOT_FOUND', source: 'agent:interrupt' },
    ]);
    expect(b.messages).toHaveLength(2);
  });

  it('forwards the error params of a failed command', async () => {
    await start();
    manager.setSkin.mockResolvedValue({ ok: false, code: 'SKIN_NOT_FOUND', params: { skin: 'x' } });
    const { socket, next } = connect();
    await next(2);
    socket.send(JSON.stringify({ type: 'agent:setSkin', agentId: 'a1', skin: 'x' }));
    expect(await next()).toEqual([
      { type: 'error', code: 'SKIN_NOT_FOUND', source: 'agent:setSkin', params: { skin: 'x' } },
    ]);
  });

  it.each([['not json'], [JSON.stringify({ type: 'agent:remove' })]])(
    'drops invalid message %s',
    async (raw) => {
      await start();
      const { socket, next, messages } = connect();
      await next(2);
      socket.send(raw);
      await vi.waitFor(() => {
        expect(logs).toEqual(['ws: dropped invalid message']);
      });
      expect(messages).toHaveLength(2);
    },
  );

  it('drops binary frames', async () => {
    await start();
    const { socket, next } = connect();
    await next(2);
    socket.send(Buffer.from(JSON.stringify({ type: 'agent:removeAll' })), { binary: true });
    await vi.waitFor(() => {
      expect(logs).toEqual(['ws: dropped invalid message']);
    });
    expect(manager.removeAll).not.toHaveBeenCalled();
  });

  it('forgets clients that disconnect', async () => {
    await start();
    const { socket, next } = connect();
    await next(2);
    socket.close();
    await vi.waitFor(() => {
      expect(gateway.clientCount).toBe(0);
    });
    gateway.broadcast({ type: 'agent:removed', agentId: 'a1' });
  });

  it('reports client count changes once per connection', async () => {
    const counts: number[] = [];
    await start({ onClientsChange: (count) => counts.push(count) });
    const a = connect();
    const b = connect();
    await a.next(2);
    await b.next(2);
    a.socket.close();
    b.socket.terminate();
    await vi.waitFor(() => {
      expect(counts).toEqual([1, 2, 1, 0]);
    });
  });

  it('replies with an error when a command throws', async () => {
    await start();
    manager.create.mockRejectedValue(new Error('disk full'));
    const { socket, next } = connect();
    await next(2);
    socket.send(
      JSON.stringify({
        type: 'agent:create',
        name: 'Lyra',
        cwd: '/repo',
        skin: 'lyra',
        permissionMode: 'default',
      }),
    );
    expect(await next()).toEqual([
      { type: 'error', code: 'INVALID_MESSAGE', source: 'agent:create' },
    ]);
    expect(logs).toEqual(['ws: agent:create failed: Error: disk full']);
    expect(gateway.clientCount).toBe(1);
  });

  it('closes the socket when the session sync throws', async () => {
    await start();
    manager.views.mockImplementation(() => {
      throw new Error('broken');
    });
    const { socket } = connect();
    expect(await closed(socket)).toBe(INTERNAL_ERROR_CLOSE_CODE);
    expect(logs).toEqual(['ws: session sync failed: Error: broken']);
    expect(gateway.clientCount).toBe(0);
  });

  it('terminates a client that stops reading', async () => {
    await start({ maxBufferedBytes: 0 });
    const { socket, next } = connect();
    await next(2);
    socket.pause();
    const done = closed(socket);
    const data = 'x'.repeat(4 * 1024 * 1024);
    for (let i = 0; i < 8 && gateway.clientCount > 0; i++) {
      gateway.broadcast({ type: 'term:output', agentId: 'a1', data });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    socket.resume();
    await done;
    expect(logs).toContain('ws: dropped a slow client');
  });

  it('terminates clients and stops upgrading on close', async () => {
    await start();
    const { socket, next } = connect();
    await next(2);
    const done = closed(socket);
    await gateway.close();
    await done;
    expect(gateway.clientCount).toBe(0);
    const late = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`, {
      origin: `http://127.0.0.1:${port}`,
    });
    const open = vi.fn();
    late.on('open', open);
    late.on('error', () => undefined);
    await closed(late);
    expect(open).not.toHaveBeenCalled();
  });
});
