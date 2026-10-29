import { MAX_QUEUED } from '../../shared/constants.js';
import type { ErrorCode } from '../../shared/errors.js';

export const SUBMIT_DELAY_MS = 120;
export const SUBMIT_RETRY_MS = 2_000;
export const MAX_SUBMIT_RETRIES = 2;

export interface QueuedMessage {
  fromId: string | null;
  text: string;
}

export type EnqueueResult = { ok: true; size: number } | { ok: false; code: ErrorCode };

export interface QueueOptions {
  submitDelayMs?: number;
  submitRetryMs?: number;
  limit?: number;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  isPending?: (text: string) => Promise<boolean>;
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
  private readonly submitRetryMs: number;
  private readonly limit: number;
  private readonly schedule: (callback: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly isPending: (text: string) => Promise<boolean>;
  private pendingSubmit: unknown = null;
  private round = 0;

  constructor(
    private readonly write: (data: string) => void,
    options: QueueOptions = {},
  ) {
    this.submitDelayMs = options.submitDelayMs ?? SUBMIT_DELAY_MS;
    this.submitRetryMs = options.submitRetryMs ?? SUBMIT_RETRY_MS;
    this.limit = options.limit ?? MAX_QUEUED;
    this.schedule = options.schedule ?? setTimeout;
    this.cancel =
      options.cancel ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
    this.isPending = options.isPending ?? (() => Promise.resolve(false));
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
    if (message.fromId === null) {
      const lastUser = this.items.findLastIndex((item) => item.fromId === null);
      this.items.splice(lastUser + 1, 0, message);
    } else {
      this.items.push(message);
    }
    return { ok: true, size: this.items.length };
  }

  deliverNext(): QueuedMessage | null {
    const next = this.items.shift();
    if (!next) return null;
    this.confirmSubmit();
    this.write(bracketedPaste(next.text));
    this.scheduleSubmit(next.text, this.submitDelayMs, MAX_SUBMIT_RETRIES, false);
    return next;
  }

  confirmSubmit(): void {
    this.round += 1;
    if (this.pendingSubmit === null) return;
    this.cancel(this.pendingSubmit);
    this.pendingSubmit = null;
  }

  clear(): void {
    this.items.length = 0;
    this.confirmSubmit();
  }

  private scheduleSubmit(text: string, ms: number, retries: number, isRetry: boolean): void {
    const round = this.round;
    this.pendingSubmit = this.schedule(() => {
      this.pendingSubmit = null;
      void this.submit(text, round, retries, isRetry);
    }, ms);
  }

  private async submit(text: string, round: number, retries: number, isRetry: boolean) {
    if (isRetry && !(await this.isPending(text).catch(() => false))) return;
    if (round !== this.round) return;
    this.write('\r');
    if (retries > 0) this.scheduleSubmit(text, this.submitRetryMs, retries - 1, true);
  }
}
