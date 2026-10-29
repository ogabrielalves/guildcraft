import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_ID_PATTERN, ENV_PREFIX } from '../../shared/constants.js';
import type { HookEvent } from '../hooks/hook-events.js';
import { HOOK_EVENTS, TOOL_HOOK_EVENTS } from '../hooks/hook-events.js';

export const MCP_SERVER_NAME = 'guildcraft';

export interface AgentFilesInput {
  nodePath: string;
  hookScript: string;
  mcpScript: string;
  port: number;
  agentId: string;
}

export interface AgentFilePaths {
  settings: string;
  mcp: string;
}

interface HookCommand {
  type: 'command';
  command: string;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}

const UNSAFE_PATH_CHARS = /["$`%\r\n]/;

export function quotePath(path: string): string {
  if (UNSAFE_PATH_CHARS.test(path)) throw new Error(`unsafe path for a shell command: ${path}`);
  return `"${path.replaceAll('\\', '/')}"`;
}

export function assertSafeInput({ agentId, port }: AgentFilesInput): void {
  if (!AGENT_ID_PATTERN.test(agentId)) throw new Error(`invalid agent id: ${agentId}`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid port: ${port}`);
  }
}

function hookCommand(input: AgentFilesInput, event: HookEvent): string {
  const { nodePath, hookScript, port, agentId } = input;
  return [quotePath(nodePath), quotePath(hookScript), port, agentId, event].join(' ');
}

export function buildSettings(input: AgentFilesInput): { hooks: Record<HookEvent, HookMatcher[]> } {
  assertSafeInput(input);
  const entries = HOOK_EVENTS.map((event): [HookEvent, HookMatcher[]] => {
    const hooks: HookCommand[] = [{ type: 'command', command: hookCommand(input, event) }];
    return [event, [TOOL_HOOK_EVENTS.includes(event) ? { matcher: '*', hooks } : { hooks }]];
  });
  return { hooks: Object.fromEntries(entries) as Record<HookEvent, HookMatcher[]> };
}

export function buildMcpConfig(input: AgentFilesInput) {
  assertSafeInput(input);
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'stdio',
        command: input.nodePath,
        args: [input.mcpScript],
        env: {
          [`${ENV_PREFIX}PORT`]: String(input.port),
          [`${ENV_PREFIX}AGENT_ID`]: input.agentId,
        },
      },
    },
  };
}

export async function writeAgentFiles(
  dir: string,
  input: AgentFilesInput,
): Promise<AgentFilePaths> {
  await mkdir(dir, { recursive: true });
  const paths = { settings: join(dir, 'settings.json'), mcp: join(dir, 'mcp.json') };
  await writeFile(paths.settings, `${JSON.stringify(buildSettings(input), null, 2)}\n`, 'utf8');
  await writeFile(paths.mcp, `${JSON.stringify(buildMcpConfig(input), null, 2)}\n`, 'utf8');
  return paths;
}
