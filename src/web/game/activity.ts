import type { AgentStatus, AgentView } from '../../shared/agent.js';

export const ACTIVITIES = [
  'write',
  'term',
  'web',
  'plan',
  'tool',
  'think',
  'read',
  'wait',
  'idle',
  'sleep',
  'off',
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const WORKING_ACTIVITIES = ['write', 'term', 'web', 'plan', 'tool'] as const;
export type WorkingActivity = (typeof WORKING_ACTIVITIES)[number];

const STATUS_ACTIVITY: Record<Exclude<AgentStatus, 'tool'>, Activity> = {
  offline: 'off',
  starting: 'sleep',
  idle: 'idle',
  thinking: 'think',
  waiting: 'wait',
};

const TOOL_ACTIVITY = new Map<string, Activity>([
  ['Edit', 'write'],
  ['Write', 'write'],
  ['MultiEdit', 'write'],
  ['NotebookEdit', 'write'],
  ['Bash', 'term'],
  ['PowerShell', 'term'],
  ['WebFetch', 'web'],
  ['WebSearch', 'web'],
  ['Read', 'read'],
  ['Grep', 'read'],
  ['Glob', 'read'],
  ['LS', 'read'],
  ['TodoWrite', 'plan'],
  ['ExitPlanMode', 'plan'],
  ['Task', 'plan'],
]);

export function activityOf(agent: Pick<AgentView, 'status' | 'tool'>): Activity {
  if (agent.status !== 'tool') return STATUS_ACTIVITY[agent.status];
  return toolActivity(agent.tool?.name);
}

export function toolActivity(toolName: string | undefined): Activity {
  return (toolName === undefined ? undefined : TOOL_ACTIVITY.get(toolName)) ?? 'tool';
}

export function isWorkingActivity(activity: Activity): activity is WorkingActivity {
  return WORKING_ACTIVITIES.some((working) => working === activity);
}
