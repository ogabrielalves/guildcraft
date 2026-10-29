import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_QUEUED } from '../../shared/constants.js';
import { MessageQueue, SUBMIT_DELAY_MS, bracketedPaste, sanitizePrompt } from './message-queue.js';

function setup(limit?: number) {
  const written: string[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let nextHandle = 1;
  const queue = new MessageQueue((data) => written.push(data), {
    submitDelayMs: 50,
    ...(limit === undefined ? {} : { limit }),
    schedule: (callback, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { callback, ms });
      return handle;
    },
    cancel: (handle) => timers.delete(handle as number),
  });
  const flushTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    for (const timer of pending) timer.callback();
  };
  return { queue, written, timers, flushTimers };
}

describe('sanitizePrompt', () => {
  it('normalizes line endings and keeps tabs', () => {
    expect(sanitizePrompt('a\r\nb\rc\td')).toBe('a\nb\nc\td');
  });

  it('removes escape sequences that could end the paste early', () => {
    expect(sanitizePrompt('x\x1b[201~rm -rf\x07\x00y')).toBe('x[201~rm -rfy');
  });

  it('removes C1 controls such as the 8-bit CSI', () => {
    expect(sanitizePrompt('a\x9b201~b\x85c')).toBe('a201~bc');
  });
});

describe('bracketedPaste', () => {
  it('wraps the text in paste markers', () => {
    expect(bracketedPaste('run tests')).toBe('\x1b[200~run tests\x1b[201~');
  });
});

describe('MessageQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers in order, pasting first and submitting after the delay', () => {
    const { queue, written, timers, flushTimers } = setup();
    expect(queue.enqueue({ fromId: 'a1', text: 'first' })).toEqual({ ok: true, size: 1 });
    expect(queue.enqueue({ fromId: null, text: 'second' })).toEqual({ ok: true, size: 2 });

    expect(queue.deliverNext()).toEqual({ fromId: 'a1', text: 'first' });
    expect(written).toEqual(['\x1b[200~first\x1b[201~']);
    expect([...timers.values()][0]?.ms).toBe(50);
    flushTimers();
    expect(written).toEqual(['\x1b[200~first\x1b[201~', '\r']);
    expect(queue.size).toBe(1);

    expect(queue.deliverNext()?.text).toBe('second');
    expect(queue.size).toBe(0);
  });

  it('returns null when empty', () => {
    const { queue, written } = setup();
    expect(queue.deliverNext()).toBeNull();
    expect(written).toEqual([]);
  });

  it.each(['', '   ', '\x1b\x07', '\r\n'])('rejects the empty prompt %j', (text) => {
    const { queue } = setup();
    expect(queue.enqueue({ fromId: null, text })).toEqual({ ok: false, code: 'EMPTY_PROMPT' });
    expect(queue.size).toBe(0);
  });

  it('rejects messages beyond the limit', () => {
    const { queue } = setup(2);
    queue.enqueue({ fromId: null, text: 'a' });
    queue.enqueue({ fromId: null, text: 'b' });
    expect(queue.enqueue({ fromId: null, text: 'c' })).toEqual({ ok: false, code: 'QUEUE_FULL' });
    expect(queue.size).toBe(2);
  });

  it(`defaults to ${MAX_QUEUED} queued messages`, () => {
    const { queue } = setup();
    for (let i = 0; i < MAX_QUEUED; i++) queue.enqueue({ fromId: null, text: `m${i}` });
    expect(queue.enqueue({ fromId: null, text: 'extra' })).toMatchObject({ ok: false });
  });

  it('clears pending messages and cancels a scheduled submit', () => {
    const { queue, written, timers, flushTimers } = setup();
    queue.enqueue({ fromId: null, text: 'x' });
    queue.enqueue({ fromId: null, text: 'y' });
    queue.deliverNext();
    queue.clear();
    expect(queue.size).toBe(0);
    expect(timers.size).toBe(0);
    flushTimers();
    expect(written).not.toContain('\r');
  });

  it('does not cancel anything after the submit already ran', () => {
    const cancel = vi.fn();
    let submit: (() => void) | null = null;
    const queue = new MessageQueue(() => undefined, {
      schedule: (callback) => {
        submit = callback;
        return 1;
      },
      cancel,
    });
    queue.enqueue({ fromId: null, text: 'x' });
    queue.deliverNext();
    (submit as (() => void) | null)?.();
    queue.clear();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('uses setTimeout with the default delay', () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const queue = new MessageQueue((data) => written.push(data));
    queue.enqueue({ fromId: null, text: 'hi' });
    queue.deliverNext();
    vi.advanceTimersByTime(SUBMIT_DELAY_MS - 1);
    expect(written).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(written.at(-1)).toBe('\r');
  });

  it('cancels the default timer on clear', () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const queue = new MessageQueue((data) => written.push(data));
    queue.enqueue({ fromId: null, text: 'hi' });
    queue.deliverNext();
    queue.clear();
    vi.advanceTimersByTime(SUBMIT_DELAY_MS);
    expect(written).toHaveLength(1);
  });
});
