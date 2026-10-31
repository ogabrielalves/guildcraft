import { describe, expect, it } from 'vitest';
import type { AgentAction } from '../../shared/activity.js';
import { MAX_ACTIONS, MAX_TASKS } from '../../shared/activity.js';
import { MAX_RESULT_LENGTH, TranscriptActivity } from './transcript-activity.js';

const T0 = '2026-10-30T10:00:00.000Z';
const T1 = '2026-10-30T10:00:05.000Z';

function call(id: string, name: string, input: unknown, extra: object = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: T0,
    message: { content: [{ type: 'tool_use', id, name, input }] },
    ...extra,
  });
}

function result(id: string, content: unknown, extra: object = {}, isError = false): string {
  return JSON.stringify({
    type: 'user',
    timestamp: T1,
    message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
    ...extra,
  });
}

function parsed(...lines: string[]): TranscriptActivity {
  const activity = new TranscriptActivity();
  for (const line of lines) activity.feed(line);
  return activity;
}

function reply(id: string, usage: object, extra: object = {}, timestamp = T0): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { id, content: [{ type: 'text', text: 'ok' }], usage },
    ...extra,
  });
}

describe('TranscriptActivity usage', () => {
  it('sums usage per message and keeps only the last line of a streamed message', () => {
    const activity = parsed(
      reply('m1', { input_tokens: 10, output_tokens: 1 }),
      reply('m1', { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 500 }),
      reply('m2', { input_tokens: 5, output_tokens: 7, cache_creation_input_tokens: 100 }),
    );
    expect(activity.takeChanged()).toBe(true);
    expect(activity.snapshot().usage).toEqual({
      input: 15,
      output: 47,
      cacheRead: 500,
      cacheWrite: 100,
    });
  });

  it('ignores sidechains, lines before the cutoff and malformed counts', () => {
    const activity = new TranscriptActivity([], undefined, Date.parse(T1));
    activity.feed(reply('old', { input_tokens: 99 }));
    activity.feed(reply('side', { input_tokens: 99 }, { isSidechain: true }, T1));
    activity.feed(reply('bad', { input_tokens: 'x', output_tokens: -3 }, {}, T1));
    expect(activity.snapshot().usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('continues from a previous total', () => {
    const activity = new TranscriptActivity([], {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
    });
    activity.feed(reply('m1', { input_tokens: 10, output_tokens: 10 }));
    expect(activity.snapshot().usage).toEqual({
      input: 11,
      output: 12,
      cacheRead: 3,
      cacheWrite: 4,
    });
  });
});

describe('TranscriptActivity actions', () => {
  it('records a running tool call with a readable label', () => {
    const activity = parsed(call('t1', 'Edit', { file_path: '/repo/src/app.ts' }));
    expect(activity.takeChanged()).toBe(true);
    expect(activity.snapshot().actions).toEqual([
      {
        id: 't1',
        tool: 'Edit',
        detail: 'app.ts',
        state: 'running',
        result: null,
        startedAt: Date.parse(T0),
        endedAt: null,
      },
    ]);
    expect(activity.takeChanged()).toBe(false);
  });

  it('keeps the last stdout line of a shell command as its result', () => {
    const activity = parsed(
      call('t1', 'Bash', { command: 'npm test' }),
      result('t1', 'ignored', { toolUseResult: { stdout: 'running\n\nTests 12 passed\n' } }),
    );
    expect(activity.snapshot().actions[0]).toMatchObject({
      state: 'done',
      result: 'Tests 12 passed',
      endedAt: Date.parse(T1),
    });
  });

  it('falls back to the result text for a shell command without stdout', () => {
    const activity = parsed(
      call('t1', 'PowerShell', { command: 'ls' }),
      result('t1', [{ type: 'text', text: 'a.txt\nb.txt' }]),
    );
    expect(activity.snapshot().actions[0]?.result).toBe('b.txt');
  });

  it('keeps the first line of a search and nothing for other tools', () => {
    const activity = parsed(
      call('g', 'Grep', { pattern: 'todo' }),
      call('r', 'Read', { file_path: '/a.ts' }),
      result('g', 'Found 3 files\na.ts'),
      result('r', '1\tconst a = 1;'),
    );
    const [read, grep] = activity.snapshot().actions;
    expect(grep?.result).toBe('Found 3 files');
    expect(read).toMatchObject({ state: 'done', result: null });
  });

  it('marks errors with their first line, masked and clipped', () => {
    const long = `TOKEN=abc ${'x'.repeat(300)}`;
    const activity = parsed(
      call('t1', 'Bash', { command: 'deploy' }),
      result('t1', `<tool_use_error>${long}</tool_use_error>\nmore`, {}, true),
    );
    const action = activity.snapshot().actions[0];
    expect(action?.state).toBe('error');
    expect(action?.result?.startsWith('TOKEN=*** x')).toBe(true);
    expect(Array.from(action?.result ?? '')).toHaveLength(MAX_RESULT_LENGTH);
  });

  it('marks rejected calls', () => {
    const activity = parsed(
      call('t1', 'Write', { file_path: '/a.ts' }),
      result('t1', "The user doesn't want to proceed with this tool use.", {}, true),
    );
    expect(activity.snapshot().actions[0]).toMatchObject({ state: 'rejected', result: null });
  });

  it('marks running calls as interrupted when the user stops the turn', () => {
    const activity = parsed(
      call('a', 'Bash', { command: 'sleep 9' }),
      call('b', 'Read', { file_path: '/a.ts' }),
      result('b', 'ok'),
      JSON.stringify({
        type: 'user',
        timestamp: T1,
        message: { content: '[Request interrupted by user for tool use]' },
      }),
    );
    const [b, a] = activity.snapshot().actions;
    expect(a).toMatchObject({ state: 'interrupted', endedAt: Date.parse(T1) });
    expect(b?.state).toBe('done');
  });

  it('marks an errored result inside an interrupted turn as interrupted', () => {
    const activity = parsed(
      call('a', 'Bash', { command: 'sleep 9' }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'a', content: 'stopped', is_error: true },
            { type: 'text', text: '[Request interrupted by user for tool use]' },
          ],
        },
      }),
    );
    expect(activity.snapshot().actions[0]?.state).toBe('interrupted');
  });

  it('ignores sidechains, duplicates, unknown results and broken lines', () => {
    const activity = parsed(
      call('s', 'Bash', { command: 'x' }, { isSidechain: true }),
      call('t1', 'Bash', { command: 'first' }),
      call('t1', 'Bash', { command: 'again' }),
      result('nope', 'x'),
      result('t1', 'done'),
      result('t1', 'twice', {}, true),
      '{"tool_use" broken',
      JSON.stringify({ type: 'assistant', message: { content: 'text tool_use' } }),
      JSON.stringify({ type: 'user', message: null, x: '"tool_result"' }),
      JSON.stringify({ type: 'system', content: '"tool_use"' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x' }] } }),
    );
    expect(activity.snapshot().actions).toMatchObject([
      { id: 't1', detail: 'first', state: 'done' },
    ]);
  });

  it('uses the current time when a line has no timestamp', () => {
    const activity = parsed(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't', name: 'Read', input: {} }] },
      }),
    );
    expect(activity.snapshot().actions[0]?.startedAt).toBeGreaterThan(Date.parse(T0));
  });

  it('keeps only the newest actions, newest first', () => {
    const lines = Array.from({ length: MAX_ACTIONS + 5 }, (_, index) =>
      call(`t${index}`, 'Read', { file_path: `/f${index}.ts` }),
    );
    const { actions } = parsed(...lines).snapshot();
    expect(actions).toHaveLength(MAX_ACTIONS);
    expect(actions[0]?.id).toBe(`t${MAX_ACTIONS + 4}`);
    expect(actions.at(-1)?.id).toBe('t5');
  });

  it('starts from previous actions', () => {
    const previous: AgentAction[] = [
      {
        id: 'old',
        tool: 'Read',
        detail: 'a.ts',
        state: 'done',
        result: null,
        startedAt: 1,
        endedAt: 2,
      },
    ];
    const activity = new TranscriptActivity(previous);
    activity.feed(call('new', 'Bash', { command: 'ls' }));
    expect(activity.snapshot().actions.map((action) => action.id)).toEqual(['new', 'old']);
  });
});

describe('TranscriptActivity title', () => {
  const title = (type: string, key: string, value: unknown) =>
    JSON.stringify({ type, [key]: value, sessionId: 's' });

  it('prefers custom title, then agent name, then ai title', () => {
    const activity = parsed(title('ai-title', 'aiTitle', 'Fix the login'));
    expect(activity.snapshot().title).toBe('Fix the login');
    activity.feed(title('agent-name', 'agentName', 'Login work'));
    expect(activity.snapshot().title).toBe('Login work');
    activity.feed(title('custom-title', 'customTitle', 'Auth'));
    activity.feed(title('ai-title', 'aiTitle', 'Something else'));
    expect(activity.snapshot().title).toBe('Auth');
  });

  it('ignores empty and repeated titles', () => {
    const activity = parsed(title('ai-title', 'aiTitle', 'Same'));
    activity.takeChanged();
    activity.feed(title('ai-title', 'aiTitle', 'Same'));
    activity.feed(title('ai-title', 'aiTitle', '  '));
    activity.feed(title('custom-title', 'customTitle', 3));
    expect(activity.takeChanged()).toBe(false);
    expect(activity.snapshot().title).toBe('Same');
  });
});

describe('TranscriptActivity tasks', () => {
  it('replaces the list on TodoWrite and keeps task tools out of the history', () => {
    const activity = parsed(
      call('w', 'TodoWrite', {
        todos: [
          { content: 'Write tests', status: 'completed' },
          { content: 'Ship', status: 'in_progress', id: 7 },
          { content: '', status: 'pending' },
          { subject: 'Review', status: 'weird' },
          'junk',
        ],
      }),
    );
    expect(activity.snapshot()).toMatchObject({
      actions: [],
      tasks: [
        { id: '1', title: 'Write tests', status: 'completed' },
        { id: '7', title: 'Ship', status: 'in_progress' },
        { id: '4', title: 'Review', status: 'pending' },
      ],
    });
  });

  it('ignores a TodoWrite without a list', () => {
    const activity = parsed(call('w', 'TodoWrite', { todos: 'nope' }), call('x', 'TaskList', null));
    expect(activity.takeChanged()).toBe(false);
  });

  it('creates tasks and swaps in the real id from the result', () => {
    const activity = parsed(
      call('c1', 'TaskCreate', { subject: 'Add tests' }),
      call('c2', 'TaskCreate', { description: 'Fix bug' }),
      call('c3', 'TaskCreate', { subject: 'Same id' }),
      call('c4', 'TaskCreate', {}),
      result('c1', 'created', { toolUseResult: { task: { id: 3 } } }),
      result('c2', 'Task #9 created'),
      result('c3', 'created', { toolUseResult: { taskId: 'pending:c3' } }),
    );
    expect(activity.snapshot().tasks).toEqual([
      { id: '3', title: 'Add tests', status: 'pending' },
      { id: '9', title: 'Fix bug', status: 'pending' },
      { id: 'pending:c3', title: 'Same id', status: 'pending' },
    ]);
  });

  it('keeps the provisional id when the result has none', () => {
    const activity = parsed(call('c1', 'TaskCreate', { subject: 'A' }), result('c1', 'ok'));
    expect(activity.snapshot().tasks[0]?.id).toBe('pending:c1');
  });

  it('updates status and subject, and deletes tasks', () => {
    const activity = parsed(
      call('c1', 'TaskCreate', { subject: 'A' }),
      result('c1', 'Task #1'),
      call('c2', 'TaskCreate', { subject: 'B' }),
      result('c2', 'Task #2'),
      call('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress', subject: 'A2' }),
      call('u2', 'TaskUpdate', { taskId: 2, status: 'deleted' }),
      call('u3', 'TaskUpdate', { taskId: '5', status: 'completed' }),
      call('u4', 'TaskUpdate', { status: 'completed' }),
      call('u5', 'TaskUpdate', { taskId: '1', status: 'bogus' }),
    );
    expect(activity.snapshot().tasks).toEqual([{ id: '1', title: 'A2', status: 'in_progress' }]);
  });

  it('keeps a bounded list', () => {
    const todos = Array.from({ length: MAX_TASKS + 3 }, (_, index) => ({ content: `t${index}` }));
    const { tasks } = parsed(call('w', 'TodoWrite', { todos })).snapshot();
    expect(tasks).toHaveLength(MAX_TASKS);
    expect(tasks[0]?.title).toBe('t3');
  });

  it('forgets the oldest pending creates', () => {
    const lines = Array.from({ length: 70 }, (_, index) =>
      call(`c${index}`, 'TaskCreate', { subject: `t${index}` }),
    );
    const activity = parsed(...lines, result('c0', 'Task #100'), result('c69', 'Task #200'));
    const ids = activity.snapshot().tasks.map((task) => task.id);
    expect(ids).not.toContain('100');
    expect(ids).toContain('200');
  });
});
