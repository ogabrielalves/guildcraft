import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PermissionMode } from '../../shared/agent.js';
import { isPermissionMode } from '../../shared/agent.js';
import { AGENT_ID_PATTERN } from '../../shared/constants.js';

export interface StoredAgent {
  id: string;
  name: string;
  cwd: string;
  skin: string;
  permissionMode: PermissionMode;
}

const FILE_NAME = 'agents.json';
const STRING_FIELDS = ['id', 'name', 'cwd', 'skin'] as const;

function isStoredAgent(value: unknown): value is StoredAgent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    STRING_FIELDS.every((field) => typeof record[field] === 'string' && record[field] !== '') &&
    AGENT_ID_PATTERN.test(record.id as string) &&
    isPermissionMode(record.permissionMode)
  );
}

function pick({ id, name, cwd, skin, permissionMode }: StoredAgent): StoredAgent {
  return { id, name, cwd, skin, permissionMode };
}

export class AgentStore {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  get filePath(): string {
    return join(this.dataDir, FILE_NAME);
  }

  agentDir(id: string): string {
    return join(this.dataDir, 'agents', id);
  }

  async load(): Promise<StoredAgent[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isStoredAgent).map(pick) : [];
    } catch {
      return [];
    }
  }

  save(agents: readonly StoredAgent[]): Promise<void> {
    const content = `${JSON.stringify(agents.map(pick), null, 2)}\n`;
    const task = this.writing.then(() => this.write(content));
    this.writing = task.catch(() => undefined);
    return task;
  }

  private async write(content: string): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, content, 'utf8');
    await rename(temp, this.filePath);
  }
}
