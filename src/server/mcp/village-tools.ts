import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MAX_NAME_LENGTH, MAX_PROMPT_LENGTH, TOKEN_HEADER } from '../../shared/constants.js';
import type { ErrorCode } from '../../shared/errors.js';
import { isErrorCode } from '../../shared/errors.js';
import type { SendResult } from '../agents/agent-manager.js';
import type { Villager } from '../http/routes/villagers.js';
import { MCP_SERVER_NAME } from '../agents/agent-files.js';

export const API_TIMEOUT_MS = 5_000;

export type ApiResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode | 'UNREACHABLE' };

export interface VillageApi {
  listVillagers: () => Promise<ApiResult<Villager[]>>;
  sendMessage: (to: string, message: string) => Promise<ApiResult<SendResult>>;
}

export interface ApiOptions {
  port: number;
  agentId: string;
  token: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

export function createVillageApi(options: ApiOptions): VillageApi {
  const base = `http://127.0.0.1:${options.port}/api/${encodeURIComponent(options.agentId)}`;
  async function call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    try {
      const response = await options.fetch(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', [TOKEN_HEADER]: options.token },
        signal: AbortSignal.timeout(options.timeoutMs ?? API_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) return { ok: true, value: body as T };
      const code = (body as { code?: unknown } | null)?.code;
      return { ok: false, code: isErrorCode(code) ? code : 'INVALID_MESSAGE' };
    } catch {
      return { ok: false, code: 'UNREACHABLE' };
    }
  }
  return {
    listVillagers: () => call<Villager[]>('/villagers'),
    sendMessage: (to, message) =>
      call<SendResult>('/messages', { method: 'POST', body: JSON.stringify({ to, message }) }),
  };
}

export function errorText(code: ErrorCode | 'UNREACHABLE', to?: string): string {
  const who = to ?? 'That villager';
  switch (code) {
    case 'AGENT_NOT_FOUND':
      return to
        ? `There is no villager named "${to}". Call list_villagers to see who is around.`
        : 'Guildcraft no longer knows this agent. Restart it from the Guildcraft window.';
    case 'AGENT_OFFLINE':
      return `${who} is offline, so the message was not sent.`;
    case 'QUEUE_FULL':
      return `${who} has too many pending messages. Try again later.`;
    case 'EMPTY_PROMPT':
      return 'The message is empty, so nothing was sent.';
    case 'INVALID_MESSAGE':
      return `The message was rejected. Keep it under ${MAX_PROMPT_LENGTH} characters.`;
    case 'UNAUTHORIZED':
      return 'Guildcraft rejected the session token. Restart this agent from the Guildcraft window.';
    case 'UNREACHABLE':
      return 'Could not reach Guildcraft. It may have been closed.';
    default:
      return `Guildcraft rejected the request (${code}).`;
  }
}

function text(value: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError } : {}) };
}

export function describeVillager(villager: Villager): string {
  const doing = villager.doing ? `, doing ${villager.doing}` : '';
  const queued = villager.queued > 0 ? `, ${villager.queued} queued` : '';
  return `- ${villager.name} (${villager.status}${doing}${queued}) in ${villager.cwd}`;
}

export function sentText(to: string, result: SendResult): string {
  if (!result.busy) return `Message sent to ${to}. They will read it in a moment.`;
  return `${to} is busy. The message is queued (position ${result.queued}) and will be delivered when they finish.`;
}

export function villageInstructions(name: string): string {
  return `You are "${name}", one of several Claude Code agents in a Guildcraft workshop. Call list_villagers to see the others by name, and send_message to hand work to one of them or ask for something.`;
}

export function createVillageServer(api: VillageApi, version: string, name?: string): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version },
    name ? { instructions: villageInstructions(name) } : undefined,
  );
  server.registerTool(
    'list_villagers',
    {
      description:
        'List the other Claude Code agents in this Guildcraft workshop: name, project folder, status and what they are doing.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = await api.listVillagers();
      if (!result.ok) return text(errorText(result.code), true);
      if (result.value.length === 0) return text('No other villagers are in the workshop.');
      return text(result.value.map(describeVillager).join('\n'));
    },
  );
  server.registerTool(
    'send_message',
    {
      description:
        'Send a message to another agent in this Guildcraft workshop. It arrives as a new prompt when they are idle, so make it self-contained.',
      inputSchema: {
        to: z.string().min(1).max(MAX_NAME_LENGTH).describe('Name of the recipient villager.'),
        message: z.string().min(1).max(MAX_PROMPT_LENGTH).describe('The message to deliver.'),
      },
    },
    async ({ to, message }) => {
      const result = await api.sendMessage(to, message);
      return result.ok ? text(sentText(to, result.value)) : text(errorText(result.code, to), true);
    },
  );
  return server;
}
