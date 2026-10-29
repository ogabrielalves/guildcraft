import type { AgentStatus, AgentTool, VillageEventKind } from '../../shared/agent.js';
import { describeTool } from './describe-tool.js';
import type { HookEvent } from './hook-events.js';

export interface HookPayload {
  toolName: string | null;
  toolInput: unknown;
  message: string | null;
  notificationType: string | null;
  source: string | null;
}

export interface HookOutcome {
  status: AgentStatus;
  tool: AgentTool | null;
  event: VillageEventKind | null;
}

const BLOCKING_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog']);
const PERMISSION_MESSAGE = /permission/i;
const QUESTION_TOOL = 'AskUserQuestion';

const EMPTY_PAYLOAD: HookPayload = {
  toolName: null,
  toolInput: null,
  message: null,
  notificationType: null,
  source: null,
};

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function parseHookPayload(raw: unknown): HookPayload {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_PAYLOAD };
  const record = raw as Record<string, unknown>;
  return {
    toolName: stringField(record, 'tool_name'),
    toolInput: record.tool_input ?? null,
    message: stringField(record, 'message'),
    notificationType: stringField(record, 'notification_type'),
    source: stringField(record, 'source'),
  };
}

function outcome(
  status: AgentStatus,
  event: VillageEventKind | null = null,
  tool: AgentTool | null = null,
): HookOutcome {
  return { status, tool, event };
}

function blocksOnUser({ notificationType, message }: HookPayload): boolean {
  if (notificationType !== null) return BLOCKING_NOTIFICATIONS.has(notificationType);
  return message !== null && PERMISSION_MESSAGE.test(message);
}

export function handleHook(
  event: HookEvent,
  payload: HookPayload,
  current: AgentStatus,
): HookOutcome | null {
  if (current === 'offline') return null;
  switch (event) {
    case 'SessionStart':
      return payload.source === 'compact' ? null : outcome('idle');
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return outcome('thinking');
    case 'PreToolUse': {
      const name = payload.toolName ?? 'tool';
      const tool = { name, detail: describeTool(name, payload.toolInput) };
      return name === QUESTION_TOOL
        ? outcome('waiting', 'waiting', tool)
        : outcome('tool', null, tool);
    }
    case 'Notification':
      return blocksOnUser(payload) ? outcome('waiting', 'waiting') : null;
    case 'Stop':
      return outcome('idle', 'finished');
  }
}
