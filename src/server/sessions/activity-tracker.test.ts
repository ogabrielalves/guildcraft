import { describe, expect, it } from 'vitest';
import { emptyActivity } from '../../shared/activity.js';
import { ActivityTracker } from './activity-tracker.js';
import type { TailFile } from './transcript-tail.js';

function files(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  const open = (path: string): Promise<TailFile> => {
    if (!data.has(path)) return Promise.reject(new Error('ENOENT'));
    const bytes = () => Buffer.from(data.get(path) ?? '');
    return Promise.resolve({
      size: () => Promise.resolve(bytes().length),
      read: (start, length) => Promise.resolve(bytes().subarray(start, start + length)),
      close: () => Promise.resolve(),
    });
  };
  return { data, open };
}

const call = (id: string) =>
  `${JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-30T10:00:00.000Z',
    message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/a.ts' } }] },
  })}\n`;
const title = (value: string) => `${JSON.stringify({ type: 'ai-title', aiTitle: value })}\n`;
const todo = `${JSON.stringify({
  type: 'assistant',
  message: {
    content: [
      { type: 'tool_use', id: 'w', name: 'TodoWrite', input: { todos: [{ content: 'x' }] } },
    ],
  },
})}\n`;

describe('ActivityTracker', () => {
  it('starts empty and reports only changes', async () => {
    const fs = files({ '/s1.jsonl': call('t1') });
    const tracker = new ActivityTracker(fs.open);
    expect(tracker.get('a1')).toEqual(emptyActivity('a1'));
    const first = await tracker.poll('a1', '/s1.jsonl');
    expect(first?.actions.map((action) => action.id)).toEqual(['t1']);
    expect(tracker.get('a1')).toBe(first);
    expect(await tracker.poll('a1', '/s1.jsonl')).toBeNull();
    fs.data.set('/s1.jsonl', call('t1') + title('Fix login'));
    expect(await tracker.poll('a1', '/s1.jsonl')).toMatchObject({ title: 'Fix login' });
  });

  it('keeps the history but clears title and tasks on a new session', async () => {
    const fs = files({ '/s1.jsonl': call('t1') + title('Old') + todo, '/s2.jsonl': '' });
    const tracker = new ActivityTracker(fs.open);
    await tracker.poll('a1', '/s1.jsonl');
    expect(await tracker.poll('a1', '/s2.jsonl')).toMatchObject({
      title: null,
      tasks: [],
      actions: [{ id: 't1' }],
    });
  });

  it('stays quiet on a new session when there was nothing to clear', async () => {
    const fs = files({ '/s1.jsonl': call('t1'), '/s2.jsonl': '' });
    const tracker = new ActivityTracker(fs.open);
    await tracker.poll('a1', '/s1.jsonl');
    expect(await tracker.poll('a1', '/s2.jsonl')).toBeNull();
    expect(tracker.get('a1').actions).toHaveLength(1);
  });

  it('reports the cleared state even when the new file is not there yet', async () => {
    const fs = files({ '/s1.jsonl': title('Old') });
    const tracker = new ActivityTracker(fs.open);
    await tracker.poll('a1', '/s1.jsonl');
    expect(await tracker.poll('a1', '/missing.jsonl')).toMatchObject({ title: null });
    expect(await tracker.poll('a1', '/missing.jsonl')).toBeNull();
  });

  it('rebuilds from the file when it is rewritten', async () => {
    const fs = files({ '/s1.jsonl': call('t1') + title('Old') });
    const tracker = new ActivityTracker(fs.open);
    await tracker.poll('a1', '/s1.jsonl');
    fs.data.set('/s1.jsonl', call('t2'));
    expect(await tracker.poll('a1', '/s1.jsonl')).toMatchObject({
      title: null,
      actions: [{ id: 't2' }, { id: 't1' }],
    });
  });

  it('drops a removed agent, including a poll in flight', async () => {
    const fs = files({ '/s1.jsonl': call('t1') });
    const tracker = new ActivityTracker(fs.open);
    const pending = tracker.poll('a1', '/s1.jsonl');
    tracker.remove('a1');
    expect(await pending).toBeNull();
    expect(tracker.get('a1').actions).toEqual([]);
  });
});
