import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_PORT, ENV_PREFIX } from '../shared/constants.js';

export interface Config {
  port: number;
  open: boolean;
  claudeBin: string | null;
  dataDir: string;
}

export type ConfigResult =
  | { kind: 'run'; config: Config }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

export type Env = Record<string, string | undefined>;

export const HELP = `Usage: npx guildcraft [options]

  -p, --port <n>        port (default ${DEFAULT_PORT}, env ${ENV_PREFIX}PORT)
      --no-open         do not open the browser
      --claude-bin <p>  path to the Claude Code executable (env ${ENV_PREFIX}CLAUDE_BIN)
      --data-dir <p>    data directory (env ${ENV_PREFIX}DATA_DIR)
  -v, --version
  -h, --help
`;

const APP_NAME = 'guildcraft';

export function dataDirFor(platform: NodeJS.Platform, env: Env, home: string): string {
  if (platform === 'win32') {
    return win32.join(env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'), APP_NAME);
  }
  if (platform === 'darwin') {
    return posix.join(home, 'Library', 'Application Support', APP_NAME);
  }
  return posix.join(env.XDG_DATA_HOME ?? posix.join(home, '.local', 'share'), APP_NAME);
}

export function defaultDataDir(): string {
  return dataDirFor(process.platform, process.env, homedir());
}

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

export function parseConfig(argv: string[], env: Env, fallbackDataDir: string): ConfigResult {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowNegative: true,
      options: {
        port: { type: 'string', short: 'p' },
        open: { type: 'boolean', default: true },
        'claude-bin': { type: 'string' },
        'data-dir': { type: 'string' },
        version: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }

  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  const rawPort = values.port ?? env[`${ENV_PREFIX}PORT`] ?? String(DEFAULT_PORT);
  const port = parsePort(rawPort);
  if (port === null) return { kind: 'error', message: `invalid port: ${rawPort}` };

  return {
    kind: 'run',
    config: {
      port,
      open: values.open,
      claudeBin: values['claude-bin'] ?? env[`${ENV_PREFIX}CLAUDE_BIN`] ?? null,
      dataDir: values['data-dir'] ?? env[`${ENV_PREFIX}DATA_DIR`] ?? fallbackDataDir,
    },
  };
}
