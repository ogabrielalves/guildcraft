import { randomUUID } from 'node:crypto';
import type { ErrorCode } from '../../shared/errors.js';
import type {
  PermissionDecision,
  PermissionOutcome,
  PermissionRequestView,
} from '../../shared/permission.js';
import type { ServerMessage } from '../../shared/protocol.js';
import { describeTool } from '../hooks/describe-tool.js';
import type { SessionEntry } from '../sessions/session-registry.js';
import type { PermissionHookBody } from './request.js';
import { QUESTION_TOOL, answersFit, inputPreview, parseHookBody } from './request.js';
import { callSignature, scanToolCall } from './tool-call.js';

export const PERMISSION_TIMEOUT_MS = 10 * 60_000;
export const MAX_WAIT_MS = 25_000;
export const ORPHAN_MS = 8_000;
export const DECIDED_KEEP_MS = 30_000;
export const SESSION_SETTLE_MS = 3_000;
export const MAX_PENDING = 32;

export type SkipReason = 'no-viewers' | 'unsupported' | 'too-many';

export type OpenResult =
  | { ok: true; id: string; expiresAt: number }
  | { ok: false; skip: SkipReason }
  | { ok: false; invalid: true };

export type WaitResult =
  | { status: 'pending' }
  | { status: 'decided'; decision: PermissionDecision }
  | { status: 'released' };

export interface AgentContext {
  transcriptPath: string | null;
  session: SessionEntry | null;
}

export interface BrokerDeps {
  emit: (message: ServerMessage) => void;
  hasViewers: () => boolean;
  onResolved: (
    agentId: string,
    outcome: PermissionOutcome,
    decision: PermissionDecision | null,
  ) => void;
  readLines: (path: string) => Promise<string[]>;
  now?: () => number;
  newId?: () => string;
}

interface Pending {
  view: PermissionRequestView;
  body: PermissionHookBody;
  signature: string;
  toolUseId: string | null;
  waiters: Set<(result: WaitResult) => void>;
  lastPollAt: number;
}

interface Settled {
  result: WaitResult;
  until: number;
}

export class PermissionBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly settled = new Map<string, Settled>();
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: BrokerDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  list(): PermissionRequestView[] {
    return [...this.pending.values()].map((entry) => entry.view);
  }

  oldestFor(agentId: string): PermissionRequestView | null {
    for (const entry of this.pending.values())
      if (entry.view.agentId === agentId) return entry.view;
    return null;
  }

  open(agentId: string, raw: unknown): OpenResult {
    const parsed = parseHookBody(raw);
    if (!parsed.ok)
      return parsed.unsupported ? { ok: false, skip: 'unsupported' } : { ok: false, invalid: true };
    if (!this.deps.hasViewers()) return { ok: false, skip: 'no-viewers' };
    if (this.pending.size >= MAX_PENDING) return { ok: false, skip: 'too-many' };
    const { body } = parsed;
    const createdAt = this.now();
    const view: PermissionRequestView = {
      id: this.newId(),
      agentId,
      toolName: body.toolName,
      detail: describeTool(body.toolName, body.toolInput),
      input: inputPreview(body.toolName, body.toolInput),
      subagent: body.subagent,
      suggestions: body.suggestions,
      questions: body.questions,
      createdAt,
      expiresAt: createdAt + PERMISSION_TIMEOUT_MS,
    };
    this.pending.set(view.id, {
      view,
      body,
      signature: callSignature(body.toolName, body.toolInput),
      toolUseId: null,
      waiters: new Set(),
      lastPollAt: createdAt,
    });
    this.deps.emit({ type: 'permission:request', request: view });
    return { ok: true, id: view.id, expiresAt: view.expiresAt };
  }

  wait(agentId: string, id: string, timeoutMs: number): Promise<WaitResult> | null {
    const settled = this.settled.get(id);
    if (settled) {
      this.settled.delete(id);
      return Promise.resolve(settled.result);
    }
    const entry = this.pending.get(id);
    if (entry?.view.agentId !== agentId) return null;
    entry.lastPollAt = this.now();
    const ms = Math.max(0, Math.min(timeoutMs, MAX_WAIT_MS));
    return new Promise((resolve) => {
      const done = (result: WaitResult) => {
        clearTimeout(timer);
        entry.waiters.delete(done);
        entry.lastPollAt = this.now();
        resolve(result);
      };
      const timer = setTimeout(() => {
        done({ status: 'pending' });
      }, ms);
      entry.waiters.add(done);
    });
  }

  decide(id: string, decision: PermissionDecision): ErrorCode | null {
    const entry = this.pending.get(id);
    if (!entry) return 'PERMISSION_NOT_FOUND';
    const invalid = this.check(entry, decision);
    if (invalid) return invalid;
    if (decision.behavior === 'terminal') {
      this.finish(entry, 'terminal', { status: 'released' }, null);
      return null;
    }
    const outcome: PermissionOutcome =
      decision.behavior === 'allow'
        ? 'allowed'
        : decision.behavior === 'deny'
          ? 'denied'
          : 'answered';
    this.finish(entry, outcome, { status: 'decided', decision }, decision);
    return null;
  }

  release(id: string): void {
    const entry = this.pending.get(id);
    if (entry) this.finish(entry, 'released', { status: 'released' }, null);
  }

  releaseAgent(agentId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.view.agentId === agentId) this.release(entry.view.id);
    }
  }

  releaseCall(agentId: string, toolName: string, input: unknown): void {
    const signature = callSignature(toolName, input);
    for (const entry of this.pending.values()) {
      if (entry.view.agentId === agentId && entry.signature === signature) {
        this.release(entry.view.id);
        return;
      }
    }
  }

  async sweep(contextOf: (agentId: string) => AgentContext | null): Promise<void> {
    const now = this.now();
    for (const [id, settled] of this.settled) if (settled.until <= now) this.settled.delete(id);
    for (const entry of [...this.pending.values()]) {
      const context = contextOf(entry.view.agentId);
      if (
        !context ||
        entry.view.expiresAt <= now ||
        (entry.waiters.size === 0 && now - entry.lastPollAt > ORPHAN_MS) ||
        (await this.answeredElsewhere(entry, context))
      ) {
        this.release(entry.view.id);
      }
    }
  }

  private async answeredElsewhere(entry: Pending, context: AgentContext): Promise<boolean> {
    if (entry.view.subagent !== null) return false;
    if (context.transcriptPath) {
      try {
        const scan = scanToolCall(await this.deps.readLines(context.transcriptPath), {
          toolName: entry.view.toolName,
          signature: entry.signature,
          createdAt: entry.view.createdAt,
          knownId: entry.toolUseId,
        });
        entry.toolUseId = scan.toolUseId;
        if (scan.answered) return true;
        if (scan.toolUseId) return false;
      } catch {
        return false;
      }
    }
    const { session } = context;
    return (
      session !== null &&
      session.state !== 'waiting' &&
      session.statusAt !== null &&
      session.statusAt > entry.view.createdAt + SESSION_SETTLE_MS
    );
  }

  private check(entry: Pending, decision: PermissionDecision): ErrorCode | null {
    const { questions, suggestions, toolName } = entry.view;
    const asking = toolName === QUESTION_TOOL;
    switch (decision.behavior) {
      case 'allow':
        if (asking) return 'INVALID_MESSAGE';
        if (decision.suggestion === undefined) return null;
        return suggestions.some((suggestion) => suggestion.index === decision.suggestion)
          ? null
          : 'INVALID_MESSAGE';
      case 'answer':
        return asking && questions && answersFit(questions, decision.answers)
          ? null
          : 'INVALID_MESSAGE';
      default:
        return null;
    }
  }

  private finish(
    entry: Pending,
    outcome: PermissionOutcome,
    result: WaitResult,
    decision: PermissionDecision | null,
  ): void {
    const { id, agentId } = entry.view;
    this.pending.delete(id);
    if (entry.waiters.size > 0) {
      for (const waiter of [...entry.waiters]) waiter(result);
    } else {
      this.settled.set(id, { result, until: this.now() + DECIDED_KEEP_MS });
    }
    this.deps.emit({ type: 'permission:resolved', requestId: id, agentId, outcome });
    this.deps.onResolved(agentId, outcome, decision);
  }
}
