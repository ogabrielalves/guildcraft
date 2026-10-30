import { open } from 'node:fs/promises';

export const SIGNATURE_TEXT_LENGTH = 1_000;
export const SCAN_TAIL_BYTES = 512 * 1024;
export const MAX_CALL_AGE_MS = 10 * 60_000;

type Fields = Record<string, unknown>;

const MAIN_FIELDS: Record<string, readonly string[]> = {
  Bash: ['command'],
  Read: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  Write: ['file_path'],
  NotebookEdit: ['notebook_path'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  Glob: ['pattern', 'path'],
  Grep: ['pattern', 'path'],
};

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cut(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, SIGNATURE_TEXT_LENGTH) : '';
}

export function callSignature(toolName: string, input: unknown): string {
  const fields = isRecord(input) ? input : {};
  const keys =
    MAIN_FIELDS[toolName] ??
    Object.keys(fields)
      .filter((key) => typeof fields[key] === 'string')
      .sort();
  return JSON.stringify([toolName, ...keys.map((key) => [key, cut(fields[key])])]);
}

export interface CallQuery {
  toolName: string;
  signature: string;
  createdAt: number;
  knownId: string | null;
}

export interface CallScan {
  toolUseId: string | null;
  answered: boolean;
}

function blocksOf(line: string): { at: number; blocks: Fields[] } | null {
  if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.message)) return null;
  const { content } = raw.message;
  if (!Array.isArray(content)) return null;
  const at = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : Number.NaN;
  return { at, blocks: content.filter(isRecord) };
}

export function scanToolCall(lines: readonly string[], query: CallQuery): CallScan {
  const calls: { id: string; at: number }[] = [];
  const results = new Set<string>();
  for (const line of lines) {
    const parsed = blocksOf(line);
    if (!parsed) continue;
    for (const block of parsed.blocks) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        results.add(block.tool_use_id);
      } else if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        query.knownId === null &&
        block.name === query.toolName &&
        callSignature(query.toolName, block.input) === query.signature
      ) {
        calls.push({ id: block.id, at: parsed.at });
      }
    }
  }
  if (query.knownId !== null) {
    return { toolUseId: query.knownId, answered: results.has(query.knownId) };
  }
  for (const call of calls.toReversed()) {
    if (results.has(call.id)) continue;
    if (Number.isFinite(call.at) && call.at < query.createdAt - MAX_CALL_AGE_MS) break;
    return { toolUseId: call.id, answered: false };
  }
  return { toolUseId: null, answered: false };
}

export async function readTailLines(path: string, bytes = SCAN_TAIL_BYTES): Promise<string[]> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - bytes);
    const length = size - start;
    if (length <= 0) return [];
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines;
  } finally {
    await file.close();
  }
}
