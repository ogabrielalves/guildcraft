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
  queued = 0;

  constructor(init: AgentInit) {
    this.id = init.id ?? randomUUID();
    this.name = init.name;
    this.cwd = init.cwd;
    this.skin = init.skin;
    this.permissionMode = init.permissionMode;
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
      queued: this.queued,
    };
  }

  toStored(): StoredAgent {
    return {
      id: this.id,
      name: this.name,
      cwd: this.cwd,
      skin: this.skin,
      permissionMode: this.permissionMode,
    };
  }
}
