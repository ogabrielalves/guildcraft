export const MAX_ACTIONS = 40;
export const MAX_TASKS = 50;

export const ACTION_STATES = ['running', 'done', 'error', 'rejected', 'interrupted'] as const;
export type ActionState = (typeof ACTION_STATES)[number];

export const TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface AgentAction {
  id: string;
  tool: string;
  detail: string;
  state: ActionState;
  result: string | null;
  startedAt: number;
  endedAt: number | null;
}

export interface AgentTask {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AgentActivity {
  agentId: string;
  title: string | null;
  actions: AgentAction[];
  tasks: AgentTask[];
  usage: AgentUsage;
}

export function emptyUsage(): AgentUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function emptyActivity(agentId: string): AgentActivity {
  return { agentId, title: null, actions: [], tasks: [], usage: emptyUsage() };
}
