import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleOptions } from './lifecycle.js';
import { GRACE_MS, Lifecycle, SHUTDOWN_SIGNALS } from './lifecycle.js';

function setup(overrides: Partial<LifecycleOptions> = {}) {
  const logs: string[] = [];
  const options = {
    keepAlive: false,
    shutdown: vi.fn(() => Promise.resolve()),
    exit: vi.fn(),
    log: (message: string) => logs.push(message),
    ...overrides,
  };
  return { lifecycle: new Lifecycle(options), options, logs };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('grace period', () => {
  it('shuts down after the last client leaves and the grace period ends', async () => {
    const { lifecycle, options, logs } = setup();
    lifecycle.clientsChanged(1);
    lifecycle.clientsChanged(0);
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    expect(options.shutdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(options.shutdown).toHaveBeenCalledOnce();
    expect(options.exit).toHaveBeenCalledWith(0);
    expect(logs).toEqual(['shutting down: the ui closed']);
    expect(lifecycle.isStopping).toBe(true);
  });

  it('keeps running when a client comes back in time', async () => {
    const { lifecycle, options } = setup();
    lifecycle.clientsChanged(1);
    lifecycle.clientsChanged(0);
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    lifecycle.clientsChanged(1);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(options.shutdown).not.toHaveBeenCalled();
  });

  it('does not restart the countdown on repeated zero counts', async () => {
    const { lifecycle, options } = setup();
    lifecycle.clientsChanged(1);
    lifecycle.clientsChanged(0);
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    lifecycle.clientsChanged(0);
    await vi.advanceTimersByTimeAsync(GRACE_MS / 2);
    expect(options.shutdown).toHaveBeenCalledOnce();
  });

  it('waits for a first client before counting down', async () => {
    const { lifecycle, options } = setup();
    lifecycle.clientsChanged(0);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(options.shutdown).not.toHaveBeenCalled();
  });

  it('never shuts down on its own with keep-alive', async () => {
    const { lifecycle, options } = setup({ keepAlive: true });
    lifecycle.clientsChanged(1);
    lifecycle.clientsChanged(0);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(options.shutdown).not.toHaveBeenCalled();
  });

  it('honors a custom grace period', async () => {
    const { lifecycle, options } = setup({ graceMs: 10 });
    lifecycle.clientsChanged(1);
    lifecycle.clientsChanged(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(options.shutdown).toHaveBeenCalledOnce();
  });
});

describe('stop', () => {
  it('runs the shutdown once', async () => {
    const { lifecycle, options } = setup();
    await Promise.all([lifecycle.stop('a'), lifecycle.stop('b')]);
    expect(options.shutdown).toHaveBeenCalledOnce();
    expect(options.exit).toHaveBeenCalledOnce();
  });

  it('cancels a pending countdown', async () => {
    const { lifecycle, options } = setup();
    lifecycle.clientsChanged(1);
    lifecycle.clientsChanged(0);
    await lifecycle.stop('SIGINT');
    lifecycle.clientsChanged(0);
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    expect(options.shutdown).toHaveBeenCalledOnce();
  });

  it('exits with an error when the shutdown fails', async () => {
    const { lifecycle, options, logs } = setup({
      shutdown: () => Promise.reject(new Error('stuck')),
    });
    await lifecycle.stop('SIGTERM');
    expect(options.exit).toHaveBeenCalledWith(1);
    expect(logs).toEqual(['shutting down: SIGTERM', 'shutdown failed: Error: stuck']);
  });
});

describe('signals', () => {
  it.each(SHUTDOWN_SIGNALS)('stops on %s', async (signal) => {
    const { lifecycle, options, logs } = setup();
    const source = new EventEmitter();
    lifecycle.watchSignals(source);
    source.emit(signal);
    await vi.waitFor(() => {
      expect(options.exit).toHaveBeenCalledWith(0);
    });
    expect(logs[0]).toBe(`shutting down: ${signal}`);
  });

  it('forces the exit on a second signal', () => {
    const { lifecycle, options } = setup({ shutdown: () => new Promise(() => undefined) });
    const source = new EventEmitter();
    lifecycle.watchSignals(source);
    source.emit('SIGINT');
    expect(options.exit).not.toHaveBeenCalled();
    source.emit('SIGINT');
    expect(options.exit).toHaveBeenCalledWith(1);
  });

  it('removes its listeners', () => {
    const { lifecycle } = setup();
    const source = new EventEmitter();
    const unwatch = lifecycle.watchSignals(source);
    expect(source.listenerCount('SIGINT')).toBe(1);
    unwatch();
    for (const signal of SHUTDOWN_SIGNALS) expect(source.listenerCount(signal)).toBe(0);
  });
});
