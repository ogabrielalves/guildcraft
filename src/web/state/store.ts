import type { AgentActivity } from '../../shared/activity.js';
import type { AgentView, VillageEvent } from '../../shared/agent.js';
import { MAX_EVENTS } from '../../shared/constants.js';
import type { PermissionRequestView } from '../../shared/permission.js';
import type { ServerMessage } from '../../shared/protocol.js';

export type ConnectionState = 'connecting' | 'open' | 'closed' | 'unauthorized';
export type SelectMode = 'replace' | 'toggle' | 'add';

export interface StoreState {
  readonly agents: readonly AgentView[];
  readonly events: readonly VillageEvent[];
  readonly skins: readonly string[];
  readonly activities: Readonly<Record<string, AgentActivity>>;
  readonly permissions: readonly PermissionRequestView[];
  readonly selected: readonly string[];
  readonly focused: string | null;
  readonly connection: ConnectionState;
}

export type StoreListener = (state: StoreState, previous: StoreState) => void;

export const INITIAL_STATE: StoreState = {
  agents: [],
  events: [],
  skins: [],
  activities: {},
  permissions: [],
  selected: [],
  focused: null,
  connection: 'connecting',
};

export function withDefaults(agent: AgentView): AgentView {
  const partial: Partial<AgentView> = agent;
  return {
    ...agent,
    tool: partial.tool ?? null,
    waitingFor: partial.waitingFor ?? null,
    model: partial.model ?? null,
    effort: partial.effort ?? null,
    queued: partial.queued ?? 0,
  };
}

export function upsertAgent(state: StoreState, update: AgentView): StoreState {
  const agent = withDefaults(update);
  const index = state.agents.findIndex((current) => current.id === agent.id);
  const agents =
    index === -1 ? [...state.agents, agent] : state.agents.map((a, i) => (i === index ? agent : a));
  return { ...state, agents };
}

export function removeAgent(state: StoreState, agentId: string): StoreState {
  const selected = state.selected.filter((id) => id !== agentId);
  const activities = Object.fromEntries(
    Object.entries(state.activities).filter(([id]) => id !== agentId),
  );
  return {
    ...state,
    agents: state.agents.filter((agent) => agent.id !== agentId),
    activities,
    permissions: state.permissions.filter((request) => request.agentId !== agentId),
    selected,
    focused: state.focused === agentId ? (selected.at(-1) ?? null) : state.focused,
  };
}

export function addEvent(state: StoreState, event: VillageEvent): StoreState {
  return { ...state, events: [...state.events, event].slice(-MAX_EVENTS) };
}

export function initSession(
  state: StoreState,
  agents: readonly AgentView[],
  events: readonly VillageEvent[],
  skins: readonly string[],
  activities: readonly AgentActivity[] = [],
  permissions: readonly PermissionRequestView[] = [],
): StoreState {
  const ids = new Set(agents.map((agent) => agent.id));
  return {
    ...state,
    agents: agents.map(withDefaults),
    events: events.slice(-MAX_EVENTS),
    skins: [...skins],
    activities: Object.fromEntries(
      activities.filter((activity) => ids.has(activity.agentId)).map((a) => [a.agentId, a]),
    ),
    permissions: oldestFirst(permissions.filter((request) => ids.has(request.agentId))),
    selected: state.selected.filter((id) => ids.has(id)),
    focused: state.focused !== null && ids.has(state.focused) ? state.focused : null,
  };
}

function oldestFirst(requests: readonly PermissionRequestView[]): PermissionRequestView[] {
  return [...requests].sort((a, b) => a.createdAt - b.createdAt);
}

export function addPermission(state: StoreState, request: PermissionRequestView): StoreState {
  if (!state.agents.some((agent) => agent.id === request.agentId)) return state;
  const others = state.permissions.filter((current) => current.id !== request.id);
  return { ...state, permissions: oldestFirst([...others, request]) };
}

export function resolvePermission(state: StoreState, requestId: string): StoreState {
  if (!state.permissions.some((request) => request.id === requestId)) return state;
  return {
    ...state,
    permissions: state.permissions.filter((request) => request.id !== requestId),
  };
}

export function pendingFor(
  state: Pick<StoreState, 'permissions'>,
  agentId: string,
): PermissionRequestView[] {
  return state.permissions.filter((request) => request.agentId === agentId);
}

export function setActivity(state: StoreState, activity: AgentActivity): StoreState {
  if (!state.agents.some((agent) => agent.id === activity.agentId)) return state;
  return { ...state, activities: { ...state.activities, [activity.agentId]: activity } };
}

export function selectAgent(state: StoreState, agentId: string, mode: SelectMode): StoreState {
  if (!state.agents.some((agent) => agent.id === agentId)) return state;
  const has = state.selected.includes(agentId);
  if (mode === 'replace') {
    const unchanged = state.focused === agentId && state.selected.length === 1 && has;
    return unchanged ? state : { ...state, selected: [agentId], focused: agentId };
  }
  if (!has) {
    return { ...state, selected: [...state.selected, agentId], focused: state.focused ?? agentId };
  }
  if (mode === 'add') return state;
  const selected = state.selected.filter((id) => id !== agentId);
  const focused = state.focused === agentId ? (selected.at(-1) ?? null) : state.focused;
  return { ...state, selected, focused };
}

export function focusAgent(state: StoreState, agentId: string | null): StoreState {
  if (agentId === null) return { ...state, focused: null };
  if (!state.agents.some((agent) => agent.id === agentId)) return state;
  const selected = state.selected.includes(agentId) ? state.selected : [agentId];
  return { ...state, selected, focused: agentId };
}

export function clearSelection(state: StoreState): StoreState {
  if (state.selected.length === 0 && state.focused === null) return state;
  return { ...state, selected: [], focused: null };
}

export function setConnection(state: StoreState, connection: ConnectionState): StoreState {
  return state.connection === connection ? state : { ...state, connection };
}

export function applyServerMessage(state: StoreState, message: ServerMessage): StoreState {
  switch (message.type) {
    case 'session:init':
      return initSession(
        state,
        message.agents,
        message.events,
        message.skins,
        message.activities,
        message.permissions,
      );
    case 'agent:updated':
      return upsertAgent(state, message.agent);
    case 'agent:removed':
      return removeAgent(state, message.agentId);
    case 'event':
      return addEvent(state, message.event);
    case 'permission:request':
      return addPermission(state, message.request);
    case 'permission:resolved':
      return resolvePermission(state, message.requestId);
    case 'agent:activity':
      return setActivity(state, message.activity);
    default:
      return state;
  }
}

export class Store {
  private state: StoreState;
  private readonly listeners = new Set<StoreListener>();

  constructor(initial: StoreState = INITIAL_STATE) {
    this.state = initial;
  }

  getState(): StoreState {
    return this.state;
  }

  agent(agentId: string): AgentView | undefined {
    return this.state.agents.find((agent) => agent.id === agentId);
  }

  activity(agentId: string): AgentActivity | undefined {
    return this.state.activities[agentId];
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(reducer: (state: StoreState) => StoreState): void {
    const previous = this.state;
    const next = reducer(previous);
    if (next === previous) return;
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener(next, previous);
      } catch (error) {
        console.error('guildcraft: a store listener failed', error);
      }
    }
  }

  apply(message: ServerMessage): void {
    this.update((state) => applyServerMessage(state, message));
  }

  select(agentId: string, mode: SelectMode = 'replace'): void {
    this.update((state) => selectAgent(state, agentId, mode));
  }

  focus(agentId: string | null): void {
    this.update((state) => focusAgent(state, agentId));
  }

  clearSelection(): void {
    this.update(clearSelection);
  }

  setConnection(connection: ConnectionState): void {
    this.update((state) => setConnection(state, connection));
  }
}
