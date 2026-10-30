import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEntry } from './session-registry.js';
import { SessionMonitor } from './session-monitor.js';

const ENTRY: SessionEntry = {
  pid: 1,
  sessionId: 's',
  state: 'idle',
  waitingFor: null,
  statusAt: 1,
};

function setup(read = vi.fn(() => Promise.resolve([ENTRY]))) {
  const manager = {
    syncSessions: vi.fn(),
    sweepPermissions: vi.fn(() => Promise.resolve()),
    syncActivity: vi.fn(() => Promise.resolve()),
  };
  const log = vi.fn();
  const monitor = new SessionMonitor({ manager, read, log, intervalMs: 1_000 });
  return { manager, log, monitor, read };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionMonitor', () => {
  it('syncs the registry, sweeps permissions and tails transcripts on each tick', async () => {
    const { manager, monitor } = setup();
    await monitor.tick();
    expect(manager.syncSessions).toHaveBeenCalledWith([ENTRY]);
    expect(manager.sweepPermissions).toHaveBeenCalledOnce();
    expect(manager.syncActivity).toHaveBeenCalledOnce();
  });

  it('never overlaps two polls', async () => {
    const { monitor, read } = setup();
    const first = monitor.tick();
    const second = monitor.tick();
    expect(first).toBe(second);
    await first;
    expect(read).toHaveBeenCalledOnce();
  });

  it('logs a failed poll and keeps going', async () => {
    const { monitor, log } = setup(vi.fn(() => Promise.reject(new Error('boom'))));
    await monitor.tick();
    expect(log).toHaveBeenCalledWith('sessions: poll failed: Error: boom');
  });

  it('polls on an interval until stopped', async () => {
    vi.useFakeTimers();
    const { monitor, read } = setup();
    monitor.start();
    monitor.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(read).toHaveBeenCalledTimes(2);
    await monitor.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
