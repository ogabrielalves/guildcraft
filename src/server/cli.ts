import type { Config, Env } from './config.js';
import { HELP, parseConfig } from './config.js';
import type { RunningServer } from './index.js';
import { BootError } from './index.js';

export const MIN_NODE_MAJOR = 20;
export const INSTALL_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup';

export interface CliDeps {
  argv: string[];
  env: Env;
  nodeVersion: string;
  version: string;
  defaultDataDir: string;
  start: (config: Config) => Promise<RunningServer>;
  open: (url: string) => Promise<unknown>;
  out: (text: string) => void;
  err: (text: string) => void;
}

export function nodeMajor(version: string): number {
  return Number(/^v?(\d+)/.exec(version)?.[1] ?? 0);
}

export function bootErrorText(error: BootError, config: Config): string {
  switch (error.code) {
    case 'CLAUDE_NOT_FOUND':
      return [
        'Claude Code was not found.',
        `Install it and sign in (${INSTALL_URL}),`,
        'or point to it with --claude-bin <path> or GUILDCRAFT_CLAUDE_BIN.',
      ].join('\n');
    case 'PORT_IN_USE':
      return `Port ${config.port} is already in use. Pick another one with --port <n>.`;
  }
}

function linkNotice(url: string): string {
  return [
    'Open this link to use Guildcraft:',
    `  ${url}`,
    'It grants control of the agents on this machine. Do not share it.',
  ].join('\n');
}

export async function runCli(deps: CliDeps): Promise<number | null> {
  const parsed = parseConfig(deps.argv, deps.env, deps.defaultDataDir);
  if (parsed.kind === 'help') {
    deps.out(HELP);
    return 0;
  }
  if (parsed.kind === 'version') {
    deps.out(`${deps.version}\n`);
    return 0;
  }
  if (parsed.kind === 'error') {
    deps.err(`guildcraft: ${parsed.message}\nRun guildcraft --help for usage.\n`);
    return 2;
  }
  if (nodeMajor(deps.nodeVersion) < MIN_NODE_MAJOR) {
    deps.err(`Guildcraft needs Node.js ${MIN_NODE_MAJOR} or newer (found ${deps.nodeVersion}).\n`);
    return 1;
  }

  const { config } = parsed;
  let running: RunningServer;
  try {
    running = await deps.start(config);
  } catch (error) {
    if (error instanceof BootError) {
      deps.err(`${bootErrorText(error, config)}\n`);
      return 1;
    }
    throw error;
  }

  deps.out(`Guildcraft ${deps.version} is running on http://127.0.0.1:${running.port}\n`);
  if (!config.open) {
    deps.out(`${linkNotice(running.url)}\n`);
    return null;
  }
  try {
    await deps.open(running.url);
    deps.out('Opened the workshop in your browser. Press Ctrl+C to stop.\n');
  } catch {
    deps.out(`Could not open a browser.\n${linkNotice(running.url)}\n`);
  }
  return null;
}
