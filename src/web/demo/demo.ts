import type { AgentStatus, AgentTool, AgentView, VillageEvent } from '../../shared/agent.js';
import { MAX_AGENTS, MAX_EVENTS } from '../../shared/constants.js';
import type { FsEntry, FsListing } from '../../shared/fs.js';
import type { ClientMessage, ServerMessage } from '../../shared/protocol.js';
import { notify } from '../net/socket.js';
import type { MessageListener, SocketStatus, StatusListener } from '../net/socket.js';

export const DEMO_QUERY = 'demo';
export const DEMO_TICK_MS = 2_000;
export const DEMO_VISIT_DELAY_MS = 2_500;
export const MAX_WARP = 60;

export const DEMO_SKINS = [
  'mortis',
  'corvin',
  'lyra',
  'aldwin',
  'brom',
  'seren',
  'oren',
  'faelan',
  'amara',
] as const;

const DEMO_CREW: readonly Pick<AgentView, 'name' | 'cwd' | 'skin'>[] = [
  { name: 'Mortis', cwd: '~/projects/web', skin: 'mortis' },
  { name: 'Corvin', cwd: '~/projects/api', skin: 'corvin' },
  { name: 'Brom', cwd: '~/projects/infra', skin: 'brom' },
  { name: 'Amara', cwd: '~/projects/docs', skin: 'amara' },
  { name: 'Faelan', cwd: '~/projects/mobile', skin: 'faelan' },
];

const DEMO_TOOLS: readonly AgentTool[] = [
  { name: 'Edit', detail: 'App.tsx' },
  { name: 'Write', detail: 'routes.ts' },
  { name: 'Bash', detail: 'npm test' },
  { name: 'Read', detail: 'README.md' },
  { name: 'Grep', detail: 'TODO' },
  { name: 'WebSearch', detail: 'vite proxy websocket' },
  { name: 'TodoWrite', detail: '3 tasks' },
  { name: 'mcp__guildcraft__send_message', detail: 'Corvin' },
];

const DEMO_PREVIEWS: readonly string[] = [
  'Can you expose the new endpoint?',
  'Tests are green on my side.',
  'Please review the migration.',
  'The build needs the new env var.',
];

const DEMO_HOME = '/home/demo';

const DEMO_FOLDERS: Readonly<Record<string, readonly string[]>> = {
  '/': ['home'],
  '/home': ['demo'],
  [DEMO_HOME]: ['projects'],
  [`${DEMO_HOME}/projects`]: ['api', 'docs', 'game', 'infra', 'mobile', 'web'],
  [`${DEMO_HOME}/projects/api`]: [],
  [`${DEMO_HOME}/projects/docs`]: [],
  [`${DEMO_HOME}/projects/game`]: [],
  [`${DEMO_HOME}/projects/infra`]: [],
  [`${DEMO_HOME}/projects/mobile`]: [],
  [`${DEMO_HOME}/projects/web`]: [],
};

export interface DemoOptions {
  warp: number;
  visit: boolean;
}

export interface DemoTimers {
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export type Random = () => number;

export function parseDemoOptions(url: URL): DemoOptions | null {
  if (!url.searchParams.has(DEMO_QUERY)) return null;
  const warp = Number(url.searchParams.get('warp') ?? '1');
  return {
    warp: Number.isFinite(warp) ? Math.min(Math.max(warp, 1), MAX_WARP) : 1,
    visit: url.searchParams.has('visit'),
  };
}

export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pick<T>(items: readonly T[], random: Random): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('cannot pick from an empty list');
  return item;
}

export function nextStatus(status: AgentStatus, random: Random): AgentStatus {
  const roll = random();
  switch (status) {
    case 'offline':
      return 'starting';
    case 'starting':
      return 'idle';
    case 'idle':
      return roll < 0.6 ? 'thinking' : 'idle';
    case 'thinking':
      return roll < 0.7 ? 'tool' : roll < 0.85 ? 'waiting' : 'idle';
    case 'tool':
      return roll < 0.5 ? 'tool' : roll < 0.8 ? 'thinking' : 'idle';
    case 'waiting':
      return roll < 0.5 ? 'waiting' : 'thinking';
  }
}

export function createDemoAgents(): AgentView[] {
  return DEMO_CREW.map((crew, index) => ({
    ...crew,
    id: `demo-${index + 1}`,
    status: 'idle',
    permissionMode: 'default',
    tool: null,
    waitingFor: null,
    model: null,
    effort: null,
    queued: 0,
  }));
}

export function demoListFolders(path: string | null): Promise<FsListing> {
  const roots: FsEntry[] = [
    { name: '~', path: DEMO_HOME },
    { name: '/', path: '/' },
  ];
  if (path === null) return Promise.resolve({ path: null, parent: null, entries: [], roots });
  const children = DEMO_FOLDERS[path];
  if (!children) return Promise.reject(new Error(`unknown demo folder: ${path}`));
  const parent = path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/';
  const entries = children.map((name) => ({
    name,
    path: path === '/' ? `/${name}` : `${path}/${name}`,
  }));
  return Promise.resolve({ path, parent, entries, roots });
}

export class DemoSocket {
  private status: SocketStatus = 'closed';
  private timer: unknown = null;
  private agents: AgentView[] = createDemoAgents();
  private events: VillageEvent[] = [];
  private nextId = DEMO_CREW.length + 1;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly timers: DemoTimers;

  constructor(
    private readonly options: DemoOptions,
    private readonly random: Random = Math.random,
    timers?: DemoTimers,
    private readonly now: () => number = Date.now,
  ) {
    this.timers = timers ?? {
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    };
  }

  getStatus(): SocketStatus {
    return this.status;
  }

  getAgents(): readonly AgentView[] {
    return this.agents;
  }

  connect(): void {
    if (this.status === 'open') return;
    this.setStatus('open');
    this.emit({
      type: 'session:init',
      agents: this.agents,
      events: this.events,
      skins: [...DEMO_SKINS],
      permissions: [],
    });
    for (const agent of this.agents) {
      this.emit({ type: 'term:snapshot', agentId: agent.id, data: banner(agent) });
    }
    this.schedule();
  }

  close(): void {
    if (this.timer !== null) this.timers.clearTimer(this.timer);
    this.timer = null;
    this.setStatus('closed');
  }

  send(message: ClientMessage): boolean {
    if (this.status !== 'open') return false;
    this.handle(message);
    return true;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  tick(): void {
    if (this.agents.length === 0) return;
    const agent = pick(this.agents, this.random);
    const status = nextStatus(agent.status, this.random);
    const tool = status === 'tool' ? pick(DEMO_TOOLS, this.random) : null;
    this.update(agent.id, { status, tool });
    if (status === 'tool' && tool) {
      this.emit({
        type: 'term:output',
        agentId: agent.id,
        data: `\r\n● ${tool.name}(${tool.detail})`,
      });
    }
    if (agent.status !== 'idle' && status === 'idle') this.record('finished', agent.id);
    if (agent.status !== 'waiting' && status === 'waiting') this.record('waiting', agent.id);
    if (this.options.visit && tool?.name === 'mcp__guildcraft__send_message') this.visit(agent.id);
  }

  private handle(message: ClientMessage): void {
    switch (message.type) {
      case 'prompt:send':
        for (const agentId of message.agentIds) {
          if (!this.find(agentId)) continue;
          this.update(agentId, { status: 'thinking', tool: null });
          this.emit({ type: 'term:output', agentId, data: `\r\n> ${message.text}\r\n` });
          this.record('prompted', agentId);
        }
        return;
      case 'term:input':
        this.emit({ type: 'term:output', agentId: message.agentId, data: message.data });
        return;
      case 'agent:interrupt':
        this.update(message.agentId, { status: 'idle', tool: null });
        return;
      case 'agent:restart':
        this.update(message.agentId, { status: 'starting', tool: null, queued: 0 });
        this.emit({ type: 'term:reset', agentId: message.agentId });
        return;
      case 'agent:setSkin':
        this.update(message.agentId, { skin: message.skin });
        return;
      case 'agent:create':
        this.create(message);
        return;
      case 'agent:remove':
        this.remove(message.agentId);
        return;
      case 'agent:removeAll':
        for (const agent of [...this.agents]) this.remove(agent.id);
        return;
      case 'term:resize':
        return;
    }
  }

  private create(message: Extract<ClientMessage, { type: 'agent:create' }>): void {
    if (this.agents.length >= MAX_AGENTS) {
      this.emit({ type: 'error', code: 'AGENT_LIMIT_REACHED' });
      return;
    }
    if (this.agents.some((agent) => agent.name === message.name)) {
      this.emit({ type: 'error', code: 'AGENT_NAME_TAKEN', params: { name: message.name } });
      return;
    }
    const agent: AgentView = {
      id: `demo-${this.nextId++}`,
      name: message.name,
      cwd: message.cwd,
      skin: message.skin,
      status: 'starting',
      permissionMode: message.permissionMode,
      tool: null,
      waitingFor: null,
      model: null,
      effort: null,
      queued: 0,
    };
    this.agents = [...this.agents, agent];
    this.emit({ type: 'agent:updated', agent });
    this.emit({ type: 'term:snapshot', agentId: agent.id, data: banner(agent) });
    this.record('joined', agent.id);
  }

  private remove(agentId: string): void {
    if (!this.find(agentId)) return;
    this.agents = this.agents.filter((agent) => agent.id !== agentId);
    this.emit({ type: 'agent:removed', agentId });
    this.record('left', agentId);
  }

  private visit(fromId: string): void {
    const others = this.agents.filter((agent) => agent.id !== fromId);
    if (others.length === 0) return;
    const target = pick(others, this.random);
    this.emit({
      type: 'agent:visit',
      fromId,
      toId: target.id,
      preview: pick(DEMO_PREVIEWS, this.random),
    });
    this.record('messaged', fromId, target.id);
    this.timers.setTimer(() => {
      if (this.status !== 'open' || !this.find(target.id)) return;
      this.emit({ type: 'message:delivered', fromId, toId: target.id });
      this.record('delivered', target.id, fromId);
    }, DEMO_VISIT_DELAY_MS / this.options.warp);
  }

  private find(agentId: string): AgentView | undefined {
    return this.agents.find((agent) => agent.id === agentId);
  }

  private update(agentId: string, changes: Partial<AgentView>): void {
    const current = this.find(agentId);
    if (!current) return;
    const agent = { ...current, ...changes };
    this.agents = this.agents.map((existing) => (existing.id === agentId ? agent : existing));
    this.emit({ type: 'agent:updated', agent });
  }

  private record(kind: VillageEvent['kind'], agentId: string, targetId?: string): void {
    const event: VillageEvent =
      targetId === undefined
        ? { kind, agentId, at: this.now() }
        : { kind, agentId, targetId, at: this.now() };
    this.events = [...this.events, event].slice(-MAX_EVENTS);
    this.emit({ type: 'event', event });
  }

  private schedule(): void {
    this.timer = this.timers.setTimer(() => {
      if (this.status !== 'open') return;
      this.tick();
      this.schedule();
    }, DEMO_TICK_MS / this.options.warp);
  }

  private emit(message: ServerMessage): void {
    notify(this.messageListeners, message);
  }

  private setStatus(status: SocketStatus): void {
    if (status === this.status) return;
    this.status = status;
    notify(this.statusListeners, status);
  }
}

function banner(agent: AgentView): string {
  return `\x1b[1m${agent.name}\x1b[0m · ${agent.cwd}\r\n`;
}
