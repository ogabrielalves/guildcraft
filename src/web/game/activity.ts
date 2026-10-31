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

export const IDLE_PLANS = [
  'wander',
  'hearth',
  'bookshelf',
  'table',
  'chat',
  'nap',
  'bench',
] as const;
export type IdlePlan = (typeof IDLE_PLANS)[number];

export const IDLE_WEIGHTS: Record<IdlePlan, number> = {
  wander: 4,
  hearth: 2,
  bookshelf: 2,
  table: 2,
  chat: 3,
  nap: 1,
  bench: 2,
};

export const IDLE_TIME: Record<IdlePlan, { min: number; max: number }> = {
  wander: { min: 1.5, max: 4 },
  hearth: { min: 6, max: 12 },
  bookshelf: { min: 5, max: 10 },
  table: { min: 6, max: 12 },
  chat: { min: 4, max: 8 },
  nap: { min: 10, max: 20 },
  bench: { min: 10, max: 20 },
};

export const REPEAT_PENALTY = 0.25;
export const LOUNGE_AFTER = 120;

const IDLE_SPOTS = {
  hearth: 'hearth',
  bookshelf: 'read',
  table: 'table',
  nap: 'nap',
  bench: 'bench',
} as const;

export type IdleSpot = (typeof IDLE_SPOTS)[keyof typeof IDLE_SPOTS];

export function idleSpot(plan: IdlePlan): IdleSpot | null {
  return plan === 'wander' || plan === 'chat' ? null : IDLE_SPOTS[plan];
}

export function pickIdle(
  available: (plan: IdlePlan) => boolean,
  random: () => number = Math.random,
  previous: IdlePlan | null = null,
  weights: Record<IdlePlan, number> = IDLE_WEIGHTS,
): IdlePlan {
  const options = IDLE_PLANS.flatMap((plan) => {
    if (plan !== 'wander' && !available(plan)) return [];
    const weight =
      plan === previous && plan !== 'wander' ? weights[plan] * REPEAT_PENALTY : weights[plan];
    return weight > 0 ? [[plan, weight] as const] : [];
  });
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [plan, weight] of options) {
    if (roll < weight) return plan;
    roll -= weight;
  }
  return 'wander';
}

export function idleTime(plan: IdlePlan, random: () => number = Math.random): number {
  const { min, max } = IDLE_TIME[plan];
  return min + random() * (max - min);
}
