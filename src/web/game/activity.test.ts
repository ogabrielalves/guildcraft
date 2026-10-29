import { describe, expect, it } from 'vitest';
import type { AgentStatus, AgentView } from '../../shared/agent.js';
import type { Activity } from './activity.js';
import { ACTIVITIES, WORKING_ACTIVITIES, activityOf, isWorkingActivity } from './activity.js';

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
