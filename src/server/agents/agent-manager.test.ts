import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../../shared/protocol.js';
import type { StoredAgent } from '../store/agent-store.js';
import { AgentRegistry } from './agent-registry.js';
import type { CreateInput, ManagerDeps, ProcessHandle, SpawnSpec } from './agent-manager.js';
import {
  AgentManager,
  READY_TIMEOUT_MS,
  VISIT_DELAY_MS,
  formatAgentMessage,
  preview,
  visibleTail,
} from './agent-manager.js';
import { MAX_EVENTS, MAX_QUEUED } from '../../shared/constants.js';
import { SUBMIT_DELAY_MS } from './message-queue.js';

class FakeProcess implements ProcessHandle {
  running = false;
  written: string[] = [];
  screen = '';
  failStart = false;
  stopped = false;
  disposed = false;
  size: [number, number] | null = null;
  private outputListeners = new Set<(data: string) => void>();
  private exitListeners = new Set<(code: number) => void>();

  constructor(readonly spec: SpawnSpec) {}

  start() {
    if (this.failStart) throw new Error('spawn failed');
    this.running = true;
  }
  write(data: string) {
    this.written.push(data);
  }
  resize(cols: number, rows: number) {
    this.size = [cols, rows];
  }
  snapshot() {
    return Promise.resolve(this.screen);
  }
  stop() {
    this.stopped = true;
    this.running = false;
    return Promise.resolve();
  }
  dispose() {
    this.disposed = true;
  }
  onOutput(listener: (data: string) => void) {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }
  onExit(listener: (code: number) => void) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }
  emit(data: string) {
    for (const listener of this.outputListeners) listener(data);
  }
  exit(code: number) {
    this.running = false;
    for (const listener of this.exitListeners) listener(code);
  }
}

const INPUT: CreateInput = {
  name: 'Mortis',
  cwd: '/repo/api',
  skin: 'mortis',
  permissionMode: 'default',
};

function setup(overrides: Partial<ManagerDeps> = {}) {
  const processes: FakeProcess[] = [];
  const messages: ServerMessage[] = [];
  const saved: StoredAgent[][] = [];
  let failNext = false;
  const deps: ManagerDeps = {
    registry: new AgentRegistry(),
    saveAgents: (agents) => {
      saved.push(agents);
      return Promise.resolve();
    },
    writeFiles: (agent) =>
      Promise.resolve({
        settings: `/data/${agent.id}/settings.json`,
        mcp: `/data/${agent.id}/mcp.json`,
      }),
    createProcess: (spec) => {
      const process = new FakeProcess(spec);
      process.failStart = failNext;
      failNext = false;
      processes.push(process);
      return process;
    },
    isDirectory: (path) => Promise.resolve(path.startsWith('/repo')),
    hasSkin: (skin) => ['mortis', 'corvin', 'lyra'].includes(skin),
    claude: { command: 'claude', args: [] },
    baseEnv: { PATH: '/bin' },
    token: 'secret',
    port: 7777,
    emit: (message) => messages.push(message),
    now: () => 1000,
    ...overrides,
  };
  const manager = new AgentManager(deps);
  const last = () => {
    const process = processes.at(-1);
    if (!process) throw new Error('no process');
    return process;
  };
  const statusOf = (id: string) => deps.registry.get(id)?.status;
  const ofType = <T extends ServerMessage['type']>(type: T) =>
    messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return {
    manager,
    deps,
    processes,
    messages,
    saved,
    last,
    statusOf,
    ofType,
    failNextStart: () => (failNext = true),
  };
}

async function created(ctx: ReturnType<typeof setup>, input: Partial<typeof INPUT> = {}) {
  const result = await ctx.manager.create({ ...INPUT, ...input });
  if (!result.ok) throw new Error(result.code);
  return { id: result.value.id, process: ctx.last() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('helpers', () => {
  it('formats agent messages', () => {
    expect(formatAgentMessage('Corvin', 'hi')).toBe('[Message from Corvin]\nhi');
  });

  it('flattens and truncates previews', () => {
    expect(preview('a\n  b')).toBe('a b');
    expect(preview('x'.repeat(100))).toHaveLength(80);
    expect(preview('x'.repeat(100)).endsWith('…')).toBe(true);
  });
});

describe('create', () => {
  it('spawns the agent cli with settings, mcp config and env', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx, { permissionMode: 'plan' });
    expect(process.spec).toEqual({
      command: 'claude',
      args: [
        '--settings',
        `/data/${id}/settings.json`,
        '--mcp-config',
        `/data/${id}/mcp.json`,
        '--permission-mode',
        'plan',
      ],
      cwd: '/repo/api',
      env: {
        PATH: '/bin',
        GUILDCRAFT_TOKEN: 'secret',
        GUILDCRAFT_PORT: '7777',
        GUILDCRAFT_AGENT_ID: id,
        GUILDCRAFT_AGENT_NAME: 'Mortis',
      },
    });
    expect(process.running).toBe(true);
    expect(ctx.statusOf(id)).toBe('starting');
    expect(ctx.saved.at(-1)).toEqual([{ id, ...INPUT, permissionMode: 'plan' }]);
    expect(ctx.manager.recentEvents()).toEqual([{ kind: 'joined', agentId: id, at: 1000 }]);
  });

  it('keeps launcher args and skips the permission flag in default mode', async () => {
    const ctx = setup({ claude: { command: 'cmd.exe', args: ['/c', 'claude.cmd'] } });
    const { process } = await created(ctx);
    expect(process.spec.args.slice(0, 2)).toEqual(['/c', 'claude.cmd']);
    expect(process.spec.args).not.toContain('--permission-mode');
  });

  it.each([
    [{ cwd: '/elsewhere' }, 'INVALID_CWD'],
    [{ skin: 'dragon' }, 'SKIN_NOT_FOUND'],
    [{ name: '../x' }, 'INVALID_NAME'],
  ])('rejects %j with %s', async (input, code) => {
    const ctx = setup();
    await expect(ctx.manager.create({ ...INPUT, ...input })).resolves.toEqual({ ok: false, code });
    expect(ctx.processes).toHaveLength(0);
  });

  it('reports a failed spawn and leaves the agent offline', async () => {
    const ctx = setup();
    ctx.failNextStart();
    await expect(ctx.manager.create(INPUT)).resolves.toEqual({ ok: false, code: 'SPAWN_FAILED' });
    expect(ctx.manager.views()[0]?.status).toBe('offline');
  });

  it('reports SPAWN_FAILED when the agent files cannot be written', async () => {
    const ctx = setup({ writeFiles: () => Promise.reject(new Error('EACCES')) });
    await expect(ctx.manager.create(INPUT)).resolves.toEqual({ ok: false, code: 'SPAWN_FAILED' });
    expect(ctx.processes).toHaveLength(0);
    expect(ctx.manager.views()[0]?.status).toBe('offline');
  });

  it('becomes idle when SessionStart never arrives', async () => {
    const ctx = setup();
    const { id } = await created(ctx);
    vi.advanceTimersByTime(READY_TIMEOUT_MS - 1);
    expect(ctx.statusOf(id)).toBe('starting');
    vi.advanceTimersByTime(1);
    expect(ctx.statusOf(id)).toBe('idle');
  });

  it('cancels the ready timeout once a hook arrives', async () => {
    const ctx = setup();
    const { id } = await created(ctx);
    ctx.manager.hook(id, 'UserPromptSubmit', {});
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    expect(ctx.statusOf(id)).toBe('thinking');
  });
});

describe('restore', () => {
  it('re-adds saved agents with their ids and spawns them', async () => {
    const ctx = setup();
    await ctx.manager.restore([
      { id: 'a1', ...INPUT },
      { id: 'a1', ...INPUT, name: 'Dup' },
    ]);
    expect(ctx.manager.views().map((v) => v.id)).toEqual(['a1']);
    expect(ctx.processes).toHaveLength(1);
  });

  it('keeps restoring when one agent fails to spawn', async () => {
    let calls = 0;
    const ctx = setup({
      writeFiles: (agent) =>
        calls++ === 0
          ? Promise.reject(new Error('disk full'))
          : Promise.resolve({ settings: `/d/${agent.id}/s`, mcp: `/d/${agent.id}/m` }),
    });
    await ctx.manager.restore([
      { id: 'a1', ...INPUT },
      { id: 'a2', ...INPUT, name: 'Corvin' },
    ]);
    expect(ctx.manager.views().map((v) => v.status)).toEqual(['offline', 'starting']);
  });
});

describe('terminal', () => {
  it('broadcasts output and serves snapshots', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    process.emit('hello');
    process.screen = 'screen';
    expect(ctx.ofType('term:output')).toEqual([
      { type: 'term:output', agentId: id, data: 'hello' },
    ]);
    await expect(ctx.manager.snapshot(id)).resolves.toBe('screen');
    await expect(ctx.manager.snapshot('nope')).resolves.toBe('');
  });

  it('forwards input and resize', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    expect(ctx.manager.input(id, 'ls\r')).toEqual({ ok: true, value: undefined });
    expect(ctx.manager.resize(id, 100, 30)).toEqual({ ok: true, value: undefined });
    expect(process.written).toEqual(['ls\r']);
    expect(process.size).toEqual([100, 30]);
  });

  it.each(['input', 'resize', 'interrupt'] as const)('%s fails for unknown agents', (action) => {
    const { manager } = setup();
    const result = action === 'resize' ? manager.resize('x', 1, 1) : manager[action]('x', 'a');
    expect(result).toEqual({ ok: false, code: 'AGENT_NOT_FOUND' });
  });

  it.each(['\r', '2', 'yes\r'])('moves a waiting agent to thinking on %j', async (data) => {
    const ctx = setup();
    const { id } = await created(ctx);
    ctx.manager.hook(id, 'Notification', { notification_type: 'permission_prompt' });
    ctx.manager.input(id, data);
    expect(ctx.statusOf(id)).toBe('thinking');
  });

  it.each(['\x1b[B', 'a', '12'])('keeps a waiting agent waiting on %j', async (data) => {
    const ctx = setup();
    const { id } = await created(ctx);
    ctx.manager.hook(id, 'Notification', { notification_type: 'permission_prompt' });
    ctx.manager.input(id, data);
    expect(ctx.statusOf(id)).toBe('waiting');
  });

  it('marks the agent idle on interrupt', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    ctx.manager.hook(id, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'sleep 9' } });
    ctx.manager.interrupt(id);
    expect(process.written).toEqual(['\x1b']);
    expect(ctx.statusOf(id)).toBe('idle');
  });

  it('does not force idle on escape while starting', async () => {
    const ctx = setup();
    const { id } = await created(ctx);
    ctx.manager.input(id, '\x1b');
    expect(ctx.statusOf(id)).toBe('starting');
  });
});

describe('trust prompt', () => {
  const PROMPT = 'Do you trust the files in this folder?\n❯ 1. Yes, proceed\n  2. No, exit\n';

  it('accepts the trust prompt once', async () => {
    const ctx = setup();
    const { process } = await created(ctx);
    process.screen = PROMPT;
    process.emit('x');
    process.emit('y');
    await vi.runAllTimersAsync();
    expect(process.written).toEqual(['\r']);
  });

  it('waits for the user when the answer is unclear', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    process.screen = 'Do you trust the files in this folder?\n  maybe\n';
    process.emit('x');
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.statusOf(id)).toBe('waiting');
    expect(process.written).toEqual([]);
  });

  it('ignores ordinary output', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    process.screen = 'Welcome';
    process.emit('x');
    await Promise.resolve();
    expect(ctx.statusOf(id)).toBe('starting');
  });

  it('answers the trust prompt even after SessionStart and holds the queue meanwhile', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    process.screen = 'Do you trust the files in this folder?\n  maybe\n';
    process.emit('x');
    await vi.advanceTimersByTimeAsync(0);
    ctx.manager.hook(id, 'SessionStart', {});
    ctx.manager.sendPrompt([id], 'queued');
    expect(process.written).toEqual([]);

    process.screen = PROMPT;
    process.emit('y');
    await vi.advanceTimersByTimeAsync(0);
    expect(process.written).toEqual(['\r']);

    process.screen = 'Welcome';
    process.emit('z');
    await vi.advanceTimersByTimeAsync(0);
    expect(process.written).toEqual(['\r']);
    expect(ctx.deps.registry.get(id)?.queued).toBe(1);
    ctx.manager.hook(id, 'Stop', {});
    expect(process.written.at(-1)).toBe('\x1b[200~queued\x1b[201~');
  });

  it('delivers once the unanswered prompt disappears', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    process.screen = 'Do you trust the files in this folder?\n  maybe\n';
    process.emit('x');
    await vi.advanceTimersByTimeAsync(0);
    ctx.manager.input(id, '\r');
    ctx.manager.hook(id, 'Stop', {});
    ctx.manager.sendPrompt([id], 'go');
    expect(process.written).toEqual(['\r']);
    process.screen = 'Welcome';
    process.emit('y');
    await vi.advanceTimersByTimeAsync(0);
    expect(process.written.at(-1)).toBe('\x1b[200~go\x1b[201~');
  });

  it('only looks at the visible part of the screen', async () => {
    const ctx = setup();
    const { process } = await created(ctx);
    process.screen = `${PROMPT}${'line\n'.repeat(60)}`;
    process.emit('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(process.written).toEqual([]);
  });

  it('stops checking once the agent starts working', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    ctx.manager.hook(id, 'UserPromptSubmit', {});
    process.screen = PROMPT;
    process.emit('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(process.written).toEqual([]);
  });
});

describe('visibleTail', () => {
  it('keeps the last lines', () => {
    expect(visibleTail('a\r\nb\nc', 2)).toBe('b\nc');
  });
});

describe('prompts', () => {
  it('delivers immediately to an idle agent and queues for a busy one', async () => {
    const ctx = setup();
    const a = await created(ctx);
    const b = await created(ctx, { name: 'Corvin', skin: 'corvin' });
    ctx.manager.hook(a.id, 'SessionStart', {});
    ctx.manager.hook(b.id, 'UserPromptSubmit', {});

    const result = ctx.manager.sendPrompt([a.id, b.id], 'run tests');
    expect(result).toEqual({
      ok: true,
      value: [
        { queued: 1, busy: false },
        { queued: 1, busy: true },
      ],
    });
    expect(a.process.written).toEqual(['\x1b[200~run tests\x1b[201~']);
    expect(ctx.statusOf(a.id)).toBe('thinking');
    expect(b.process.written).toEqual([]);
    expect(ctx.deps.registry.get(b.id)?.queued).toBe(1);

    ctx.manager.hook(b.id, 'Stop', {});
    expect(b.process.written).toEqual(['\x1b[200~run tests\x1b[201~']);
    expect(ctx.deps.registry.get(b.id)?.queued).toBe(0);
    vi.advanceTimersByTime(SUBMIT_DELAY_MS);
    expect(b.process.written.at(-1)).toBe('\r');
  });

  it('enqueues once per agent when ids repeat', async () => {
    const ctx = setup();
    const a = await created(ctx);
    expect(ctx.manager.sendPrompt([a.id, a.id], 'x')).toMatchObject({ ok: true, value: [{}] });
    expect(ctx.deps.registry.get(a.id)?.queued).toBe(1);
  });

  it('enqueues nothing when any target is full', async () => {
    const ctx = setup();
    const a = await created(ctx);
    const b = await created(ctx, { name: 'Corvin', skin: 'corvin' });
    for (let i = 0; i < MAX_QUEUED; i++) ctx.manager.sendPrompt([b.id], `m${i}`);
    expect(ctx.manager.sendPrompt([a.id, b.id], 'x')).toEqual({ ok: false, code: 'QUEUE_FULL' });
    expect(ctx.deps.registry.get(a.id)?.queued).toBe(0);
  });

  it('refuses prompts and messages for an agent that exited', async () => {
    const ctx = setup();
    const a = await created(ctx);
    const b = await created(ctx, { name: 'Corvin', skin: 'corvin' });
    b.process.exit(0);
    expect(ctx.manager.sendPrompt([a.id, b.id], 'x')).toEqual({
      ok: false,
      code: 'AGENT_OFFLINE',
    });
    expect(ctx.manager.sendMessage(a.id, 'Corvin', 'x')).toEqual({
      ok: false,
      code: 'AGENT_OFFLINE',
    });
    expect(ctx.deps.registry.get(a.id)?.queued).toBe(0);
  });

  it('rejects unknown targets', async () => {
    const ctx = setup();
    const a = await created(ctx);
    expect(ctx.manager.sendPrompt([a.id, 'nope'], 'x')).toEqual({
      ok: false,
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('rejects empty prompts', async () => {
    const ctx = setup();
    const a = await created(ctx);
    expect(ctx.manager.sendPrompt([a.id], '  ')).toEqual({ ok: false, code: 'EMPTY_PROMPT' });
  });
});

describe('agent messages', () => {
  it('walks to the recipient and delivers when it is idle', async () => {
    const ctx = setup();
    const a = await created(ctx);
    const b = await created(ctx, { name: 'Corvin', skin: 'corvin' });
    ctx.manager.hook(b.id, 'SessionStart', {});

    expect(ctx.manager.sendMessage(a.id, 'corvin', 'api is   ready')).toEqual({
      ok: true,
      value: { queued: 1, busy: false },
    });
    expect(ctx.ofType('agent:visit')).toEqual([
      { type: 'agent:visit', fromId: a.id, toId: b.id, preview: 'api is ready' },
    ]);
    expect(b.process.written).toEqual([]);

    vi.advanceTimersByTime(VISIT_DELAY_MS);
    expect(b.process.written[0]).toBe('\x1b[200~[Message from Mortis]\napi is   ready\x1b[201~');
    expect(ctx.ofType('message:delivered')).toEqual([
      { type: 'message:delivered', fromId: a.id, toId: b.id },
    ]);
    expect(ctx.manager.recentEvents().map((e) => e.kind)).toEqual([
      'joined',
      'joined',
      'messaged',
      'delivered',
    ]);
  });

  it('reports a busy recipient', async () => {
    const ctx = setup();
    const a = await created(ctx);
    await created(ctx, { name: 'Corvin', skin: 'corvin' });
    expect(ctx.manager.sendMessage(a.id, 'Corvin', 'hi')).toMatchObject({
      value: { busy: true },
    });
  });

  it.each([
    ['an unknown sender', 'x', 'Corvin'],
    ['an unknown recipient', 'self', 'Nobody'],
    ['the sender itself', 'self', 'Mortis'],
  ])('rejects %s', async (_, from, to) => {
    const ctx = setup();
    const a = await created(ctx);
    await created(ctx, { name: 'Corvin', skin: 'corvin' });
    expect(ctx.manager.sendMessage(from === 'self' ? a.id : from, to, 'hi')).toEqual({
      ok: false,
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('rejects empty messages', async () => {
    const ctx = setup();
    const a = await created(ctx);
    await created(ctx, { name: 'Corvin', skin: 'corvin' });
    expect(ctx.manager.sendMessage(a.id, 'Corvin', ' \n ')).toEqual({
      ok: false,
      code: 'EMPTY_PROMPT',
    });
    expect(ctx.ofType('agent:visit')).toEqual([]);
  });

  it('lists the other agents', async () => {
    const ctx = setup();
    const a = await created(ctx);
    const b = await created(ctx, { name: 'Corvin', skin: 'corvin' });
    expect(ctx.manager.others(a.id).map((v) => v.id)).toEqual([b.id]);
  });
});

describe('hooks', () => {
  it('applies outcomes and records events', async () => {
    const ctx = setup();
    const { id } = await created(ctx);
    ctx.manager.hook(id, 'PreToolUse', {
      tool_name: 'Edit',
      tool_input: { file_path: '/a/App.tsx' },
    });
    expect(ctx.manager.views()[0]).toMatchObject({
      status: 'tool',
      tool: { name: 'Edit', detail: 'App.tsx' },
    });
    ctx.manager.hook(id, 'Stop', {});
    expect(ctx.manager.recentEvents().at(-1)).toEqual({ kind: 'finished', agentId: id, at: 1000 });
  });

  it('ignores hooks without an outcome', async () => {
    const ctx = setup();
    const { id } = await created(ctx);
    const before = ctx.messages.length;
    expect(ctx.manager.hook(id, 'Notification', {})).toEqual({ ok: true, value: undefined });
    expect(ctx.messages).toHaveLength(before);
  });

  it('rejects hooks for unknown agents', () => {
    expect(setup().manager.hook('x', 'Stop', {})).toEqual({ ok: false, code: 'AGENT_NOT_FOUND' });
  });

  it(`keeps the last ${MAX_EVENTS} events`, async () => {
    const ctx = setup();
    const { id } = await created(ctx);
    for (let i = 0; i < MAX_EVENTS + 5; i++) ctx.manager.hook(id, 'Stop', {});
    expect(ctx.manager.recentEvents()).toHaveLength(MAX_EVENTS);
  });
});

describe('lifecycle', () => {
  it('goes offline when the process exits and drops queued prompts', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    ctx.manager.hook(id, 'UserPromptSubmit', {});
    ctx.manager.sendPrompt([id], 'later');
    process.exit(1);
    expect(ctx.manager.views()[0]).toMatchObject({ status: 'offline', queued: 0 });
    vi.advanceTimersByTime(READY_TIMEOUT_MS);
    expect(ctx.statusOf(id)).toBe('offline');
  });

  it('restarts with a fresh process and resets the terminal', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    await expect(ctx.manager.restart(id)).resolves.toEqual({ ok: true, value: undefined });
    expect(process.stopped && process.disposed).toBe(true);
    expect(ctx.processes).toHaveLength(2);
    expect(ctx.ofType('term:reset')).toEqual([{ type: 'term:reset', agentId: id }]);
    expect(ctx.statusOf(id)).toBe('starting');
  });

  it('reports a failed restart', async () => {
    const ctx = setup();
    const { id } = await created(ctx);
    ctx.failNextStart();
    await expect(ctx.manager.restart(id)).resolves.toEqual({ ok: false, code: 'SPAWN_FAILED' });
  });

  it('removes agents, persists and broadcasts', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    await expect(ctx.manager.remove(id)).resolves.toEqual({ ok: true, value: undefined });
    expect(process.stopped).toBe(true);
    expect(ctx.manager.views()).toEqual([]);
    expect(ctx.saved.at(-1)).toEqual([]);
    expect(ctx.ofType('agent:removed')).toEqual([{ type: 'agent:removed', agentId: id }]);
    expect(ctx.manager.recentEvents().at(-1)?.kind).toBe('left');
  });

  it('ignores output from a removed agent', async () => {
    const ctx = setup();
    const { id, process } = await created(ctx);
    await ctx.manager.remove(id);
    process.emit('late');
    expect(ctx.ofType('term:output')).toEqual([]);
  });

  it('removes every agent', async () => {
    const ctx = setup();
    await created(ctx);
    await created(ctx, { name: 'Corvin', skin: 'corvin' });
    await ctx.manager.removeAll();
    expect(ctx.manager.views()).toEqual([]);
  });

  it('stops every process on shutdown but keeps them saved', async () => {
    const ctx = setup();
    const a = await created(ctx);
    const b = await created(ctx, { name: 'Corvin', skin: 'corvin' });
    await ctx.manager.shutdown();
    expect(a.process.stopped && b.process.stopped).toBe(true);
    expect(ctx.manager.views().map((v) => v.status)).toEqual(['offline', 'offline']);
    expect(ctx.saved.at(-1)).toHaveLength(2);
  });

  it.each(['remove', 'restart'] as const)('%s fails for unknown agents', async (action) => {
    await expect(setup().manager[action]('x')).resolves.toEqual({
      ok: false,
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('changes the skin', async () => {
    const ctx = setup();
    const { id } = await created(ctx);
    await expect(ctx.manager.setSkin(id, 'lyra')).resolves.toEqual({ ok: true, value: undefined });
    expect(ctx.saved.at(-1)?.[0]?.skin).toBe('lyra');
    await expect(ctx.manager.setSkin(id, 'dragon')).resolves.toEqual({
      ok: false,
      code: 'SKIN_NOT_FOUND',
    });
    await expect(ctx.manager.setSkin('x', 'lyra')).resolves.toEqual({
      ok: false,
      code: 'AGENT_NOT_FOUND',
    });
  });
});
