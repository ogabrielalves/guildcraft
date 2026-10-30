import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../shared/agent.js';
import type { SessionEntry } from './session-registry.js';
import { reconcileSession } from './session-sync.js';

function entry(state: SessionEntry['state'], statusAt: number | null = 100): SessionEntry {
  return {
    pid: 1,
    sessionId: 's',
    state,
    waitingFor: state === 'waiting' ? 'permission' : null,
    statusAt,
  };
}

describe('reconcileSession', () => {
  it.each<[AgentStatus, SessionEntry['state'], ReturnType<typeof reconcileSession>]>([
    ['thinking', 'waiting', { status: 'waiting', waitingFor: 'permission' }],
    ['waiting', 'waiting', null],
    ['idle', 'busy', { status: 'thinking', waitingFor: null }],
    ['waiting', 'busy', { status: 'thinking', waitingFor: null }],
    ['tool', 'busy', null],
    ['tool', 'idle', { status: 'idle', waitingFor: null }],
    ['waiting', 'idle', { status: 'idle', waitingFor: null }],
    ['idle', 'idle', null],
  ])('%s + registry %s', (status, state, expected) => {
    expect(reconcileSession(status, 50, entry(state))).toEqual(expected);
  });

  it('ignores entries older than the last local signal', () => {
    expect(reconcileSession('thinking', 100, entry('idle', 100))).toBeNull();
    expect(reconcileSession('thinking', 50, entry('idle', null))).toBeNull();
    expect(reconcileSession('thinking', 50, entry(null))).toBeNull();
  });

  it('leaves offline and starting agents alone', () => {
    expect(reconcileSession('offline', 0, entry('busy'))).toBeNull();
    expect(reconcileSession('starting', 0, entry('idle'))).toBeNull();
  });
});
