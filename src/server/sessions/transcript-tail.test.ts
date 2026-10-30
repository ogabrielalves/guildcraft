import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TailFile } from './transcript-tail.js';
import { INITIAL_TAIL_BYTES, MAX_READ_BYTES, TranscriptTail } from './transcript-tail.js';

function memoryFile(initial = ''): { data: Buffer; open: () => Promise<TailFile> } {
  const state = { data: Buffer.from(initial) };
  return Object.assign(state, {
    open: () =>
      Promise.resolve<TailFile>({
        size: () => Promise.resolve(state.data.length),
        read: (start, length) => Promise.resolve(state.data.subarray(start, start + length)),
        close: () => Promise.resolve(),
      }),
  });
}

describe('TranscriptTail', () => {
  it('reads complete lines and keeps the partial one for later', async () => {
    const file = memoryFile('a\nb\npar');
    const tail = new TranscriptTail('/t.jsonl', file.open);
    expect(await tail.read()).toEqual({ lines: ['a', 'b'], reset: false });
    expect(await tail.read()).toEqual({ lines: [], reset: false });
    file.data = Buffer.from('a\nb\npartial\n\nc\n');
    expect(await tail.read()).toEqual({ lines: ['partial', 'c'], reset: false });
  });

  it('starts near the end of a large file and drops the cut line', async () => {
    const file = memoryFile(`old\n${'c'.repeat(INITIAL_TAIL_BYTES)}\nwhole\n`);
    const tail = new TranscriptTail('/t.jsonl', file.open);
    expect((await tail.read()).lines).toEqual(['whole']);
  });

  it('keeps dropping the cut line until a newline arrives', async () => {
    const file = memoryFile('x'.repeat(INITIAL_TAIL_BYTES + 10));
    const tail = new TranscriptTail('/t.jsonl', file.open);
    expect((await tail.read()).lines).toEqual([]);
    file.data = Buffer.concat([file.data, Buffer.from('end\nnext\n')]);
    expect((await tail.read()).lines).toEqual(['next']);
  });

  it('starts over when the file shrinks', async () => {
    const file = memoryFile('one\ntwo\n');
    const tail = new TranscriptTail('/t.jsonl', file.open);
    await tail.read();
    file.data = Buffer.from('new\n');
    expect(await tail.read()).toEqual({ lines: ['new'], reset: true });
  });

  it('skips ahead when too much was written between reads', async () => {
    const file = memoryFile('first\n');
    const tail = new TranscriptTail('/t.jsonl', file.open);
    await tail.read();
    file.data = Buffer.from(`first\n${'z'.repeat(MAX_READ_BYTES + 5)}\nlast\n`);
    expect((await tail.read()).lines).toEqual(['last']);
  });

  it('drops a line that grows past the read limit', async () => {
    const file = memoryFile('a\n');
    const tail = new TranscriptTail('/t.jsonl', file.open);
    await tail.read();
    file.data = Buffer.from(`a\n${'q'.repeat(MAX_READ_BYTES - 1)}`);
    expect((await tail.read()).lines).toEqual([]);
    file.data = Buffer.concat([file.data, Buffer.from('qqqq')]);
    expect((await tail.read()).lines).toEqual([]);
    file.data = Buffer.concat([file.data, Buffer.from('q\nok\n')]);
    expect((await tail.read()).lines).toEqual(['ok']);
  });

  it('closes the file even when reading fails', async () => {
    const close = vi.fn(() => Promise.resolve());
    const tail = new TranscriptTail('/t.jsonl', () =>
      Promise.resolve({
        size: () => Promise.reject(new Error('gone')),
        read: () => Promise.resolve(Buffer.alloc(0)),
        close,
      }),
    );
    await expect(tail.read()).rejects.toThrow('gone');
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('TranscriptTail on disk', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('reads appended lines from a real file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'gc-tail-'));
    const path = join(dir, 's.jsonl');
    writeFileSync(path, '{"a":1}\n');
    const tail = new TranscriptTail(path);
    expect((await tail.read()).lines).toEqual(['{"a":1}']);
    writeFileSync(path, '{"a":1}\n{"b":2}\n');
    expect((await tail.read()).lines).toEqual(['{"b":2}']);
  });
});
