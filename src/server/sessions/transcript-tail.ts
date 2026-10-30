import { open } from 'node:fs/promises';

export const INITIAL_TAIL_BYTES = 512 * 1024;
export const MAX_READ_BYTES = 1024 * 1024;

export interface TailFile {
  size: () => Promise<number>;
  read: (start: number, length: number) => Promise<Buffer>;
  close: () => Promise<void>;
}

export type OpenTail = (path: string) => Promise<TailFile>;

export const openTailFile: OpenTail = async (path) => {
  const handle = await open(path, 'r');
  return {
    size: async () => (await handle.stat()).size,
    read: async (start, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    },
    close: () => handle.close(),
  };
};

export interface TailRead {
  lines: string[];
  reset: boolean;
}

export class TranscriptTail {
  private offset: number | null = null;
  private partial = Buffer.alloc(0);
  private dropFirst = false;

  constructor(
    readonly path: string,
    private readonly openFile: OpenTail = openTailFile,
  ) {}

  async read(): Promise<TailRead> {
    const file = await this.openFile(this.path);
    try {
      const size = await file.size();
      let reset = false;
      if (this.offset === null || size < this.offset) {
        reset = this.offset !== null;
        this.offset = Math.max(0, size - INITIAL_TAIL_BYTES);
        this.partial = Buffer.alloc(0);
        this.dropFirst = this.offset > 0;
      } else if (size - this.offset > MAX_READ_BYTES) {
        this.offset = size - MAX_READ_BYTES;
        this.partial = Buffer.alloc(0);
        this.dropFirst = true;
      }
      if (size === this.offset) return { lines: [], reset };
      const chunk = await file.read(this.offset, size - this.offset);
      this.offset += chunk.length;
      const data = Buffer.concat([this.partial, chunk]);
      const end = data.lastIndexOf(0x0a);
      this.partial = end === -1 ? data : data.subarray(end + 1);
      const lines = end === -1 ? [] : data.subarray(0, end).toString('utf8').split('\n');
      if (this.dropFirst && end !== -1) {
        lines.shift();
        this.dropFirst = false;
      }
      if (this.partial.length > MAX_READ_BYTES) {
        this.partial = Buffer.alloc(0);
        this.dropFirst = true;
      }
      return { lines: lines.filter((line) => line.trim() !== ''), reset };
    } finally {
      await file.close();
    }
  }
}
