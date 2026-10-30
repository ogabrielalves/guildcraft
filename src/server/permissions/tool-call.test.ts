import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_CALL_AGE_MS,
  SIGNATURE_TEXT_LENGTH,
  callSignature,
  readTailLines,
  scanToolCall,
} from './tool-call.js';

const AT = Date.parse('2026-10-30T10:00:00Z');

function useLine(id: string, name: string, input: unknown, at = AT): string {
  return JSON.stringify({
    timestamp: new Date(at).toISOString(),
    message: { content: [{ type: 'tool_use', id, name, input }] },
  });
}

function resultLine(id: string): string {
  return JSON.stringify({ message: { content: [{ type: 'tool_result', tool_use_id: id }] } });
}

const BASH = callSignature('Bash', { command: 'npm test' });
const query = { toolName: 'Bash', signature: BASH, createdAt: AT, knownId: null };

describe('callSignature', () => {
  it('uses the main field of known tools', () => {
    expect(callSignature('Bash', { command: 'ls', description: 'list' })).toBe(
      callSignature('Bash', { command: 'ls' }),
    );
    expect(callSignature('Edit', { file_path: '/a', old_string: 'x' })).toBe(
      callSignature('Edit', { file_path: '/a', old_string: 'y' }),
    );
  });

  it('uses every string field of other tools, in key order', () => {
    expect(callSignature('mcp__x__y', { b: '2', a: '1', n: 3 })).toBe(
      callSignature('mcp__x__y', { a: '1', b: '2' }),
    );
    expect(callSignature('mcp__x__y', null)).toBe(callSignature('mcp__x__y', {}));
  });

  it('cuts long texts so slim hook payloads still match', () => {
    const long = 'x'.repeat(SIGNATURE_TEXT_LENGTH * 3);
    expect(callSignature('Bash', { command: long })).toBe(
      callSignature('Bash', { command: long.slice(0, SIGNATURE_TEXT_LENGTH) }),
    );
  });
});

describe('scanToolCall', () => {
  it('finds the open call and then its result', () => {
    const lines = [useLine('t1', 'Bash', { command: 'npm test' })];
    expect(scanToolCall(lines, query)).toEqual({ toolUseId: 't1', answered: false });
    lines.push(resultLine('t1'));
    expect(scanToolCall(lines, { ...query, knownId: 't1' })).toEqual({
      toolUseId: 't1',
      answered: true,
    });
  });

  it('skips answered calls, other tools and noise', () => {
    const lines = [
      'not json "tool_use"',
      '{"message":{"content":"text"}} "tool_use"',
      '{"type":"user"}',
      useLine('old', 'Bash', { command: 'npm test' }),
      resultLine('old'),
      useLine('other', 'Bash', { command: 'ls' }),
      useLine('read', 'Read', { file_path: '/a' }),
    ];
    expect(scanToolCall(lines, query)).toEqual({ toolUseId: null, answered: false });
  });

  it('ignores calls from long before the request', () => {
    const lines = [useLine('t1', 'Bash', { command: 'npm test' }, AT - MAX_CALL_AGE_MS - 1)];
    expect(scanToolCall(lines, query)).toEqual({ toolUseId: null, answered: false });
  });
});

describe('readTailLines', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'guildcraft-tail-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads the tail and drops the cut first line', async () => {
    const path = join(root, 't.jsonl');
    await writeFile(path, 'first line\nsecond\nthird');
    await expect(readTailLines(path, 1_000)).resolves.toEqual(['first line', 'second', 'third']);
    await expect(readTailLines(path, 12)).resolves.toEqual(['third']);
  });

  it('handles an empty file', async () => {
    const path = join(root, 'e.jsonl');
    await writeFile(path, '');
    await expect(readTailLines(path)).resolves.toEqual([]);
  });
});
