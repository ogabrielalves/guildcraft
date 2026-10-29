import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue, SUBMIT_DELAY_MS, bracketedPaste, sanitizePrompt } from './message-queue.js';

function setup() {
  const written: string[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  const queue = new MessageQueue((data) => written.push(data), {
    submitDelayMs: 50,
    schedule: (callback, ms) => timers.push({ callback, ms }),
  });
  const flushTimers = () => {
    for (const timer of timers.splice(0)) timer.callback();
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
    expect(queue.enqueue({ fromId: 'a1', text: 'first' })).toBe(1);
    expect(queue.enqueue({ fromId: null, text: 'second' })).toBe(2);

    expect(queue.deliverNext()).toEqual({ fromId: 'a1', text: 'first' });
    expect(written).toEqual(['\x1b[200~first\x1b[201~']);
    expect(timers[0]?.ms).toBe(50);
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

  it('clears pending messages', () => {
    const { queue } = setup();
    queue.enqueue({ fromId: null, text: 'x' });
    queue.clear();
    expect(queue.size).toBe(0);
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
});
