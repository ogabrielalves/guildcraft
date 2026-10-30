import type {
  AgentStatus,
  AgentTool,
  VillageEventKind,
  WaitingReason,
} from '../../shared/agent.js';
import { describeTool } from './describe-tool.js';
import type { HookEvent } from './hook-events.js';

export interface HookPayload {
  toolName: string | null;
  toolInput: unknown;
  message: string | null;
  notificationType: string | null;
  source: string | null;
  sessionId: string | null;
  transcriptPath: string | null;
}

export interface HookOutcome {
  status: AgentStatus;
  tool: AgentTool | null;
  event: VillageEventKind | null;
  waitingFor: WaitingReason | null;
}

const BLOCKING_NOTIFICATIONS: Record<string, WaitingReason> = {
  permission_prompt: 'permission',
  elicitation_dialog: 'question',
};
const PERMISSION_MESSAGE = /permission/i;
const QUESTION_TOOL = 'AskUserQuestion';

const EMPTY_PAYLOAD: HookPayload = {
  toolName: null,
  toolInput: null,
  message: null,
  notificationType: null,
  source: null,
  sessionId: null,
  transcriptPath: null,
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
    sessionId: stringField(record, 'session_id'),
    transcriptPath: stringField(record, 'transcript_path'),
  };
}

function outcome(
  status: AgentStatus,
  event: VillageEventKind | null = null,
  tool: AgentTool | null = null,
  waitingFor: WaitingReason | null = null,
): HookOutcome {
  return { status, tool, event, waitingFor };
}

function blockingReason({ notificationType, message }: HookPayload): WaitingReason | null {
  if (notificationType !== null) return BLOCKING_NOTIFICATIONS[notificationType] ?? null;
  return message !== null && PERMISSION_MESSAGE.test(message) ? 'permission' : null;
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
        ? outcome('waiting', 'waiting', tool, 'question')
        : outcome('tool', null, tool);
    }
    case 'Notification': {
      const reason = blockingReason(payload);
      return reason ? outcome('waiting', 'waiting', null, reason) : null;
    }
    case 'Stop':
      return outcome('idle', 'finished');
  }
}
