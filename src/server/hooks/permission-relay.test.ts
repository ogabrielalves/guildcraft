import { describe, expect, it, vi } from 'vitest';
import type { PermissionInput } from './permission-relay.js';
import {
  DENY_PREFIX,
  MAX_BODY_LENGTH,
  MAX_INPUT_STRING,
  answersFor,
  decisionOutput,
  parsePermissionInput,
  relayPermission,
  requestBody,
  trimInput,
} from './permission-relay.js';

const BASH: PermissionInput = {
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }] }],
};

const ASK: PermissionInput = {
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      { question: 'Which db?', options: [{ label: 'Postgres' }, { label: 'Mongo' }] },
      { question: 'Langs?', multiSelect: true, options: [{ label: 'TS' }, { label: 'Go' }] },
    ],
  },
};

function decision(text: string | null) {
  return text === null ? null : (JSON.parse(text) as { hookSpecificOutput: { decision: unknown } });
}

describe('parsePermissionInput', () => {
  it('reads a permission request', () => {
    expect(
      parsePermissionInput(
        '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":[]}',
      ),
    ).toEqual({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} });
  });

  it.each(['', 'x', '[]', '{"tool_name":""}', '{"tool_name":"Bash","hook_event_name":"Stop"}'])(
    'rejects %j',
    (text) => {
      expect(parsePermissionInput(text)).toBeNull();
    },
  );
});

describe('requestBody', () => {
  it('sends only what the server reads', () => {
    expect(
      requestBody({
        ...BASH,
        agent_id: 'sub',
        agent_type: 'Explore',
        session_id: 's',
      } as PermissionInput),
    ).toEqual({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      permission_suggestions: BASH.permission_suggestions,
      agent_id: 'sub',
      agent_type: 'Explore',
    });
  });

  it('cuts strings harder until the body fits', () => {
    const edits = Array.from({ length: 100 }, () => ({ text: 'x'.repeat(MAX_INPUT_STRING) }));
    const body = requestBody({ tool_name: 'MultiEdit', tool_input: { edits } });
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
  });

  it('trims nested input but keeps other values', () => {
    expect(trimInput({ a: ['xyz', 1, null], b: true }, 2)).toEqual({ a: ['xy', 1, null], b: true });
  });
});

describe('answersFor', () => {
  it('maps positions to the original labels', () => {
    expect(
      answersFor(
        [
          { question: 0, options: [1] },
          { question: 1, options: [0, 1], other: ' Rust ' },
        ],
        ASK.tool_input,
      ),
    ).toEqual({ 'Which db?': 'Mongo', 'Langs?': 'TS, Go, Rust' });
  });

  it.each([
    [[{ question: 0, options: [0] }]],
    [
      [
        { question: 0, options: [0, 1] },
        { question: 1, options: [0] },
      ],
    ],
    [
      [
        { question: 0, options: [7] },
        { question: 1, options: [0] },
      ],
    ],
    [
      [
        { question: 0, options: [] },
        { question: 1, options: [0] },
      ],
    ],
    [
      [
        { question: 5, options: [0] },
        { question: 1, options: [0] },
      ],
    ],
    [
      [
        { question: 0, options: [0] },
        { question: 0, options: [1] },
      ],
    ],
  ])('refuses %j', (answers) => {
    expect(answersFor(answers, ASK.tool_input)).toBeNull();
  });

  it('refuses input without questions', () => {
    expect(answersFor([{ question: 0, options: [0] }], {})).toBeNull();
  });
});

describe('decisionOutput', () => {
  it('allows, with the chosen suggestion when given', () => {
    expect(decision(decisionOutput({ behavior: 'allow' }, BASH))).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    expect(
      decision(decisionOutput({ behavior: 'allow', suggestion: 0 }, BASH))?.hookSpecificOutput
        .decision,
    ).toEqual({
      behavior: 'allow',
      updatedPermissions: [
        BASH.permission_suggestions && (BASH.permission_suggestions as unknown[])[0],
      ],
    });
    expect(
      decision(decisionOutput({ behavior: 'allow', suggestion: 4 }, BASH))?.hookSpecificOutput
        .decision,
    ).toEqual({
      behavior: 'allow',
    });
  });

  it('denies with a message and an optional interrupt', () => {
    expect(
      decision(decisionOutput({ behavior: 'deny' }, BASH))?.hookSpecificOutput.decision,
    ).toEqual({
      behavior: 'deny',
      message: `${DENY_PREFIX}.`,
    });
    expect(
      decision(decisionOutput({ behavior: 'deny', message: 'no', interrupt: true }, BASH))
        ?.hookSpecificOutput.decision,
    ).toEqual({ behavior: 'deny', message: `${DENY_PREFIX}: no`, interrupt: true });
  });

  it('answers questions through updatedInput', () => {
    const out = decisionOutput(
      {
        behavior: 'answer',
        answers: [
          { question: 0, options: [0] },
          { question: 1, options: [1] },
        ],
      },
      ASK,
    );
    expect(decision(out)?.hookSpecificOutput.decision).toEqual({
      behavior: 'allow',
      updatedInput: { ...ASK.tool_input, answers: { 'Which db?': 'Postgres', 'Langs?': 'Go' } },
    });
  });

  it('stays silent for terminal, bad answers and plain allows on questions', () => {
    expect(decisionOutput({ behavior: 'terminal' }, BASH)).toBeNull();
    expect(decisionOutput({ behavior: 'allow' }, ASK)).toBeNull();
    expect(
      decisionOutput({ behavior: 'answer', answers: [{ question: 0, options: [0] }] }, BASH),
    ).toBeNull();
    expect(
      decisionOutput({ behavior: 'answer', answers: [{ question: 0, options: [0] }] }, ASK),
    ).toBeNull();
  });
});

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status });
}

describe('relayPermission', () => {
  const base = { port: 7777, agentId: 'a1', token: 'secret', stdin: JSON.stringify(BASH) };

  it('registers, polls until decided and prints the decision', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(respond(201, { id: 'p 1' }))
      .mockResolvedValueOnce(respond(200, { status: 'pending' }))
      .mockResolvedValueOnce(respond(200, { status: 'decided', decision: { behavior: 'allow' } }));
    const out = await relayPermission({ ...base, fetch });
    expect(decision(out)?.hookSpecificOutput.decision).toEqual({ behavior: 'allow' });
    expect(fetch.mock.calls.map((call) => call[0] as string)).toEqual([
      'http://127.0.0.1:7777/hook/a1/permission',
      'http://127.0.0.1:7777/hook/a1/permission/p%201?timeout=25',
      'http://127.0.0.1:7777/hook/a1/permission/p%201?timeout=25',
    ]);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-guildcraft-token': 'secret',
    });
  });

  it.each([
    ['a skipped request', [respond(200, { skip: 'no-viewers' })]],
    ['a server error', [respond(500, 'x')]],
    ['a released request', [respond(201, { id: 'p1' }), respond(200, { status: 'released' })]],
    [
      'a lost request',
      [respond(201, { id: 'p1' }), respond(404, { code: 'PERMISSION_NOT_FOUND' })],
    ],
    ['an odd reply', [respond(201, { id: 'p1' }), respond(200, { status: 'decided' })]],
    ['garbage', [respond(201, { id: 'p1' }), new Response('not json', { status: 200 })]],
  ])('stays silent on %s', async (_name, replies) => {
    const fetch = vi.fn();
    for (const reply of replies) fetch.mockResolvedValueOnce(reply);
    await expect(relayPermission({ ...base, fetch })).resolves.toBeNull();
  });

  it('stays silent when the server is down or the input is bad', async () => {
    const down = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(relayPermission({ ...base, fetch: down })).resolves.toBeNull();
    const unused = vi.fn();
    await expect(relayPermission({ ...base, stdin: 'x', fetch: unused })).resolves.toBeNull();
    expect(unused).not.toHaveBeenCalled();
  });

  it('gives up at the deadline', async () => {
    let clock = 0;
    const fetch = vi.fn(() => {
      clock += 30_000;
      return Promise.resolve(
        clock === 30_000 ? respond(201, { id: 'p1' }) : respond(200, { status: 'pending' }),
      );
    });
    const out = await relayPermission({ ...base, fetch, now: () => clock, deadlineMs: 60_000 });
    expect(out).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
