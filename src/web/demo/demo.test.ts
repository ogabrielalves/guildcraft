import { describe, expect, it, vi } from 'vitest';
import { AGENT_STATUSES } from '../../shared/agent.js';
import { MAX_AGENTS } from '../../shared/constants.js';
import type { ServerMessage } from '../../shared/protocol.js';
import {
  DEMO_SKINS,
  DEMO_TICK_MS,
  DEMO_VISIT_DELAY_MS,
  DemoSocket,
  MAX_WARP,
  createDemoAgents,
  demoListFolders,
  nextStatus,
  parseDemoOptions,
  pick,
  seededRandom,
} from './demo.js';
import type { DemoOptions, Random } from './demo.js';

type MessageOf<T extends ServerMessage['type']> = ServerMessage extends infer M
  ? M extends ServerMessage
    ? T extends M['type']
      ? M
      : never
    : never
  : never;

function sequence(...values: number[]): Random {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

function harness(options: Partial<DemoOptions> = {}, random: Random = seededRandom(1)) {
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  const socket = new DemoSocket(
    { warp: 1, visit: false, ...options },
    random,
    {
      setTimer: (callback, ms) => {
        const timer = { callback, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimer: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    },
    () => 42,
  );
  const messages: ServerMessage[] = [];
  socket.onMessage((message) => messages.push(message));
  const of = <T extends ServerMessage['type']>(type: T) =>
    messages.filter((message): message is MessageOf<T> => message.type === type);
  return { socket, timers, messages, of };
}

describe('parseDemoOptions', () => {
  it('returns null without the demo flag', () => {
    expect(parseDemoOptions(new URL('http://h/?warp=3'))).toBeNull();
  });

  it('reads warp and visit', () => {
    expect(parseDemoOptions(new URL('http://h/?demo&warp=12&visit'))).toEqual({
      warp: 12,
      visit: true,
    });
  });

  it('defaults and clamps warp', () => {
    expect(parseDemoOptions(new URL('http://h/?demo'))).toEqual({ warp: 1, visit: false });
    expect(parseDemoOptions(new URL('http://h/?demo&warp=0'))?.warp).toBe(1);
    expect(parseDemoOptions(new URL('http://h/?demo&warp=999'))?.warp).toBe(MAX_WARP);
    expect(parseDemoOptions(new URL('http://h/?demo&warp=abc'))?.warp).toBe(1);
  });
});

describe('seededRandom', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('pick', () => {
  it('picks by the random value', () => {
    expect(pick(['a', 'b', 'c'], () => 0.5)).toBe('b');
  });

  it('throws on an empty list', () => {
    expect(() => pick([], () => 0)).toThrow();
  });
});

describe('nextStatus', () => {
  it('boots offline and starting agents', () => {
    expect(nextStatus('offline', () => 0)).toBe('starting');
    expect(nextStatus('starting', () => 0)).toBe('idle');
  });

  it.each([
    ['idle', 0.1, 'thinking'],
    ['idle', 0.9, 'idle'],
    ['thinking', 0.1, 'tool'],
    ['thinking', 0.8, 'waiting'],
    ['thinking', 0.9, 'idle'],
    ['tool', 0.1, 'tool'],
    ['tool', 0.6, 'thinking'],
    ['tool', 0.9, 'idle'],
    ['waiting', 0.1, 'waiting'],
    ['waiting', 0.9, 'thinking'],
  ] as const)('%s with roll %d goes to %s', (status, roll, expected) => {
    expect(nextStatus(status, () => roll)).toBe(expected);
  });

  it('always returns a valid status', () => {
    const random = seededRandom(3);
    for (const status of AGENT_STATUSES) {
      expect(AGENT_STATUSES).toContain(nextStatus(status, random));
    }
  });
});

describe('createDemoAgents', () => {
  it('creates idle agents with unique ids and known skins', () => {
    const agents = createDemoAgents();
    expect(new Set(agents.map((agent) => agent.id)).size).toBe(agents.length);
    expect(agents.every((agent) => agent.status === 'idle')).toBe(true);
    expect(agents.every((agent) => DEMO_SKINS.some((skin) => skin === agent.skin))).toBe(true);
    expect(agents[0]).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' });
    expect(agents.at(-1)).toMatchObject({ model: null, effort: null });
  });
});

describe('DemoSocket', () => {
  it('opens with a session, snapshots and a scheduled tick', () => {
    const { socket, timers, of } = harness({ warp: 4 });
    const statuses = vi.fn();
    socket.onStatus(statuses);
    socket.connect();
    socket.connect();
    expect(socket.getStatus()).toBe('open');
    expect(statuses).toHaveBeenCalledExactlyOnceWith('open');
    expect(of('session:init')).toHaveLength(1);
    expect(of('session:init')[0]?.skins).toEqual([...DEMO_SKINS]);
    expect(of('term:snapshot')).toHaveLength(createDemoAgents().length);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(DEMO_TICK_MS / 4);
  });

  it('ticks agents and keeps scheduling until closed', () => {
    const { socket, timers, of } = harness();
    socket.connect();
    timers[0]?.callback();
    expect(of('agent:updated').length).toBeGreaterThan(0);
    expect(timers).toHaveLength(2);
    socket.close();
    expect(timers[1]?.cleared).toBe(true);
    expect(socket.getStatus()).toBe('closed');
    timers[1]?.callback();
    expect(timers).toHaveLength(2);
  });

  it('emits tool output and events on transitions', () => {
    const { socket, of } = harness({}, sequence(0, 0.1, 0, 0.1, 0, 0, 0.9));
    socket.connect();
    socket.tick();
    socket.tick();
    expect(of('term:output').some((message) => message.data.includes('Edit(App.tsx)'))).toBe(true);
    socket.tick();
    expect(of('event').map((message) => message.event.kind)).toContain('finished');
  });

  it('records tool actions as activity and drops them on remove', () => {
    const { socket, of } = harness({}, sequence(0, 0.1, 0, 0.1, 0, 0, 0.9));
    socket.connect();
    socket.tick();
    socket.tick();
    const running = of('agent:activity').at(-1)?.activity;
    expect(running?.agentId).toBe('demo-1');
    expect(running?.actions).toMatchObject([{ tool: 'Edit', state: 'running', result: null }]);
    socket.tick();
    const done = of('agent:activity').at(-1)?.activity;
    expect(done?.actions).toMatchObject([{ state: 'done', result: 'ok' }]);
    socket.close();
    socket.connect();
    expect(of('session:init').at(-1)?.activities).toEqual([done]);
    socket.send({ type: 'agent:remove', agentId: 'demo-1' });
    socket.close();
    socket.connect();
    expect(of('session:init').at(-1)?.activities).toEqual([]);
  });

  it('asks for permission when waiting and resolves decisions', () => {
    const { socket, of } = harness({}, sequence(0, 0.1, 0, 0.8, 0));
    socket.connect();
    socket.tick();
    socket.tick();
    const request = of('permission:request')[0]?.request;
    expect(request).toMatchObject({ agentId: 'demo-1', toolName: 'Bash' });
    expect(request?.suggestions).toHaveLength(1);
    const updates = of('agent:updated').length;
    socket.tick();
    expect(of('agent:updated')).toHaveLength(updates);
    socket.close();
    socket.connect();
    expect(of('session:init').at(-1)?.permissions).toEqual([request]);
    socket.send({
      type: 'permission:decide',
      requestId: request?.id ?? '',
      decision: { behavior: 'allow' },
    });
    expect(of('permission:resolved').at(-1)).toMatchObject({ outcome: 'allowed' });
    expect(of('agent:updated').at(-1)?.agent).toMatchObject({
      status: 'thinking',
      waitingFor: null,
    });
    socket.send({
      type: 'permission:decide',
      requestId: request?.id ?? '',
      decision: { behavior: 'deny' },
    });
    expect(of('error').at(-1)).toMatchObject({ code: 'PERMISSION_NOT_FOUND' });
  });

  it('alternates permission and question requests and clears them on remove', () => {
    const { socket, of } = harness({}, sequence(0, 0.1, 0, 0.8, 0, 0.9, 0, 0.8));
    socket.connect();
    socket.tick();
    socket.tick();
    const first = of('permission:request')[0]?.request;
    socket.send({
      type: 'permission:decide',
      requestId: first?.id ?? '',
      decision: { behavior: 'terminal' },
    });
    expect(of('permission:resolved').at(-1)).toMatchObject({ outcome: 'terminal' });
    socket.tick();
    socket.tick();
    const second = of('permission:request')[1]?.request;
    expect(second?.toolName).toBe('AskUserQuestion');
    expect(second?.questions?.[0]?.options).toHaveLength(2);
    socket.send({ type: 'agent:remove', agentId: 'demo-1' });
    socket.close();
    socket.connect();
    expect(of('session:init').at(-1)?.permissions).toEqual([]);
  });

  it('records waiting transitions', () => {
    const { socket, of } = harness({}, sequence(0, 0.1, 0, 0.8));
    socket.connect();
    socket.tick();
    socket.tick();
    expect(of('event').map((message) => message.event.kind)).toEqual(['waiting']);
  });

  it('visits another agent and delivers after a delay', () => {
    const { socket, timers, of } = harness(
      { visit: true, warp: 2 },
      sequence(0, 0.1, 0, 0.1, 0.99, 0, 0),
    );
    socket.connect();
    socket.tick();
    socket.tick();
    const visit = of('agent:visit')[0];
    expect(visit?.fromId).toBe('demo-1');
    expect(visit?.toId).toBe('demo-2');
    const delivery = timers.at(-1);
    expect(delivery?.ms).toBe(DEMO_VISIT_DELAY_MS / 2);
    delivery?.callback();
    expect(of('message:delivered')).toEqual([
      { type: 'message:delivered', fromId: 'demo-1', toId: 'demo-2' },
    ]);
    expect(of('event').map((message) => message.event)).toContainEqual({
      kind: 'delivered',
      agentId: 'demo-2',
      targetId: 'demo-1',
      at: 42,
    });
  });

  it('skips delivery when the target was removed', () => {
    const { socket, timers, of } = harness({ visit: true }, sequence(0, 0.1, 0, 0.1, 0.99, 0, 0));
    socket.connect();
    socket.tick();
    socket.tick();
    socket.send({ type: 'agent:remove', agentId: 'demo-2' });
    timers.at(-1)?.callback();
    expect(of('message:delivered')).toHaveLength(0);
  });

  it('does nothing when there are no agents', () => {
    const { socket, messages } = harness();
    socket.connect();
    socket.send({ type: 'agent:removeAll' });
    const count = messages.length;
    socket.tick();
    expect(messages).toHaveLength(count);
    expect(socket.getAgents()).toHaveLength(0);
  });

  it('refuses messages while closed', () => {
    const { socket } = harness();
    expect(socket.send({ type: 'agent:removeAll' })).toBe(false);
  });

  it('handles prompts, input, interrupts, restarts and skins', () => {
    const { socket, of } = harness();
    socket.connect();
    expect(socket.send({ type: 'prompt:send', agentIds: ['demo-1', 'nope'], text: 'hi' })).toBe(
      true,
    );
    expect(socket.getAgents()[0]?.status).toBe('thinking');
    expect(of('event').map((message) => message.event.kind)).toEqual(['prompted']);
    socket.send({ type: 'term:input', agentId: 'demo-1', data: 'x' });
    expect(of('term:output').at(-1)?.data).toBe('x');
    socket.send({ type: 'agent:interrupt', agentId: 'demo-1' });
    expect(socket.getAgents()[0]?.status).toBe('idle');
    socket.send({ type: 'agent:restart', agentId: 'demo-1' });
    expect(socket.getAgents()[0]?.status).toBe('starting');
    expect(of('term:reset')).toHaveLength(1);
    socket.send({ type: 'agent:setSkin', agentId: 'demo-1', skin: 'lyra' });
    expect(socket.getAgents()[0]?.skin).toBe('lyra');
    const updates = of('agent:updated').length;
    socket.send({ type: 'term:resize', agentId: 'demo-1', cols: 80, rows: 24 });
    socket.send({ type: 'agent:interrupt', agentId: 'nope' });
    socket.send({ type: 'agent:remove', agentId: 'nope' });
    expect(of('agent:updated')).toHaveLength(updates);
  });

  it('creates agents and enforces name and limit rules', () => {
    const { socket, of } = harness();
    socket.connect();
    const create = (name: string) =>
      socket.send({ type: 'agent:create', name, cwd: '/p', skin: 'oren', permissionMode: 'plan' });
    create('Mortis');
    expect(of('error').at(-1)).toEqual({
      type: 'error',
      code: 'AGENT_NAME_TAKEN',
      params: { name: 'Mortis' },
    });
    create('Oren');
    const created = socket.getAgents().at(-1);
    expect(created).toMatchObject({ name: 'Oren', status: 'starting', permissionMode: 'plan' });
    expect(of('event').at(-1)?.event).toEqual({ kind: 'joined', agentId: created?.id, at: 42 });
    while (socket.getAgents().length < MAX_AGENTS) create(`Extra ${socket.getAgents().length}`);
    create('Overflow');
    expect(of('error').at(-1)).toEqual({ type: 'error', code: 'AGENT_LIMIT_REACHED' });
    expect(socket.getAgents()).toHaveLength(MAX_AGENTS);
  });

  it('removes agents', () => {
    const { socket, of } = harness();
    socket.connect();
    socket.send({ type: 'agent:remove', agentId: 'demo-1' });
    expect(of('agent:removed')).toEqual([{ type: 'agent:removed', agentId: 'demo-1' }]);
    expect(of('event').at(-1)?.event.kind).toBe('left');
  });

  it('unsubscribes listeners', () => {
    const { socket } = harness();
    const onMessage = vi.fn();
    const onStatus = vi.fn();
    socket.onMessage(onMessage)();
    socket.onStatus(onStatus)();
    socket.connect();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe('demoListFolders', () => {
  it('lists the roots without a path', async () => {
    const listing = await demoListFolders(null);
    expect(listing.path).toBeNull();
    expect(listing.roots.map((root) => root.name)).toEqual(['~', '/']);
  });

  it('lists fake project folders', async () => {
    const listing = await demoListFolders('/home/demo/projects');
    expect(listing.parent).toBe('/home/demo');
    expect(listing.entries.map((entry) => entry.name)).toContain('web');
    expect(listing.entries[0]?.path).toBe('/home/demo/projects/api');
  });

  it('walks up to the filesystem root', async () => {
    expect((await demoListFolders('/home')).parent).toBe('/');
    const root = await demoListFolders('/');
    expect(root.parent).toBeNull();
    expect(root.entries).toEqual([{ name: 'home', path: '/home' }]);
  });

  it('rejects unknown folders', async () => {
    await expect(demoListFolders('/nope')).rejects.toThrow('unknown demo folder');
  });
});
