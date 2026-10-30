import type { AgentManager } from '../agents/agent-manager.js';
import type { SessionEntry } from './session-registry.js';

export const SESSION_POLL_MS = 1_000;

export type MonitorTarget = Pick<
  AgentManager,
  'syncSessions' | 'sweepPermissions' | 'syncActivity'
>;

export interface MonitorDeps {
  manager: MonitorTarget;
  read: () => Promise<SessionEntry[]>;
  log?: (message: string) => void;
  intervalMs?: number;
}

export class SessionMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: MonitorDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.intervalMs ?? SESSION_POLL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  tick(): Promise<void> {
    this.running ??= this.poll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async poll(): Promise<void> {
    try {
      this.deps.manager.syncSessions(await this.deps.read());
      await this.deps.manager.sweepPermissions();
      await this.deps.manager.syncActivity();
    } catch (error) {
      this.deps.log?.(`sessions: poll failed: ${String(error)}`);
    }
  }
}
