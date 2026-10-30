import type { AgentActivity } from './activity.js';
import type { AgentView, PermissionMode, VillageEvent } from './agent.js';
import { isPermissionMode } from './agent.js';
import {
  MAX_AGENTS,
  MAX_NAME_LENGTH,
  MAX_PATH_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_TERM_COLS,
  MAX_TERM_INPUT_LENGTH,
  MAX_TERM_ROWS,
} from './constants.js';
import type { ErrorCode, ErrorParams } from './errors.js';
import type { PermissionDecision, PermissionOutcome, PermissionRequestView } from './permission.js';
import { parsePermissionDecision } from './permission.js';

export type ClientMessage =
  | { type: 'term:input'; agentId: string; data: string }
  | { type: 'term:resize'; agentId: string; cols: number; rows: number }
  | {
      type: 'agent:create';
      name: string;
      cwd: string;
      skin: string;
      permissionMode: PermissionMode;
    }
  | { type: 'agent:remove'; agentId: string }
  | { type: 'agent:removeAll' }
  | { type: 'agent:restart'; agentId: string }
  | { type: 'agent:interrupt'; agentId: string }
  | { type: 'agent:setSkin'; agentId: string; skin: string }
  | { type: 'prompt:send'; agentIds: string[]; text: string }
  | { type: 'permission:decide'; requestId: string; decision: PermissionDecision };

export type ServerMessage =
  | {
      type: 'session:init';
      agents: AgentView[];
      events: VillageEvent[];
      skins: string[];
      permissions: PermissionRequestView[];
      activities: AgentActivity[];
    }
  | { type: 'term:snapshot' | 'term:output'; agentId: string; data: string }
  | { type: 'term:reset'; agentId: string }
  | { type: 'agent:updated'; agent: AgentView }
  | { type: 'agent:removed'; agentId: string }
  | { type: 'agent:activity'; activity: AgentActivity }
  | { type: 'agent:visit'; fromId: string; toId: string; preview: string }
  | { type: 'message:delivered'; fromId: string; toId: string }
  | { type: 'event'; event: VillageEvent }
  | { type: 'permission:request'; request: PermissionRequestView }
  | {
      type: 'permission:resolved';
      requestId: string;
      agentId: string;
      outcome: PermissionOutcome;
    }
  | {
      type: 'error';
      code: ErrorCode;
      source?: ClientMessage['type'];
      params?: ErrorParams;
    };

const MAX_ID_LENGTH = 64;
const MAX_SKIN_LENGTH = 64;

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0);
}

function isSize(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max;
}

function isId(value: unknown): value is string {
  return isText(value, MAX_ID_LENGTH);
}

function parseFields(type: string, m: Fields): ClientMessage | null {
  switch (type) {
    case 'term:input':
      return isId(m.agentId) && isText(m.data, MAX_TERM_INPUT_LENGTH)
        ? { type, agentId: m.agentId, data: m.data }
        : null;
    case 'term:resize':
      return isId(m.agentId) && isSize(m.cols, MAX_TERM_COLS) && isSize(m.rows, MAX_TERM_ROWS)
        ? { type, agentId: m.agentId, cols: m.cols, rows: m.rows }
        : null;
    case 'agent:create':
      return isText(m.name, MAX_NAME_LENGTH) &&
        isText(m.cwd, MAX_PATH_LENGTH) &&
        isText(m.skin, MAX_SKIN_LENGTH) &&
        isPermissionMode(m.permissionMode)
        ? { type, name: m.name, cwd: m.cwd, skin: m.skin, permissionMode: m.permissionMode }
        : null;
    case 'agent:remove':
    case 'agent:restart':
    case 'agent:interrupt':
      return isId(m.agentId) ? { type, agentId: m.agentId } : null;
    case 'agent:removeAll':
      return { type };
    case 'agent:setSkin':
      return isId(m.agentId) && isText(m.skin, MAX_SKIN_LENGTH)
        ? { type, agentId: m.agentId, skin: m.skin }
        : null;
    case 'prompt:send':
      return Array.isArray(m.agentIds) &&
        m.agentIds.length > 0 &&
        m.agentIds.length <= MAX_AGENTS &&
        m.agentIds.every(isId) &&
        isText(m.text, MAX_PROMPT_LENGTH)
        ? { type, agentIds: m.agentIds, text: m.text }
        : null;
    case 'permission:decide': {
      const decision = parsePermissionDecision(m.decision);
      return isId(m.requestId) && decision ? { type, requestId: m.requestId, decision } : null;
    }
    default:
      return null;
  }
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  return parseFields(raw.type, raw);
}

export function decodeClientMessage(text: string): ClientMessage | null {
  try {
    return parseClientMessage(JSON.parse(text));
  } catch {
    return null;
  }
}
