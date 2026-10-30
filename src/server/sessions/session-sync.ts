import type { AgentStatus, WaitingReason } from '../../shared/agent.js';
import type { SessionEntry } from './session-registry.js';

export interface SessionChange {
  status: AgentStatus;
  waitingFor: WaitingReason | null;
}

const BUSY: readonly AgentStatus[] = ['thinking', 'tool', 'waiting'];

export function reconcileSession(
  status: AgentStatus,
  lastSignalAt: number,
  entry: SessionEntry,
): SessionChange | null {
  if (status === 'offline' || status === 'starting') return null;
  if (entry.state === null || entry.statusAt === null || entry.statusAt <= lastSignalAt) {
    return null;
  }
  switch (entry.state) {
    case 'waiting':
      return status === 'waiting' ? null : { status: 'waiting', waitingFor: entry.waitingFor };
    case 'busy':
      return status === 'idle' || status === 'waiting'
        ? { status: 'thinking', waitingFor: null }
        : null;
    case 'idle':
      return BUSY.includes(status) ? { status: 'idle', waitingFor: null } : null;
  }
}
