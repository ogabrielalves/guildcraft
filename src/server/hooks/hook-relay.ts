import { AGENT_ID_PATTERN, ENV_PREFIX, TOKEN_HEADER } from '../../shared/constants.js';
import type { HookEvent } from './hook-events.js';
import { isHookEvent } from './hook-events.js';
import { PERMISSION_EVENT, relayPermission } from './permission-relay.js';

export const RELAY_TIMEOUT_MS = 3_000;
export const MAX_STDIN_BYTES = 16 * 1024 * 1024;
export const MAX_FIELD_LENGTH = 1_000;

const PAYLOAD_FIELDS = [
  'tool_name',
  'message',
  'notification_type',
  'source',
  'session_id',
  'transcript_path',
] as const;

export interface RelayTarget {
  port: number;
  agentId: string;
  event: HookEvent | typeof PERMISSION_EVENT;
}

export interface RelayInput {
  args: readonly string[];
  env: Record<string, string | undefined>;
  readStdin: () => Promise<string>;
  fetch: typeof fetch;
  timeoutMs?: number;
}

export function parseRelayArgs([port, agentId, event]: readonly string[]): RelayTarget | null {
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return null;
  if (agentId === undefined || !AGENT_ID_PATTERN.test(agentId)) return null;
  if (event === PERMISSION_EVENT) return { port: portNumber, agentId, event };
  if (!isHookEvent(event)) return null;
  return { port: portNumber, agentId, event };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slimToolInput(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) return undefined;
  const entries = Object.entries(input).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return Object.fromEntries(entries.map(([key, value]) => [key, value.slice(0, MAX_FIELD_LENGTH)]));
}

export function slimPayload(text: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!isRecord(raw)) return {};
  const payload: Record<string, unknown> = {};
  for (const field of PAYLOAD_FIELDS) {
    const value = raw[field];
    if (typeof value === 'string') payload[field] = value.slice(0, MAX_FIELD_LENGTH);
  }
  const toolInput = slimToolInput(raw.tool_input);
  if (toolInput) payload.tool_input = toolInput;
  return payload;
}

export async function readStream(
  stream: AsyncIterable<Buffer | string>,
  maxBytes = MAX_STDIN_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > maxBytes) return '';
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function relayHook(input: RelayInput): Promise<boolean> {
  const target = parseRelayArgs(input.args);
  const token = input.env[`${ENV_PREFIX}TOKEN`];
  if (!target || !token || target.event === PERMISSION_EVENT) return false;
  try {
    const payload = slimPayload(await input.readStdin());
    const response = await input.fetch(
      `http://127.0.0.1:${target.port}/hook/${target.agentId}/${target.event}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', [TOKEN_HEADER]: token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(input.timeoutMs ?? RELAY_TIMEOUT_MS),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function runHook(input: RelayInput): Promise<string | null> {
  const target = parseRelayArgs(input.args);
  const token = input.env[`${ENV_PREFIX}TOKEN`];
  if (target?.event !== PERMISSION_EVENT || !token) {
    await relayHook(input);
    return null;
  }
  try {
    return await relayPermission({
      port: target.port,
      agentId: target.agentId,
      token,
      stdin: await input.readStdin(),
      fetch: input.fetch,
    });
  } catch {
    return null;
  }
}
