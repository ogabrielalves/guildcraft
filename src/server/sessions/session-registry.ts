import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { WaitingReason } from '../../shared/agent.js';

export const SESSIONS_DIR = 'sessions';
export const MAX_SESSION_FILE_BYTES = 64 * 1024;

export type SessionState = 'busy' | 'idle' | 'waiting';

export interface SessionEntry {
  pid: number;
  sessionId: string;
  state: SessionState | null;
  waitingFor: WaitingReason | null;
  statusAt: number | null;
}

type Fields = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function sessionState(raw: string | null): SessionState | null {
  switch (raw) {
    case 'busy':
    case 'waiting':
      return raw;
    case 'idle':
    case 'shell':
      return 'idle';
    default:
      return null;
  }
}

export function waitingReason(raw: string | null): WaitingReason {
  const value = raw?.toLowerCase() ?? '';
  if (value === 'input needed') return 'question';
  if (value === 'dialog open') return 'dialog';
  if (value.includes('trust')) return 'trust';
  if (/permission|approv|allow|request/.test(value)) return 'permission';
  return 'other';
}

export function parseSessionEntry(json: string): SessionEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const fields = raw as Fields;
  const pid = finite(fields.pid);
  const sessionId = text(fields.sessionId);
  if (pid === null || sessionId === null) return null;
  const state = sessionState(text(fields.status));
  return {
    pid,
    sessionId,
    state,
    waitingFor: state === 'waiting' ? waitingReason(text(fields.waitingFor)) : null,
    statusAt: finite(fields.statusUpdatedAt) ?? finite(fields.updatedAt),
  };
}

export function claudeConfigDir(env: Record<string, string | undefined>, home: string): string {
  return text(env.CLAUDE_CONFIG_DIR) ?? join(home, '.claude');
}

export interface SessionReaderDeps {
  readdir: (dir: string) => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
}

const defaultDeps: SessionReaderDeps = {
  readdir: (dir) => readdir(dir),
  readFile: async (path) => {
    const data = await readFile(path);
    return data.length > MAX_SESSION_FILE_BYTES ? '' : data.toString('utf8');
  },
};

export class SessionRegistry {
  private readonly dir: string;

  constructor(
    configDir: string = claudeConfigDir(process.env, homedir()),
    private readonly deps: SessionReaderDeps = defaultDeps,
  ) {
    this.dir = join(configDir, SESSIONS_DIR);
  }

  async read(): Promise<SessionEntry[]> {
    let names: string[];
    try {
      names = await this.deps.readdir(this.dir);
    } catch {
      return [];
    }
    const files = names.filter((name) => /^\d+\.json$/.test(name));
    const entries = await Promise.all(
      files.map(async (name) => {
        try {
          return parseSessionEntry(await this.deps.readFile(join(this.dir, name)));
        } catch {
          return null;
        }
      }),
    );
    return entries.filter((entry): entry is SessionEntry => entry !== null);
  }
}
