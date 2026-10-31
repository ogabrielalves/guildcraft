import { describe, expect, it } from 'vitest';
import type { AgentStatus, AgentView } from '../../shared/agent.js';
import type { Activity } from './activity.js';
import type { IdlePlan } from './activity.js';
import {
  ACTIVITIES,
  IDLE_PLANS,
  IDLE_TIME,
  IDLE_WEIGHTS,
  REPEAT_PENALTY,
  WORKING_ACTIVITIES,
  activityOf,
  idleSpot,
  idleTime,
  isWorkingActivity,
  pickIdle,
} from './activity.js';

function agent(status: AgentStatus, toolName?: string): Pick<AgentView, 'status' | 'tool'> {
  return { status, tool: toolName === undefined ? null : { name: toolName, detail: '' } };
}

describe('activityOf', () => {
  it.each<[AgentStatus, Activity]>([
    ['offline', 'off'],
    ['starting', 'sleep'],
    ['idle', 'idle'],
    ['thinking', 'think'],
    ['waiting', 'wait'],
  ])('maps status %s to %s', (status, expected) => {
    expect(activityOf(agent(status))).toBe(expected);
  });

  it('ignores a stale tool outside the tool status', () => {
    expect(activityOf(agent('thinking', 'Bash'))).toBe('think');
  });

  it.each<[string, Activity]>([
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
    ['mcp__guildcraft__send_message', 'tool'],
    ['toString', 'tool'],
  ])('maps tool %s to %s', (toolName, expected) => {
    expect(activityOf(agent('tool', toolName))).toBe(expected);
  });

  it('falls back to tool when the tool is unknown', () => {
    expect(activityOf(agent('tool'))).toBe('tool');
  });
});

describe('isWorkingActivity', () => {
  it.each(ACTIVITIES)('flags %s', (activity) => {
    const working: readonly Activity[] = WORKING_ACTIVITIES;
    expect(isWorkingActivity(activity)).toBe(working.includes(activity));
  });

  it.each(['write', 'term', 'web', 'plan', 'tool'] as const)('animates the station on %s', (a) => {
    expect(isWorkingActivity(a)).toBe(true);
  });
});

describe('pickIdle', () => {
  const all = () => true;
  const total = IDLE_PLANS.reduce((sum, plan) => sum + IDLE_WEIGHTS[plan], 0);

  it('walks the weights in order', () => {
    expect(pickIdle(all, () => 0)).toBe('wander');
    expect(pickIdle(all, () => (IDLE_WEIGHTS.wander + 0.5) / total)).toBe('hearth');
    expect(pickIdle(all, () => 0.9999)).toBe('bench');
  });

  it('only offers the plans that are available, and always wander', () => {
    const seen = new Set<IdlePlan>();
    for (let i = 0; i < 100; i++)
      seen.add(
        pickIdle(
          (plan) => plan === 'chat',
          () => i / 100,
        ),
      );
    expect([...seen].sort()).toEqual(['chat', 'wander']);
    expect(
      pickIdle(
        () => false,
        () => 0.99,
      ),
    ).toBe('wander');
  });

  it('makes the previous plan less likely', () => {
    const count = (previous: IdlePlan | null) => {
      let hits = 0;
      for (let i = 0; i < 1000; i++) if (pickIdle(all, () => i / 1000, previous) === 'chat') hits++;
      return hits;
    };
    const fresh = count(null);
    const repeated = count('chat');
    expect(repeated).toBeLessThan(fresh);
    expect(repeated / fresh).toBeGreaterThan(REPEAT_PENALTY / 2);
  });

  it('never penalizes wandering', () => {
    expect(
      pickIdle(
        () => false,
        () => 0.5,
        'wander',
      ),
    ).toBe('wander');
  });

  it('accepts custom weights and skips the zero ones', () => {
    const weights = { wander: 0, hearth: 0, bookshelf: 1, table: 0, chat: 0, nap: 0, bench: 0 };
    expect(pickIdle(all, () => 0.3, null, weights)).toBe('bookshelf');
    expect(
      pickIdle(
        () => false,
        () => 0.3,
        null,
        weights,
      ),
    ).toBe('wander');
  });
});

describe('idleSpot', () => {
  it.each<[IdlePlan, string | null]>([
    ['wander', null],
    ['chat', null],
    ['hearth', 'hearth'],
    ['bookshelf', 'read'],
    ['table', 'table'],
    ['nap', 'nap'],
    ['bench', 'bench'],
  ])('sends %s to %s', (plan, kind) => {
    expect(idleSpot(plan)).toBe(kind);
  });
});

describe('idleTime', () => {
  it.each(IDLE_PLANS)('keeps %s inside its range', (plan) => {
    const { min, max } = IDLE_TIME[plan];
    expect(idleTime(plan, () => 0)).toBe(min);
    expect(idleTime(plan, () => 0.999)).toBeLessThan(max);
    const value = idleTime(plan);
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThan(max);
  });
});
