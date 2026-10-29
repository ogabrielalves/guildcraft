export const SUBMIT_DELAY_MS = 120;

export interface QueuedMessage {
  fromId: string | null;
  text: string;
}

export interface QueueOptions {
  submitDelayMs?: number;
  schedule?: (callback: () => void, ms: number) => unknown;
}

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function sanitizePrompt(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
}

export function bracketedPaste(text: string): string {
  return `${PASTE_START}${sanitizePrompt(text)}${PASTE_END}`;
}

export class MessageQueue {
  private readonly items: QueuedMessage[] = [];
  private readonly submitDelayMs: number;
  private readonly schedule: (callback: () => void, ms: number) => unknown;

  constructor(
    private readonly write: (data: string) => void,
    options: QueueOptions = {},
  ) {
    this.submitDelayMs = options.submitDelayMs ?? SUBMIT_DELAY_MS;
    this.schedule = options.schedule ?? setTimeout;
  }

  get size(): number {
    return this.items.length;
  }

  enqueue(message: QueuedMessage): number {
    this.items.push(message);
    return this.items.length;
  }

  deliverNext(): QueuedMessage | null {
    const next = this.items.shift();
    if (!next) return null;
    this.write(bracketedPaste(next.text));
    this.schedule(() => {
      this.write('\r');
    }, this.submitDelayMs);
    return next;
  }

  clear(): void {
    this.items.length = 0;
  }
}
