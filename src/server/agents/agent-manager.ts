import type {
  AgentView,
  PermissionMode,
  VillageEvent,
  VillageEventKind,
} from '../../shared/agent.js';
import { ENV_PREFIX, MAX_EVENTS } from '../../shared/constants.js';
import type { ErrorCode } from '../../shared/errors.js';
import type { ServerMessage } from '../../shared/protocol.js';
import type { HookEvent } from '../hooks/hook-events.js';
import { handleHook, parseHookPayload } from '../hooks/hook-handler.js';
import type { ClaudeCommand } from '../platform/claude-binary.js';
import type { StoredAgent } from '../store/agent-store.js';
import type { Agent } from './agent.js';
import type { AgentRegistry } from './agent-registry.js';
import type { AgentFilePaths } from './agent-files.js';
import { MessageQueue, sanitizePrompt } from './message-queue.js';
import { detectTrustPrompt, trustAnswer } from './trust-prompt.js';

export const READY_TIMEOUT_MS = 10_000;
export const VISIT_DELAY_MS = 2_500;
export const PREVIEW_LENGTH = 80;

export interface ProcessHandle {
  readonly running: boolean;
  start(): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  snapshot(): Promise<string>;
  stop(): Promise<void>;
  dispose(): void;
  onOutput(listener: (data: string) => void): () => void;
  onExit(listener: (code: number) => void): () => void;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface ManagerDeps {
  registry: AgentRegistry;
  saveAgents: (agents: StoredAgent[]) => Promise<void>;
  writeFiles: (agent: Agent) => Promise<AgentFilePaths>;
  createProcess: (spec: SpawnSpec) => ProcessHandle;
  isDirectory: (path: string) => Promise<boolean>;
  hasSkin: (skin: string) => boolean;
  claude: ClaudeCommand;
  baseEnv: Record<string, string>;
  token: string;
  port: number;
  emit: (message: ServerMessage) => void;
  now?: () => number;
}

export interface CreateInput {
  name: string;
  cwd: string;
  skin: string;
  permissionMode: PermissionMode;
}

export type ManagerResult<T = undefined> = { ok: true; value: T } | { ok: false; code: ErrorCode };

export interface SendResult {
  queued: number;
  busy: boolean;
}

interface Runtime {
  process: ProcessHandle;
  queue: MessageQueue;
  readyTimer: ReturnType<typeof setTimeout> | null;
  visitTimers: Set<ReturnType<typeof setTimeout>>;
  trustHandled: boolean;
  trustOpen: boolean;
  trustWindow: boolean;
  checkingTrust: boolean;
  unsubscribe: (() => void)[];
}

const ESC = '\x1b';
const VISIBLE_LINES = 40;
const SUBMIT_KEY = /^(?:[1-9]|.*\r.*)$/s;
const WORK_HOOKS: readonly HookEvent[] = ['UserPromptSubmit', 'PreToolUse'];

export function visibleTail(screen: string, lines = VISIBLE_LINES): string {
  return screen.split(/\r?\n/).slice(-lines).join('\n');
}

function ok<T>(value: T): ManagerResult<T> {
  return { ok: true, value };
}

function fail(code: ErrorCode): { ok: false; code: ErrorCode } {
  return { ok: false, code };
}

export function formatAgentMessage(fromName: string, text: string): string {
  return `[Message from ${fromName}]\n${text}`;
}

export function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

export class AgentManager {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly events: VillageEvent[] = [];
  private readonly now: () => number;

  constructor(private readonly deps: ManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  views(): AgentView[] {
    return this.deps.registry.list().map((agent) => agent.toView());
  }

  recentEvents(): VillageEvent[] {
    return [...this.events];
  }

  async snapshot(id: string): Promise<string> {
    return (await this.runtimes.get(id)?.process.snapshot()) ?? '';
  }

  async restore(stored: readonly StoredAgent[]): Promise<void> {
    for (const entry of stored) {
      const result = this.deps.registry.add(entry);
      if (result.ok) await this.spawn(result.agent);
    }
  }

  async create(input: CreateInput): Promise<ManagerResult<AgentView>> {
    if (!(await this.deps.isDirectory(input.cwd))) return fail('INVALID_CWD');
    if (!this.deps.hasSkin(input.skin)) return fail('SKIN_NOT_FOUND');
    const result = this.deps.registry.add(input);
    if (!result.ok) return result;
    await this.persist();
    this.record('joined', result.agent.id);
    const spawned = await this.spawn(result.agent);
    if (!spawned) return fail('SPAWN_FAILED');
    return ok(result.agent.toView());
  }

  async remove(id: string): Promise<ManagerResult> {
    const agent = this.deps.registry.get(id);
    if (!agent) return fail('AGENT_NOT_FOUND');
    await this.teardown(id);
    this.deps.registry.remove(id);
    await this.persist();
    this.record('left', id);
    this.deps.emit({ type: 'agent:removed', agentId: id });
    return ok(undefined);
  }

  async removeAll(): Promise<void> {
    for (const agent of this.deps.registry.list()) await this.remove(agent.id);
  }

  async restart(id: string): Promise<ManagerResult> {
    const agent = this.deps.registry.get(id);
    if (!agent) return fail('AGENT_NOT_FOUND');
    await this.teardown(id);
    this.deps.emit({ type: 'term:reset', agentId: id });
    return (await this.spawn(agent)) ? ok(undefined) : fail('SPAWN_FAILED');
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.runtimes.keys()]) await this.teardown(id);
  }

  interrupt(id: string): ManagerResult {
    return this.input(id, ESC);
  }

  input(id: string, data: string): ManagerResult {
    const agent = this.deps.registry.get(id);
    const runtime = this.runtimes.get(id);
    if (!agent || !runtime) return fail('AGENT_NOT_FOUND');
    runtime.process.write(data);
    // esc interrupts the turn without firing a stop hook
    if (data === ESC && agent.status !== 'offline' && agent.status !== 'starting') {
      this.update(agent, 'idle');
    } else if (agent.status === 'waiting' && SUBMIT_KEY.test(data)) {
      this.update(agent, 'thinking');
    }
    return ok(undefined);
  }

  resize(id: string, cols: number, rows: number): ManagerResult {
    const runtime = this.runtimes.get(id);
    if (!runtime) return fail('AGENT_NOT_FOUND');
    runtime.process.resize(cols, rows);
    return ok(undefined);
  }

  async setSkin(id: string, skin: string): Promise<ManagerResult> {
    const agent = this.deps.registry.get(id);
    if (!agent) return fail('AGENT_NOT_FOUND');
    if (!this.deps.hasSkin(skin)) return fail('SKIN_NOT_FOUND');
    agent.skin = skin;
    await this.persist();
    this.broadcast(agent);
    return ok(undefined);
  }

  sendPrompt(ids: readonly string[], text: string): ManagerResult<SendResult[]> {
    const targets: [Agent, Runtime][] = [];
    for (const id of new Set(ids)) {
      const target = this.target(id);
      if (!target.ok) return target;
      targets.push(target.value);
    }
    if (sanitizePrompt(text).trim() === '') return fail('EMPTY_PROMPT');
    if (targets.some(([, runtime]) => runtime.queue.isFull)) return fail('QUEUE_FULL');
    const results: SendResult[] = [];
    for (const [agent, runtime] of targets) {
      const queued = runtime.queue.enqueue({ fromId: null, text });
      if (!queued.ok) return queued;
      agent.queued = runtime.queue.size;
      this.record('prompted', agent.id);
      results.push({ queued: queued.size, busy: agent.status !== 'idle' });
      this.broadcast(agent);
      this.tryDeliver(agent);
    }
    return ok(results);
  }

  sendMessage(fromId: string, toName: string, text: string): ManagerResult<SendResult> {
    const from = this.deps.registry.get(fromId);
    if (!from) return fail('AGENT_NOT_FOUND');
    const recipient = this.deps.registry.findByName(toName);
    if (!recipient || recipient.id === from.id) return fail('AGENT_NOT_FOUND');
    const target = this.target(recipient.id);
    if (!target.ok) return target;
    const [to, runtime] = target.value;
    if (sanitizePrompt(text).trim() === '') return fail('EMPTY_PROMPT');
    const queued = runtime.queue.enqueue({
      fromId: from.id,
      text: formatAgentMessage(from.name, text),
    });
    if (!queued.ok) return queued;
    to.queued = runtime.queue.size;
    this.record('messaged', from.id, to.id);
    this.deps.emit({ type: 'agent:visit', fromId: from.id, toId: to.id, preview: preview(text) });
    this.broadcast(to);
    const busy = to.status !== 'idle';
    const timer = setTimeout(() => {
      runtime.visitTimers.delete(timer);
      this.tryDeliver(to);
    }, VISIT_DELAY_MS);
    runtime.visitTimers.add(timer);
    return ok({ queued: queued.size, busy });
  }

  private target(id: string): ManagerResult<[Agent, Runtime]> {
    const agent = this.deps.registry.get(id);
    const runtime = this.runtimes.get(id);
    if (!agent || !runtime) return fail('AGENT_NOT_FOUND');
    if (agent.status === 'offline') return fail('AGENT_OFFLINE');
    return ok([agent, runtime]);
  }

  others(id: string): AgentView[] {
    return this.views().filter((view) => view.id !== id);
  }

  hook(id: string, event: HookEvent, rawPayload: unknown): ManagerResult {
    const agent = this.deps.registry.get(id);
    if (!agent) return fail('AGENT_NOT_FOUND');
    const runtime = this.runtimes.get(id);
    if (runtime && WORK_HOOKS.includes(event)) {
      runtime.trustWindow = false;
      runtime.trustOpen = false;
    }
    const outcome = handleHook(event, parseHookPayload(rawPayload), agent.status);
    if (!outcome) return ok(undefined);
    this.clearReadyTimer(id);
    this.update(agent, outcome.status, outcome.tool);
    if (outcome.event) this.record(outcome.event, id);
    return ok(undefined);
  }

  private async spawn(agent: Agent): Promise<boolean> {
    let files: AgentFilePaths;
    try {
      files = await this.deps.writeFiles(agent);
    } catch {
      this.update(agent, 'offline');
      return false;
    }
    const process = this.deps.createProcess(this.spawnSpec(agent, files));
    const runtime: Runtime = {
      process,
      queue: new MessageQueue((data) => {
        process.write(data);
      }),
      readyTimer: null,
      visitTimers: new Set(),
      trustHandled: false,
      trustOpen: false,
      trustWindow: true,
      checkingTrust: false,
      unsubscribe: [],
    };
    runtime.unsubscribe.push(
      process.onOutput((data) => {
        this.deps.emit({ type: 'term:output', agentId: agent.id, data });
        if (runtime.trustWindow) void this.checkTrust(agent, runtime);
      }),
      process.onExit(() => {
        this.clearReadyTimer(agent.id);
        runtime.queue.clear();
        agent.queued = 0;
        this.update(agent, 'offline');
      }),
    );
    this.runtimes.set(agent.id, runtime);
    try {
      process.start();
    } catch {
      this.update(agent, 'offline');
      return false;
    }
    this.update(agent, 'starting');
    runtime.readyTimer = setTimeout(() => {
      runtime.readyTimer = null;
      if (agent.status === 'starting') this.update(agent, 'idle');
    }, READY_TIMEOUT_MS);
    return true;
  }

  private spawnSpec(agent: Agent, files: AgentFilePaths): SpawnSpec {
    const { claude, baseEnv, token, port } = this.deps;
    const mode =
      agent.permissionMode === 'default' ? [] : ['--permission-mode', agent.permissionMode];
    return {
      command: claude.command,
      args: [...claude.args, '--settings', files.settings, '--mcp-config', files.mcp, ...mode],
      cwd: agent.cwd,
      env: {
        ...baseEnv,
        [`${ENV_PREFIX}TOKEN`]: token,
        [`${ENV_PREFIX}PORT`]: String(port),
        [`${ENV_PREFIX}AGENT_ID`]: agent.id,
        [`${ENV_PREFIX}AGENT_NAME`]: agent.name,
      },
    };
  }

  private async checkTrust(agent: Agent, runtime: Runtime): Promise<void> {
    if (runtime.checkingTrust) return;
    runtime.checkingTrust = true;
    try {
      const screen = visibleTail(await runtime.process.snapshot());
      const wasOpen = runtime.trustOpen;
      runtime.trustOpen = detectTrustPrompt(screen);
      if (!runtime.trustOpen) {
        if (wasOpen) this.tryDeliver(agent);
        return;
      }
      const answer = trustAnswer(screen);
      if (answer) {
        runtime.trustHandled = true;
        runtime.trustWindow = false;
        runtime.trustOpen = false;
        runtime.process.write(answer);
      } else if (!wasOpen) {
        this.update(agent, 'waiting');
      }
    } finally {
      runtime.checkingTrust = false;
    }
  }

  private tryDeliver(agent: Agent): void {
    const runtime = this.runtimes.get(agent.id);
    if (!runtime || runtime.trustOpen || agent.status !== 'idle') return;
    const message = runtime.queue.deliverNext();
    if (!message) return;
    agent.queued = runtime.queue.size;
    this.update(agent, 'thinking');
    if (message.fromId !== null) {
      this.record('delivered', message.fromId, agent.id);
      this.deps.emit({ type: 'message:delivered', fromId: message.fromId, toId: agent.id });
    }
  }

  private update(agent: Agent, status: Agent['status'], tool: Agent['tool'] = null): void {
    agent.setStatus(status, tool);
    this.broadcast(agent);
    if (status === 'idle') this.tryDeliver(agent);
  }

  private broadcast(agent: Agent): void {
    this.deps.emit({ type: 'agent:updated', agent: agent.toView() });
  }

  private record(kind: VillageEventKind, agentId: string, targetId?: string): void {
    const event: VillageEvent = {
      kind,
      agentId,
      at: this.now(),
      ...(targetId === undefined ? {} : { targetId }),
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.deps.emit({ type: 'event', event });
  }

  private clearReadyTimer(id: string): void {
    const runtime = this.runtimes.get(id);
    if (runtime?.readyTimer) {
      clearTimeout(runtime.readyTimer);
      runtime.readyTimer = null;
    }
  }

  private async teardown(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    this.clearReadyTimer(id);
    for (const timer of runtime.visitTimers) clearTimeout(timer);
    runtime.visitTimers.clear();
    for (const unsubscribe of runtime.unsubscribe) unsubscribe();
    runtime.queue.clear();
    await runtime.process.stop();
    runtime.process.dispose();
    this.runtimes.delete(id);
    const agent = this.deps.registry.get(id);
    if (agent) {
      agent.queued = 0;
      this.update(agent, 'offline');
    }
  }

  private async persist(): Promise<void> {
    await this.deps.saveAgents(this.deps.registry.list().map((agent) => agent.toStored()));
  }
}
