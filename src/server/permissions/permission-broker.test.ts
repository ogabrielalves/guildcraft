import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '../../shared/protocol.js';
import type { SessionEntry } from '../sessions/session-registry.js';
import type { AgentContext, BrokerDeps } from './permission-broker.js';
import {
  DECIDED_KEEP_MS,
  MAX_PENDING,
  MAX_WAIT_MS,
  ORPHAN_MS,
  PERMISSION_TIMEOUT_MS,
  PermissionBroker,
  SESSION_SETTLE_MS,
} from './permission-broker.js';

const BASH = { tool_name: 'Bash', tool_input: { command: 'npm test' } };
const ASK = {
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [{ question: 'Which?', header: 'Q', options: [{ label: 'A' }, { label: 'B' }] }],
  },
};
const SUGGESTED = {
  ...BASH,
  permission_suggestions: [
    { type: 'addRules', behavior: 'allow', destination: 'session', rules: [{ toolName: 'Bash' }] },
  ],
};

function setup(overrides: Partial<BrokerDeps> = {}) {
  let clock = 1_000;
  let ids = 0;
  const messages: ServerMessage[] = [];
  const resolved: unknown[][] = [];
  const lines: string[] = [];
  const deps: BrokerDeps = {
    emit: (message) => messages.push(message),
    hasViewers: () => true,
    onResolved: (...args) => resolved.push(args),
    readLines: () => Promise.resolve(lines),
    now: () => clock,
    newId: () => `p${++ids}`,
    ...overrides,
  };
  const broker = new PermissionBroker(deps);
  const open = (raw: unknown = BASH, agentId = 'a1') => {
    const result = broker.open(agentId, raw);
    if (!result.ok) throw new Error('not opened');
    return result.id;
  };
  return {
    broker,
    messages,
    resolved,
    lines,
    open,
    tick: (ms: number) => (clock += ms),
    context: (session: SessionEntry | null = null, transcriptPath: string | null = null) =>
      ({ session, transcriptPath }) satisfies AgentContext,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PermissionBroker.open', () => {
  it('registers a request and announces it', () => {
    const { broker, messages } = setup();
    expect(broker.open('a1', BASH)).toEqual({
      ok: true,
      id: 'p1',
      expiresAt: 1_000 + PERMISSION_TIMEOUT_MS,
    });
    const view = {
      id: 'p1',
      agentId: 'a1',
      toolName: 'Bash',
      detail: 'npm test',
      input: 'npm test',
      subagent: null,
      suggestions: [],
      questions: null,
      createdAt: 1_000,
      expiresAt: 1_000 + PERMISSION_TIMEOUT_MS,
    };
    expect(messages).toEqual([{ type: 'permission:request', request: view }]);
    expect(broker.list()).toEqual([view]);
    expect(broker.oldestFor('a1')).toEqual(view);
    expect(broker.oldestFor('a2')).toBeNull();
  });

  it('skips without viewers, unsupported questions or too many requests', () => {
    expect(setup({ hasViewers: () => false }).broker.open('a1', BASH)).toEqual({
      ok: false,
      skip: 'no-viewers',
    });
    const { broker, open } = setup();
    expect(broker.open('a1', { tool_name: 'AskUserQuestion' })).toEqual({
      ok: false,
      skip: 'unsupported',
    });
    for (let index = 0; index < MAX_PENDING; index += 1) open();
    expect(broker.open('a1', BASH)).toEqual({ ok: false, skip: 'too-many' });
  });

  it('rejects a malformed body', () => {
    expect(setup().broker.open('a1', { nope: 1 })).toEqual({ ok: false, invalid: true });
  });
});

describe('PermissionBroker.wait and decide', () => {
  it('hands the decision to a waiting hook', async () => {
    const { broker, open, messages, resolved } = setup();
    const id = open();
    const waiting = broker.wait('a1', id, 25_000);
    expect(broker.decide(id, { behavior: 'allow' })).toBeNull();
    await expect(waiting).resolves.toEqual({ status: 'decided', decision: { behavior: 'allow' } });
    expect(messages.at(-1)).toEqual({
      type: 'permission:resolved',
      requestId: id,
      agentId: 'a1',
      outcome: 'allowed',
    });
    expect(resolved).toEqual([['a1', 'allowed', { behavior: 'allow' }]]);
    expect(broker.list()).toEqual([]);
  });

  it('answers pending after the poll window', async () => {
    const { broker, open } = setup();
    const id = open();
    const waiting = broker.wait('a1', id, 60_000);
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS);
    await expect(waiting).resolves.toEqual({ status: 'pending' });
  });

  it('keeps a decision made between polls for the next one', async () => {
    const { broker, open, tick } = setup();
    const id = open();
    broker.decide(id, { behavior: 'deny', message: 'no' });
    await expect(broker.wait('a1', id, 1)).resolves.toEqual({
      status: 'decided',
      decision: { behavior: 'deny', message: 'no' },
    });
    expect(broker.wait('a1', id, 1)).toBeNull();
    const other = open();
    broker.decide(other, { behavior: 'terminal' });
    tick(DECIDED_KEEP_MS + 1);
    await broker.sweep(() => null);
    expect(broker.wait('a1', other, 1)).toBeNull();
  });

  it('only lets the owning agent wait', () => {
    const { broker, open } = setup();
    expect(broker.wait('a2', open(), 1)).toBeNull();
    expect(broker.wait('a1', 'missing', 1)).toBeNull();
  });

  it('hands a terminal choice back as released', async () => {
    const { broker, open, resolved } = setup();
    const id = open();
    const waiting = broker.wait('a1', id, 1_000);
    broker.decide(id, { behavior: 'terminal' });
    await expect(waiting).resolves.toEqual({ status: 'released' });
    expect(resolved).toEqual([['a1', 'terminal', null]]);
  });

  it('validates decisions against the request', () => {
    const { broker, open } = setup();
    expect(broker.decide('missing', { behavior: 'allow' })).toBe('PERMISSION_NOT_FOUND');
    const bash = open(SUGGESTED);
    expect(broker.decide(bash, { behavior: 'allow', suggestion: 3 })).toBe('INVALID_MESSAGE');
    expect(
      broker.decide(bash, { behavior: 'answer', answers: [{ question: 0, options: [0] }] }),
    ).toBe('INVALID_MESSAGE');
    expect(broker.decide(bash, { behavior: 'allow', suggestion: 0 })).toBeNull();
    const ask = open(ASK);
    expect(broker.decide(ask, { behavior: 'allow' })).toBe('INVALID_MESSAGE');
    expect(
      broker.decide(ask, { behavior: 'answer', answers: [{ question: 0, options: [0, 1] }] }),
    ).toBe('INVALID_MESSAGE');
    expect(
      broker.decide(ask, { behavior: 'answer', answers: [{ question: 0, options: [1] }] }),
    ).toBeNull();
  });

  it('reports answered and denied outcomes', () => {
    const { broker, open, resolved } = setup();
    broker.decide(open(ASK), { behavior: 'answer', answers: [{ question: 0, options: [0] }] });
    broker.decide(open(), { behavior: 'deny', interrupt: true });
    expect(resolved.map((entry) => entry[1])).toEqual(['answered', 'denied']);
  });
});

describe('PermissionBroker.release', () => {
  it('releases by agent, by matching call or by id', async () => {
    const { broker, open, resolved } = setup();
    const first = open(BASH, 'a1');
    const waiting = broker.wait('a1', first, 1_000);
    open({ tool_name: 'Bash', tool_input: { command: 'ls' } }, 'a1');
    open(BASH, 'a2');
    broker.releaseCall('a1', 'Bash', { command: 'npm test' });
    await expect(waiting).resolves.toEqual({ status: 'released' });
    broker.releaseCall('a1', 'Bash', { command: 'nope' });
    expect(broker.list().map((view) => view.agentId)).toEqual(['a1', 'a2']);
    broker.releaseAgent('a1');
    broker.release('missing');
    expect(broker.list().map((view) => view.agentId)).toEqual(['a2']);
    expect(resolved.every((entry) => entry[1] === 'released')).toBe(true);
  });
});

describe('PermissionBroker.sweep', () => {
  const session = (state: SessionEntry['state'], statusAt: number | null): SessionEntry => ({
    pid: 1,
    sessionId: 's',
    state,
    waitingFor: null,
    statusAt,
  });

  it('releases requests of gone agents, expired ones and orphans', async () => {
    const { broker, open, tick, context } = setup();
    open(BASH, 'gone');
    const orphan = open(BASH, 'a1');
    const watched = open(BASH, 'a2');
    void broker.wait('a2', watched, MAX_WAIT_MS);
    tick(ORPHAN_MS + 1);
    await broker.sweep((agentId) => (agentId === 'gone' ? null : context()));
    expect(broker.list().map((view) => view.id)).toEqual([watched]);
    expect(broker.wait('a1', orphan, 1)).not.toBeNull();
    tick(PERMISSION_TIMEOUT_MS);
    await broker.sweep(() => context());
    expect(broker.list()).toEqual([]);
  });

  it('releases a request answered in the console', async () => {
    const { broker, open, lines, context } = setup();
    open();
    const use = { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } };
    lines.push(JSON.stringify({ message: { content: [use] } }));
    await broker.sweep(() => context(null, '/t.jsonl'));
    expect(broker.list()).toHaveLength(1);
    lines.push(
      JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }),
    );
    await broker.sweep(() => context(null, '/t.jsonl'));
    expect(broker.list()).toEqual([]);
  });

  it('falls back to the session registry when the call is not in the transcript', async () => {
    const { broker, open, context } = setup();
    open();
    await broker.sweep(() => context(session('busy', 1_000 + SESSION_SETTLE_MS), '/t.jsonl'));
    await broker.sweep(() => context(session('waiting', 99_999)));
    await broker.sweep(() => context(session('busy', null)));
    expect(broker.list()).toHaveLength(1);
    await broker.sweep(() => context(session('busy', 1_000 + SESSION_SETTLE_MS + 1)));
    expect(broker.list()).toEqual([]);
  });

  it('keeps subagent requests and survives unreadable transcripts', async () => {
    const { broker, open, context } = setup({ readLines: () => Promise.reject(new Error('gone')) });
    open({ ...BASH, agent_id: 'x', agent_type: 'Explore' });
    open();
    await broker.sweep(() => context(session('busy', 99_999), '/t.jsonl'));
    expect(broker.list()).toHaveLength(2);
  });
});
