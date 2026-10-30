import { TOKEN_HEADER } from '../../shared/constants.js';
import type { PermissionAnswer, PermissionDecision } from '../../shared/permission.js';

export const PERMISSION_EVENT = 'PermissionRequest';
export const PERMISSION_HOOK_TIMEOUT_S = 660;
export const PERMISSION_DEADLINE_MS = 620_000;
export const REGISTER_TIMEOUT_MS = 2_000;
export const POLL_SECONDS = 25;
export const MAX_INPUT_STRING = 8_000;
export const MAX_BODY_LENGTH = 200_000;
export const DENY_PREFIX = 'Denied by the user in Guildcraft';

const QUESTION_TOOL = 'AskUserQuestion';
const MAX_DEPTH = 8;
const MAX_ARRAY = 200;

type Fields = Record<string, unknown>;

export interface PermissionInput {
  tool_name: string;
  tool_input: Fields;
  permission_suggestions?: unknown;
  agent_id?: string;
  agent_type?: string;
}

export interface PermissionRelayInput {
  port: number;
  agentId: string;
  token: string;
  stdin: string;
  fetch: typeof fetch;
  now?: () => number;
  deadlineMs?: number;
}

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function trimInput(value: unknown, max: number, depth = 0): unknown {
  if (typeof value === 'string') return value.length > max ? value.slice(0, max) : value;
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => trimInput(item, max, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, trimInput(item, max, depth + 1)]),
  );
}

export function parsePermissionInput(text: string): PermissionInput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !filled(raw.tool_name)) return null;
  if (raw.hook_event_name !== undefined && raw.hook_event_name !== PERMISSION_EVENT) return null;
  return {
    ...raw,
    tool_name: raw.tool_name,
    tool_input: isRecord(raw.tool_input) ? raw.tool_input : {},
  };
}

export function requestBody(input: PermissionInput): Fields {
  const body: Fields = { tool_name: input.tool_name };
  if (Array.isArray(input.permission_suggestions)) {
    body.permission_suggestions = input.permission_suggestions;
  }
  if (typeof input.agent_id === 'string') body.agent_id = input.agent_id;
  if (typeof input.agent_type === 'string') body.agent_type = input.agent_type;
  for (const max of [MAX_INPUT_STRING, 1_000, 200]) {
    body.tool_input = trimInput(input.tool_input, max);
    if (JSON.stringify(body).length <= MAX_BODY_LENGTH) break;
  }
  return body;
}

function labelsFor(answer: PermissionAnswer, question: Fields): string[] | null {
  const options = Array.isArray(question.options) ? question.options : [];
  const parts: string[] = [];
  for (const index of answer.options) {
    const option: unknown = options[index];
    if (!isRecord(option) || !filled(option.label)) return null;
    parts.push(option.label);
  }
  if (filled(answer.other)) parts.push(answer.other.trim());
  if (parts.length === 0 || (question.multiSelect !== true && parts.length > 1)) return null;
  return parts;
}

export function answersFor(
  answers: readonly PermissionAnswer[],
  toolInput: Fields,
): Record<string, string> | null {
  const questions = Array.isArray(toolInput.questions) ? toolInput.questions : null;
  if (questions?.length !== answers.length) return null;
  const result: Record<string, string> = {};
  for (const answer of answers) {
    const question: unknown = questions[answer.question];
    if (!isRecord(question) || !filled(question.question)) return null;
    if (Object.hasOwn(result, question.question)) return null;
    const labels = labelsFor(answer, question);
    if (!labels) return null;
    result[question.question] = labels.join(', ');
  }
  return result;
}

function output(decision: Fields): string {
  return `${JSON.stringify({
    hookSpecificOutput: { hookEventName: PERMISSION_EVENT, decision },
  })}\n`;
}

export function decisionOutput(
  decision: PermissionDecision,
  input: PermissionInput,
): string | null {
  const asking = input.tool_name === QUESTION_TOOL;
  switch (decision.behavior) {
    case 'answer': {
      const answers = asking ? answersFor(decision.answers, input.tool_input) : null;
      return answers
        ? output({ behavior: 'allow', updatedInput: { ...input.tool_input, answers } })
        : null;
    }
    case 'allow': {
      if (asking) return null;
      const suggestions = Array.isArray(input.permission_suggestions)
        ? input.permission_suggestions
        : [];
      const chosen: unknown =
        decision.suggestion === undefined ? undefined : suggestions[decision.suggestion];
      return output(
        isRecord(chosen)
          ? { behavior: 'allow', updatedPermissions: [chosen] }
          : { behavior: 'allow' },
      );
    }
    case 'deny': {
      const message = decision.message ? `${DENY_PREFIX}: ${decision.message}` : `${DENY_PREFIX}.`;
      return output(
        decision.interrupt
          ? { behavior: 'deny', message, interrupt: true }
          : { behavior: 'deny', message },
      );
    }
    case 'terminal':
      return null;
  }
}

async function call(
  input: PermissionRelayInput,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; json: unknown } | null> {
  try {
    const response = await input.fetch(`http://127.0.0.1:${input.port}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: input.token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch {
    return null;
  }
}

export async function relayPermission(input: PermissionRelayInput): Promise<string | null> {
  const now = input.now ?? Date.now;
  const permission = parsePermissionInput(input.stdin);
  if (!permission) return null;
  const deadline = now() + (input.deadlineMs ?? PERMISSION_DEADLINE_MS);
  const base = `/hook/${input.agentId}/permission`;
  const opened = await call(
    input,
    base,
    { method: 'POST', body: JSON.stringify(requestBody(permission)) },
    REGISTER_TIMEOUT_MS,
  );
  if (opened?.status !== 201 || !isRecord(opened.json) || !filled(opened.json.id)) return null;
  const path = `${base}/${encodeURIComponent(opened.json.id)}`;
  for (;;) {
    const left = deadline - now();
    if (left <= 0) return null;
    const seconds = Math.max(0.05, Math.min(POLL_SECONDS, left / 1_000));
    const result = await call(
      input,
      `${path}?timeout=${seconds}`,
      { method: 'GET' },
      seconds * 1_000 + 5_000,
    );
    if (result?.status !== 200 || !isRecord(result.json)) return null;
    if (result.json.status === 'pending') continue;
    if (result.json.status !== 'decided' || !isRecord(result.json.decision)) return null;
    return decisionOutput(result.json.decision as PermissionDecision, permission);
  }
}
