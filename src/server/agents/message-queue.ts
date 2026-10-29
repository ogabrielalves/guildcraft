import { MAX_QUEUED } from '../../shared/constants.js';
import type { ErrorCode } from '../../shared/errors.js';

export const SUBMIT_DELAY_MS = 120;

export interface QueuedMessage {
  fromId: string | null;
  text: string;
}

export type EnqueueResult = { ok: true; size: number } | { ok: false; code: ErrorCode };

export interface QueueOptions {
  submitDelayMs?: number;
  limit?: number;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

export function sanitizePrompt(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
}

export function bracketedPaste(text: string): string {
  return `${PASTE_START}${sanitizePrompt(text)}${PASTE_END}`;
}

export class MessageQueue {
  private readonly items: QueuedMessage[] = [];
  private readonly submitDelayMs: number;
  private readonly limit: number;
  private readonly schedule: (callback: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private pendingSubmit: unknown = null;

  constructor(
    private readonly write: (data: string) => void,
    options: QueueOptions = {},
  ) {
    this.submitDelayMs = options.submitDelayMs ?? SUBMIT_DELAY_MS;
    this.limit = options.limit ?? MAX_QUEUED;
    this.schedule = options.schedule ?? setTimeout;
    this.cancel =
      options.cancel ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
  }

  get size(): number {
    return this.items.length;
  }

  get isFull(): boolean {
    return this.items.length >= this.limit;
  }

  enqueue(message: QueuedMessage): EnqueueResult {
    if (sanitizePrompt(message.text).trim() === '') return { ok: false, code: 'EMPTY_PROMPT' };
    if (this.isFull) return { ok: false, code: 'QUEUE_FULL' };
    this.items.push(message);
    return { ok: true, size: this.items.length };
  }

  deliverNext(): QueuedMessage | null {
    const next = this.items.shift();
    if (!next) return null;
    this.write(bracketedPaste(next.text));
    this.pendingSubmit = this.schedule(() => {
      this.pendingSubmit = null;
      this.write('\r');
    }, this.submitDelayMs);
    return next;
  }

  clear(): void {
    this.items.length = 0;
    if (this.pendingSubmit !== null) {
      this.cancel(this.pendingSubmit);
      this.pendingSubmit = null;
    }
  }
}
