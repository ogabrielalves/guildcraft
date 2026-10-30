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

export interface AgentActivity {
  agentId: string;
  title: string | null;
  actions: AgentAction[];
  tasks: AgentTask[];
}

export function emptyActivity(agentId: string): AgentActivity {
  return { agentId, title: null, actions: [], tasks: [] };
}
