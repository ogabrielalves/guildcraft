import { describe, expect, it, vi } from 'vitest';
import type { AgentView, VillageEvent } from '../../shared/agent.js';
import {
  INITIAL_STATE,
  MAX_EVENTS,
  Store,
  addEvent,
  applyServerMessage,
  clearSelection,
  focusAgent,
  initSession,
  removeAgent,
  selectAgent,
  setConnection,
  upsertAgent,
} from './store.js';
import type { StoreState } from './store.js';

function agent(id: string, overrides: Partial<AgentView> = {}): AgentView {
  return {
    id,
    name: id,
    cwd: `/projects/${id}`,
    skin: 'mortis',
    status: 'idle',
    permissionMode: 'default',
    tool: null,
    queued: 0,
    ...overrides,
  };
}

function event(at: number): VillageEvent {
  return { kind: 'joined', agentId: 'a', at };
}

function withAgents(...ids: string[]): StoreState {
  return { ...INITIAL_STATE, agents: ids.map((id) => agent(id)) };
}

describe('upsertAgent', () => {
  it('appends a new agent', () => {
    const state = upsertAgent(withAgents('a'), agent('b'));
    expect(state.agents.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('replaces an existing agent in place', () => {
    const state = upsertAgent(withAgents('a', 'b'), agent('a', { status: 'thinking' }));
    expect(state.agents.map((a) => a.id)).toEqual(['a', 'b']);
    expect(state.agents[0]?.status).toBe('thinking');
  });
});

describe('removeAgent', () => {
  it('drops the agent from selection and focus', () => {
    const state = removeAgent({ ...withAgents('a', 'b'), selected: ['a', 'b'], focused: 'a' }, 'a');
    expect(state.agents.map((a) => a.id)).toEqual(['b']);
    expect(state.selected).toEqual(['b']);
    expect(state.focused).toBeNull();
  });

  it('keeps focus on another agent', () => {
    const state = removeAgent({ ...withAgents('a', 'b'), selected: ['b'], focused: 'b' }, 'a');
    expect(state.focused).toBe('b');
  });
});

describe('addEvent', () => {
  it('keeps only the latest events', () => {
    let state = INITIAL_STATE;
    for (let i = 0; i < MAX_EVENTS + 5; i++) state = addEvent(state, event(i));
    expect(state.events).toHaveLength(MAX_EVENTS);
    expect(state.events[0]?.at).toBe(5);
  });
});

describe('initSession', () => {
  it('replaces agents, events and skins and prunes stale selection', () => {
    const previous = { ...withAgents('a', 'b'), selected: ['a', 'b'], focused: 'a' };
    const state = initSession(previous, [agent('b'), agent('c')], [event(1)], ['mortis']);
    expect(state.agents.map((a) => a.id)).toEqual(['b', 'c']);
    expect(state.events).toEqual([event(1)]);
    expect(state.skins).toEqual(['mortis']);
    expect(state.selected).toEqual(['b']);
    expect(state.focused).toBeNull();
  });

  it('keeps focus when the agent still exists', () => {
    const state = initSession({ ...withAgents('a'), focused: 'a' }, [agent('a')], [], []);
    expect(state.focused).toBe('a');
  });
});

describe('selectAgent', () => {
  const base = withAgents('a', 'b', 'c');

  it('ignores unknown agents', () => {
    expect(selectAgent(base, 'x', 'replace')).toBe(base);
  });

  it('replaces the selection and focuses', () => {
    const state = selectAgent({ ...base, selected: ['b'] }, 'a', 'replace');
    expect(state.selected).toEqual(['a']);
    expect(state.focused).toBe('a');
  });

  it('adds without duplicating', () => {
    const once = selectAgent(base, 'a', 'add');
    expect(once.selected).toEqual(['a']);
    expect(selectAgent(once, 'a', 'add')).toBe(once);
  });

  it('toggles agents in and out', () => {
    const added = selectAgent({ ...base, selected: ['a'], focused: 'a' }, 'b', 'toggle');
    expect(added.selected).toEqual(['a', 'b']);
    expect(added.focused).toBe('a');
    const removed = selectAgent(added, 'b', 'toggle');
    expect(removed.selected).toEqual(['a']);
  });

  it('moves focus to the last selected when toggling off the focused agent', () => {
    const state = selectAgent({ ...base, selected: ['a', 'b', 'c'], focused: 'c' }, 'c', 'toggle');
    expect(state.focused).toBe('b');
    const empty = selectAgent({ ...base, selected: ['a'], focused: 'a' }, 'a', 'toggle');
    expect(empty.focused).toBeNull();
  });
});

describe('focusAgent', () => {
  const base = withAgents('a', 'b');

  it('clears focus but keeps selection', () => {
    const state = focusAgent({ ...base, selected: ['a'], focused: 'a' }, null);
    expect(state.focused).toBeNull();
    expect(state.selected).toEqual(['a']);
  });

  it('ignores unknown agents', () => {
    expect(focusAgent(base, 'x')).toBe(base);
  });

  it('keeps a selection that already contains the agent', () => {
    const state = focusAgent({ ...base, selected: ['a', 'b'] }, 'b');
    expect(state.selected).toEqual(['a', 'b']);
    expect(state.focused).toBe('b');
  });

  it('selects the agent when it was not selected', () => {
    const state = focusAgent({ ...base, selected: ['a'] }, 'b');
    expect(state.selected).toEqual(['b']);
  });
});

describe('clearSelection', () => {
  it('clears selection and focus', () => {
    const state = clearSelection({ ...withAgents('a'), selected: ['a'], focused: 'a' });
    expect(state.selected).toEqual([]);
    expect(state.focused).toBeNull();
  });

  it('returns the same state when nothing is selected', () => {
    expect(clearSelection(INITIAL_STATE)).toBe(INITIAL_STATE);
  });
});

describe('setConnection', () => {
  it('only changes when the value differs', () => {
    expect(setConnection(INITIAL_STATE, 'connecting')).toBe(INITIAL_STATE);
    expect(setConnection(INITIAL_STATE, 'open').connection).toBe('open');
  });
});

describe('applyServerMessage', () => {
  it('handles session init', () => {
    const state = applyServerMessage(INITIAL_STATE, {
      type: 'session:init',
      agents: [agent('a')],
      events: [],
      skins: ['corvin'],
    });
    expect(state.agents).toHaveLength(1);
    expect(state.skins).toEqual(['corvin']);
  });

  it('handles agent updates and removals', () => {
    const updated = applyServerMessage(INITIAL_STATE, { type: 'agent:updated', agent: agent('a') });
    expect(updated.agents).toHaveLength(1);
    const removed = applyServerMessage(updated, { type: 'agent:removed', agentId: 'a' });
    expect(removed.agents).toHaveLength(0);
  });

  it('handles events', () => {
    const state = applyServerMessage(INITIAL_STATE, { type: 'event', event: event(1) });
    expect(state.events).toEqual([event(1)]);
  });

  it('ignores terminal and transient messages', () => {
    expect(
      applyServerMessage(INITIAL_STATE, { type: 'term:output', agentId: 'a', data: 'x' }),
    ).toBe(INITIAL_STATE);
    expect(applyServerMessage(INITIAL_STATE, { type: 'error', code: 'UNAUTHORIZED' })).toBe(
      INITIAL_STATE,
    );
  });
});

describe('Store', () => {
  it('notifies listeners with the next and previous state', () => {
    const store = new Store();
    const listener = vi.fn();
    store.subscribe(listener);
    store.apply({ type: 'agent:updated', agent: agent('a') });
    expect(listener).toHaveBeenCalledTimes(1);
    const [next, previous] = listener.mock.calls[0] as [StoreState, StoreState];
    expect(next.agents).toHaveLength(1);
    expect(previous).toBe(INITIAL_STATE);
  });

  it('skips listeners when nothing changes', () => {
    const store = new Store();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setConnection('connecting');
    store.clearSelection();
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const store = new Store();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setConnection('open');
    expect(listener).not.toHaveBeenCalled();
  });

  it('exposes selection, focus and lookup helpers', () => {
    const store = new Store(withAgents('a', 'b'));
    store.select('a');
    store.select('b', 'toggle');
    expect(store.getState().selected).toEqual(['a', 'b']);
    store.focus('b');
    expect(store.getState().focused).toBe('b');
    expect(store.agent('b')?.id).toBe('b');
    expect(store.agent('x')).toBeUndefined();
    store.clearSelection();
    expect(store.getState().selected).toEqual([]);
    store.setConnection('closed');
    expect(store.getState().connection).toBe('closed');
  });
});
