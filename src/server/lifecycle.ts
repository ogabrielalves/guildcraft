export const GRACE_MS = 8_000;
export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

export interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface LifecycleOptions {
  shutdown: () => Promise<void>;
  exit: (code: number) => void;
  graceMs?: number;
  log?: (message: string) => void;
}

export class Lifecycle {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seenClient = false;
  private stopping = false;
  private readonly graceMs: number;
  private readonly log: (message: string) => void;

  constructor(private readonly options: LifecycleOptions) {
    this.graceMs = options.graceMs ?? GRACE_MS;
    this.log = options.log ?? (() => undefined);
  }

  get isStopping(): boolean {
    return this.stopping;
  }

  clientsChanged(count: number): void {
    if (count > 0) {
      this.seenClient = true;
      this.cancelGrace();
      return;
    }
    if (!this.seenClient || this.stopping || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.stop('the ui closed');
    }, this.graceMs);
  }

  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.cancelGrace();
    this.log(`shutting down: ${reason}`);
    try {
      await this.options.shutdown();
      this.options.exit(0);
    } catch (error) {
      this.log(`shutdown failed: ${String(error)}`);
      this.options.exit(1);
    }
  }

  watchSignals(source: SignalSource): () => void {
    const listeners = SHUTDOWN_SIGNALS.map((signal) => {
      const listener = () => {
        if (this.stopping) this.options.exit(1);
        else void this.stop(signal);
      };
      source.on(signal, listener);
      return [signal, listener] as const;
    });
    return () => {
      for (const [signal, listener] of listeners) source.off(signal, listener);
    };
  }

  private cancelGrace(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
