import { randomUUID } from 'node:crypto';
import type {
  AgentStatus,
  AgentTool,
  AgentView,
  PermissionMode,
  WaitingReason,
} from '../../shared/agent.js';
import type { StoredAgent } from '../store/agent-store.js';

export interface AgentInit {
  id?: string;
  name: string;
  cwd: string;
  skin: string;
  permissionMode: PermissionMode;
  sessionId?: string;
}

export class Agent {
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  skin: string;
  permissionMode: PermissionMode;
  status: AgentStatus = 'offline';
  tool: AgentTool | null = null;
  waitingFor: WaitingReason | null = null;
  model: string | null = null;
  effort: string | null = null;
  queued = 0;
  sessionId: string | null;

  constructor(init: AgentInit) {
    this.id = init.id ?? randomUUID();
    this.name = init.name;
    this.cwd = init.cwd;
    this.skin = init.skin;
    this.permissionMode = init.permissionMode;
    this.sessionId = init.sessionId ?? null;
  }

  setStatus(
    status: AgentStatus,
    tool: AgentTool | null = null,
    waitingFor: WaitingReason | null = null,
  ): boolean {
    const nextTool = status === 'tool' ? tool : null;
    const nextReason = status === 'waiting' ? (waitingFor ?? 'other') : null;
    const changed =
      this.status !== status ||
      this.waitingFor !== nextReason ||
      this.tool?.name !== nextTool?.name ||
      this.tool?.detail !== nextTool?.detail;
    this.status = status;
    this.tool = nextTool;
    this.waitingFor = nextReason;
    return changed;
  }

  setModel(model: string, effort: string | null): boolean {
    const changed = this.model !== model || this.effort !== effort;
    this.model = model;
    this.effort = effort;
    return changed;
  }

  toView(): AgentView {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      skin: this.skin,
      status: this.status,
      permissionMode: this.permissionMode,
      tool: this.tool && { ...this.tool },
      waitingFor: this.waitingFor,
      model: this.model,
      effort: this.effort,
      queued: this.queued,
    };
  }

  toStored(): StoredAgent {
    const stored: StoredAgent = {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      skin: this.skin,
      permissionMode: this.permissionMode,
    };
    if (this.sessionId) stored.sessionId = this.sessionId;
    return stored;
  }
}
