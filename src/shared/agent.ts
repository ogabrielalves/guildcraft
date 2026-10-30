export const AGENT_STATUSES = [
  'offline',
  'starting',
  'idle',
  'thinking',
  'tool',
  'waiting',
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const WAITING_REASONS = ['permission', 'question', 'trust', 'dialog', 'other'] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

export interface AgentTool {
  name: string;
  detail: string;
}

export interface AgentView {
  id: string;
  name: string;
  cwd: string;
  skin: string;
  status: AgentStatus;
  permissionMode: PermissionMode;
  tool: AgentTool | null;
  waitingFor: WaitingReason | null;
  model: string | null;
  effort: string | null;
  queued: number;
}

export const VILLAGE_EVENT_KINDS = [
  'joined',
  'left',
  'finished',
  'waiting',
  'prompted',
  'messaged',
  'delivered',
] as const;
export type VillageEventKind = (typeof VILLAGE_EVENT_KINDS)[number];

export interface VillageEvent {
  kind: VillageEventKind;
  agentId: string;
  targetId?: string;
  at: number;
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.some((mode) => mode === value);
}
