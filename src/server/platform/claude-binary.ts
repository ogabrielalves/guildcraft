import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import type { Env } from '../config.js';
import { systemTool } from './system-tool.js';

export interface ClaudeCommand {
  command: string;
  args: string[];
}

export interface ResolveOptions {
  override: string | null;
  platform: NodeJS.Platform;
  env: Env;
  home: string;
  exists: (path: string) => boolean;
}

const WINDOWS_NAMES = ['claude.exe', 'claude.cmd'];

function toCommand(path: string, { platform, env }: ResolveOptions): ClaudeCommand {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
    return { command: systemTool(env, 'cmd.exe'), args: ['/d', '/s', '/c', path] };
  }
  return { command: path, args: [] };
}

function searchDirs({ platform, env, home }: ResolveOptions): string[] {
  const isWindows = platform === 'win32';
  const rawPath = (isWindows ? (env.Path ?? env.PATH) : env.PATH) ?? '';
  const path = isWindows ? win32 : posix;
  const dirs = rawPath.split(isWindows ? ';' : ':').filter((dir) => path.isAbsolute(dir));
  return [...dirs, path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local')];
}

export function resolveClaudeBinary(options: ResolveOptions): ClaudeCommand | null {
  const { override, platform, exists } = options;
  if (override) return exists(override) ? toCommand(override, options) : null;

  const path = platform === 'win32' ? win32 : posix;
  const names = platform === 'win32' ? WINDOWS_NAMES : ['claude'];
  for (const dir of searchDirs(options)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return toCommand(candidate, options);
    }
  }
  return null;
}

export function findClaudeBinary(override: string | null): ClaudeCommand | null {
  return resolveClaudeBinary({
    override,
    platform: process.platform,
    env: process.env,
    home: homedir(),
    exists: existsSync,
  });
}
