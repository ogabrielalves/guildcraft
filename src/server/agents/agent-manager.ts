import type { AgentActivity } from '../../shared/activity.js';
import type {
  AgentView,
  PermissionMode,
  VillageEvent,
  VillageEventKind,
  WaitingReason,
} from '../../shared/agent.js';
import {
  ENV_PREFIX,
  MAX_EVENTS,
  MAX_NAME_LENGTH,
  MAX_PROMPT_LENGTH,
} from '../../shared/constants.js';
import type { ErrorCode, Failure } from '../../shared/errors.js';
import type {
  PermissionDecision,
  PermissionOutcome,
  PermissionRequestView,
} from '../../shared/permission.js';
import type { ServerMessage } from '../../shared/protocol.js';
import type { HookEvent } from '../hooks/hook-events.js';
import type { HookPayload } from '../hooks/hook-handler.js';
import { handleHook, parseHookPayload } from '../hooks/hook-handler.js';
import type { OpenResult, WaitResult } from '../permissions/permission-broker.js';
import { PermissionBroker } from '../permissions/permission-broker.js';
import { QUESTION_TOOL } from '../permissions/request.js';
import { readTailLines } from '../permissions/tool-call.js';
import { ActivityTracker } from '../sessions/activity-tracker.js';
import type { SessionEntry } from '../sessions/session-registry.js';
import { reconcileSession } from '../sessions/session-sync.js';
import type { ModelInfo } from '../sessions/transcript-model.js';
import { latestModel } from '../sessions/transcript-model.js';
import type { ClaudeCommand } from '../platform/claude-binary.js';
import type { StoredAgent } from '../store/agent-store.js';
import type { Agent } from './agent.js';
import type { AgentRegistry } from './agent-registry.js';
import type { AgentFilePaths } from './agent-files.js';
import { holdsPrompt } from './input-box.js';
import { MessageQueue, sanitizePrompt } from './message-queue.js';
import { detectTrustPrompt, trustAnswer } from './trust-prompt.js';

export const READY_TIMEOUT_MS = 10_000;
export const VISIT_DELAY_MS = 2_500;
export const PREVIEW_LENGTH = 80;
export const TRUST_RETRY_MS = 1_000;
export const MAX_TRUST_ATTEMPTS = 3;

export interface ProcessHandle {
  readonly running: boolean;
  readonly pid: number | null;
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
  hasViewers?: () => boolean;
  readLines?: (path: string) => Promise<string[]>;
  activity?: ActivityTracker;
  now?: () => number;
}

export interface CreateInput {
  name: string;
  cwd: string;
  skin: string;
  permissionMode: PermissionMode;
}

export type ManagerResult<T = undefined> = { ok: true; value: T } | ({ ok: false } & Failure);

export interface SendResult {
  queued: number;
  busy: boolean;
}

interface Runtime {
  process: ProcessHandle;
  queue: MessageQueue;
  readyTimer: ReturnType<typeof setTimeout> | null;
  visitTimers: Set<ReturnType<typeof setTimeout>>;
  trustAttempts: number;
  trustRetry: ReturnType<typeof setTimeout> | null;
  trustOpen: boolean;
  trustWindow: boolean;
  trustCheck: Promise<void> | null;
  recheckTrust: boolean;
  hold: QueueHold;
  sessionId: string | null;
  transcriptPath: string | null;
  session: SessionEntry | null;
  lastSignalAt: number;
  unsubscribe: (() => void)[];
}

const RESUME_FAIL_MS = 15_000;

type QueueHold = 'none' | 'interrupted' | 'resumed';

const ESC = '\x1b';
const VISIBLE_LINES = 40;
const SUBMIT_KEY = /^(?:[1-9]|.*\r.*)$/s;
const WORK_HOOKS: readonly HookEvent[] = ['UserPromptSubmit', 'PreToolUse'];
const BUSY_STATUSES: readonly Agent['status'][] = ['thinking', 'tool', 'waiting'];

export function visibleTail(screen: string, lines = VISIBLE_LINES): string {
  return screen.split(/\r?\n/).slice(-lines).join('\n');
}

function clearTrustRetry(runtime: Runtime): void {
  if (runtime.trustRetry) clearTimeout(runtime.trustRetry);
  runtime.trustRetry = null;
}

function wantsRecheck(runtime: Runtime): boolean {
  return runtime.recheckTrust && runtime.trustWindow;
}

function ok<T>(value: T): ManagerResult<T> {
  return { ok: true, value };
}

function fail(code: ErrorCode): { ok: false; code: ErrorCode } {
  return { ok: false, code };
}

function checkText(text: string): ErrorCode | null {
  if (text.length > MAX_PROMPT_LENGTH) return 'INVALID_MESSAGE';
  if (sanitizePrompt(text).trim() === '') return 'EMPTY_PROMPT';
  return null;
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
  private readonly broker: PermissionBroker;
  private readonly readLines: (path: string) => Promise<string[]>;
  private readonly activity: ActivityTracker;

  constructor(private readonly deps: ManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.activity = deps.activity ?? new ActivityTracker();
    this.readLines = deps.readLines ?? ((path) => readTailLines(path));
    this.broker = new PermissionBroker({
      emit: deps.emit,
      hasViewers: deps.hasViewers ?? (() => true),
      readLines: this.readLines,
      onResolved: (agentId, outcome, decision) => {
        this.permissionResolved(agentId, outcome, decision);
      },
      now: this.now,
    });
  }

  views(): AgentView[] {
    return this.deps.registry.list().map((agent) => agent.toView());
  }

  permissions(): PermissionRequestView[] {
    return this.broker.list();
  }

  recentEvents(): VillageEvent[] {
    return [...this.events];
  }

  activities(): AgentActivity[] {
    return this.deps.registry.list().map((agent) => this.activity.get(agent.id));
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
    try {
      await this.persist();
    } catch (error) {
      this.deps.registry.remove(result.agent.id);
      throw error;
    }
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
    this.activity.remove(id);
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
    await Promise.all([...this.runtimes.keys()].map((id) => this.teardown(id)));
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
      if (BUSY_STATUSES.includes(agent.status)) runtime.hold = 'interrupted';
      this.broker.releaseAgent(id);
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
    const invalid = checkText(text);
    if (invalid) return fail(invalid);
    if (targets.some(([, runtime]) => runtime.queue.isFull)) return fail('QUEUE_FULL');
    const results: SendResult[] = [];
    for (const [agent, runtime] of targets) {
      runtime.hold = 'none';
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
    if (toName.length > MAX_NAME_LENGTH) return fail('INVALID_MESSAGE');
    const recipient = this.deps.registry.findByName(toName);
    if (!recipient || recipient.id === from.id) return fail('AGENT_NOT_FOUND');
    const target = this.target(recipient.id);
    if (!target.ok) return target;
    const [to, runtime] = target.value;
    const invalid = checkText(text);
    if (invalid) return fail(invalid);
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

  others(id: string): ManagerResult<AgentView[]> {
    if (!this.deps.registry.get(id)) return fail('AGENT_NOT_FOUND');
    return ok(this.views().filter((view) => view.id !== id));
  }

  hook(id: string, event: HookEvent, rawPayload: unknown): ManagerResult {
    const agent = this.deps.registry.get(id);
    if (!agent) return fail('AGENT_NOT_FOUND');
    const runtime = this.runtimes.get(id);
    if (runtime && WORK_HOOKS.includes(event)) {
      runtime.trustWindow = false;
      runtime.trustOpen = false;
      clearTrustRetry(runtime);
      runtime.queue.confirmSubmit();
    }
    if (runtime) this.advanceHold(runtime, event);
    const payload = parseHookPayload(rawPayload);
    if (runtime) this.trackSession(runtime, payload);
    if (payload.sessionId) this.rememberSession(agent, payload.sessionId);
    if (runtime && event === 'Stop') void this.refreshModel(agent, runtime);
    this.settlePermissions(id, event, payload);
    const outcome = handleHook(event, payload, agent.status);
    if (!outcome) return ok(undefined);
    this.clearReadyTimer(id);
    if (this.broker.oldestFor(id) && outcome.status !== 'waiting') return ok(undefined);
    this.update(agent, outcome.status, outcome.tool, outcome.waitingFor);
    if (outcome.event) this.record(outcome.event, id);
    return ok(undefined);
  }

  openPermission(id: string, body: unknown): ManagerResult<OpenResult> {
    const agent = this.deps.registry.get(id);
    if (!agent || !this.runtimes.has(id)) return fail('AGENT_NOT_FOUND');
    if (agent.status === 'offline') return fail('AGENT_OFFLINE');
    const result = this.broker.open(id, body);
    if (!result.ok && 'invalid' in result) return fail('INVALID_MESSAGE');
    if (result.ok) {
      this.clearReadyTimer(id);
      this.showPending(agent);
    }
    return ok(result);
  }

  waitPermission(id: string, requestId: string, timeoutMs: number): Promise<WaitResult> | null {
    return this.broker.wait(id, requestId, timeoutMs);
  }

  decidePermission(requestId: string, decision: PermissionDecision): ManagerResult {
    const code = this.broker.decide(requestId, decision);
    return code ? fail(code) : ok(undefined);
  }

  syncSessions(entries: readonly SessionEntry[]): void {
    for (const [id, runtime] of this.runtimes) {
      const pid = runtime.process.pid;
      const entry = entries.find(
        (candidate) =>
          (runtime.sessionId !== null && candidate.sessionId === runtime.sessionId) ||
          (pid !== null && candidate.pid === pid),
      );
      runtime.session = entry ?? null;
      const agent = this.deps.registry.get(id);
      if (!agent || !entry) continue;
      runtime.sessionId ??= entry.sessionId;
      this.rememberSession(agent, entry.sessionId);
      if (runtime.trustOpen || this.broker.oldestFor(id)) continue;
      const next = reconcileSession(agent.status, runtime.lastSignalAt, entry);
      if (!next) continue;
      const wasWaiting = agent.status === 'waiting';
      this.update(agent, next.status, null, next.waitingFor);
      if (next.status === 'waiting' && !wasWaiting) this.record('waiting', id);
    }
  }

  async syncActivity(): Promise<void> {
    const targets = [...this.runtimes].flatMap(([id, runtime]) =>
      runtime.transcriptPath ? [[id, runtime.transcriptPath] as const] : [],
    );
    const changed = await Promise.all(targets.map(([id, path]) => this.activity.poll(id, path)));
    for (const activity of changed) {
      if (activity && this.deps.registry.get(activity.agentId)) {
        this.deps.emit({ type: 'agent:activity', activity });
      }
    }
  }

  sweepPermissions(): Promise<void> {
    return this.broker.sweep((agentId) => {
      const runtime = this.runtimes.get(agentId);
      const agent = this.deps.registry.get(agentId);
      if (!runtime || agent?.status === 'offline') return null;
      return { transcriptPath: runtime.transcriptPath, session: runtime.session };
    });
  }

  private rememberSession(agent: Agent, sessionId: string): void {
    if (agent.sessionId === sessionId) return;
    agent.sessionId = sessionId;
    void this.persist().catch(() => undefined);
  }

  private trackSession(runtime: Runtime, payload: HookPayload): void {
    if (payload.sessionId) runtime.sessionId = payload.sessionId;
    if (payload.transcriptPath) runtime.transcriptPath = payload.transcriptPath;
  }

  private async refreshModel(agent: Agent, runtime: Runtime): Promise<void> {
    if (!runtime.transcriptPath) return;
    let info: ModelInfo | null;
    try {
      info = latestModel(await this.readLines(runtime.transcriptPath));
    } catch {
      return;
    }
    if (!info || this.runtimes.get(agent.id) !== runtime) return;
    if (agent.setModel(info.model, info.effort)) this.broadcast(agent);
  }

  private settlePermissions(id: string, event: HookEvent, payload: HookPayload): void {
    if (event === 'Stop') this.broker.releaseAgent(id);
    else if (event === 'PostToolUse' && payload.toolName) {
      this.broker.releaseCall(id, payload.toolName, payload.toolInput);
    }
  }

  private showPending(agent: Agent): boolean {
    const pending = this.broker.oldestFor(agent.id);
    if (!pending) return false;
    const reason: WaitingReason = pending.toolName === QUESTION_TOOL ? 'question' : 'permission';
    const wasWaiting = agent.status === 'waiting';
    this.update(agent, 'waiting', null, reason);
    if (!wasWaiting) this.record('waiting', agent.id);
    return true;
  }

  private permissionResolved(
    agentId: string,
    outcome: PermissionOutcome,
    decision: PermissionDecision | null,
  ): void {
    const agent = this.deps.registry.get(agentId);
    const runtime = this.runtimes.get(agentId);
    if (!agent || !runtime || agent.status !== 'waiting' || this.showPending(agent)) return;
    if (decision?.behavior === 'deny' && decision.interrupt === true) {
      runtime.hold = 'interrupted';
      this.update(agent, 'idle');
    } else if (outcome === 'allowed' || outcome === 'answered' || outcome === 'denied') {
      this.update(agent, 'thinking');
    }
  }

  private advanceHold(runtime: Runtime, event: HookEvent): void {
    if (event === 'UserPromptSubmit' && runtime.hold === 'interrupted') runtime.hold = 'resumed';
    else if (event === 'Stop' && runtime.hold === 'resumed') runtime.hold = 'none';
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
    const resumedAt = agent.sessionId ? this.now() : null;
    const runtime: Runtime = {
      process,
      queue: new MessageQueue(
        (data) => {
          process.write(data);
        },
        { isPending: async (text) => holdsPrompt(visibleTail(await process.snapshot()), text) },
      ),
      readyTimer: null,
      visitTimers: new Set(),
      trustAttempts: 0,
      trustRetry: null,
      trustOpen: false,
      trustWindow: true,
      trustCheck: null,
      recheckTrust: false,
      hold: 'none',
      sessionId: null,
      transcriptPath: null,
      session: null,
      lastSignalAt: this.now(),
      unsubscribe: [],
    };
    runtime.unsubscribe.push(
      process.onOutput((data) => {
        this.deps.emit({ type: 'term:output', agentId: agent.id, data });
        if (runtime.trustWindow) void this.checkTrust(agent, runtime);
      }),
      process.onExit(() => {
        if (
          resumedAt !== null &&
          runtime.sessionId === null &&
          this.now() - resumedAt < RESUME_FAIL_MS
        ) {
          agent.sessionId = null;
          void this.persist().catch(() => undefined);
        }
        this.broker.releaseAgent(agent.id);
        this.clearReadyTimer(agent.id);
        clearTrustRetry(runtime);
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
      void this.settleReady(agent, runtime);
    }, READY_TIMEOUT_MS);
    return true;
  }

  private spawnSpec(agent: Agent, files: AgentFilePaths): SpawnSpec {
    const { claude, baseEnv, token, port } = this.deps;
    return {
      command: claude.command,
      args: [
        ...claude.args,
        '--settings',
        files.settings,
        '--mcp-config',
        files.mcp,
        '--permission-mode',
        agent.permissionMode,
        ...(agent.sessionId ? ['--resume', agent.sessionId] : []),
      ],
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

  private async settleReady(agent: Agent, runtime: Runtime): Promise<void> {
    if (runtime.trustWindow) await this.checkTrust(agent, runtime);
    if (agent.status === 'starting' && !runtime.trustOpen) this.update(agent, 'idle');
  }

  private checkTrust(agent: Agent, runtime: Runtime): Promise<void> {
    if (runtime.trustCheck) {
      runtime.recheckTrust = true;
      return runtime.trustCheck;
    }
    runtime.trustCheck = this.runTrustChecks(agent, runtime).catch(() => undefined);
    return runtime.trustCheck;
  }

  private async runTrustChecks(agent: Agent, runtime: Runtime): Promise<void> {
    try {
      do {
        runtime.recheckTrust = false;
        await this.inspectTrust(agent, runtime);
      } while (wantsRecheck(runtime));
    } finally {
      runtime.trustCheck = null;
    }
  }

  private async inspectTrust(agent: Agent, runtime: Runtime): Promise<void> {
    const screen = visibleTail(await runtime.process.snapshot());
    const wasOpen = runtime.trustOpen;
    runtime.trustOpen = detectTrustPrompt(screen);
    if (!runtime.trustOpen) {
      if (!wasOpen) return;
      if (agent.status === 'starting') this.tryDeliver(agent);
      else this.update(agent, 'idle');
      return;
    }
    const answer = trustAnswer(screen);
    if (answer) {
      runtime.trustWindow = false;
      runtime.trustOpen = false;
      this.answerTrust(agent, runtime, answer);
    } else if (!wasOpen) {
      this.awaitUser(agent);
    }
  }

  private awaitUser(agent: Agent): void {
    this.update(agent, 'waiting', null, 'trust');
    this.record('waiting', agent.id);
  }

  private answerTrust(agent: Agent, runtime: Runtime, answer: string): void {
    runtime.trustAttempts += 1;
    runtime.process.write(answer);
    runtime.trustRetry = setTimeout(() => {
      runtime.trustRetry = null;
      void this.verifyTrust(agent, runtime).catch(() => undefined);
    }, TRUST_RETRY_MS);
  }

  private async verifyTrust(agent: Agent, runtime: Runtime): Promise<void> {
    const screen = visibleTail(await runtime.process.snapshot());
    if (this.runtimes.get(agent.id) !== runtime || runtime.trustRetry !== null) return;
    if (!detectTrustPrompt(screen)) return;
    const answer = trustAnswer(screen);
    if (answer && runtime.trustAttempts < MAX_TRUST_ATTEMPTS) {
      this.answerTrust(agent, runtime, answer);
      return;
    }
    if (agent.status === 'starting' || agent.status === 'idle') this.awaitUser(agent);
  }

  private tryDeliver(agent: Agent): void {
    const runtime = this.runtimes.get(agent.id);
    if (!runtime || runtime.trustOpen || runtime.hold !== 'none' || agent.status !== 'idle') return;
    const message = runtime.queue.deliverNext();
    if (!message) return;
    agent.queued = runtime.queue.size;
    this.update(agent, 'thinking');
    if (message.fromId !== null) {
      this.record('delivered', message.fromId, agent.id);
      this.deps.emit({ type: 'message:delivered', fromId: message.fromId, toId: agent.id });
    }
  }

  private update(
    agent: Agent,
    status: Agent['status'],
    tool: Agent['tool'] = null,
    waitingFor: Agent['waitingFor'] = null,
  ): void {
    agent.setStatus(status, tool, waitingFor);
    const runtime = this.runtimes.get(agent.id);
    if (runtime) runtime.lastSignalAt = this.now();
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
    this.broker.releaseAgent(id);
    this.clearReadyTimer(id);
    clearTrustRetry(runtime);
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
