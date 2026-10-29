import { spawn as spawnNodePty } from '@lydell/node-pty';
import { SerializeAddon } from '@xterm/addon-serialize';
import headless from '@xterm/headless';
import { DEFAULT_TERM_COLS, DEFAULT_TERM_ROWS } from '../../shared/constants.js';
import { killTree } from '../platform/kill-tree.js';

const { Terminal } = headless;
type HeadlessTerminal = InstanceType<typeof Terminal>;

export const SCROLLBACK = 2000;

interface Disposable {
  dispose(): void;
}

export interface PtyLike {
  readonly pid: number;
  onData(listener: (data: string) => void): Disposable;
  onExit(listener: (event: { exitCode: number }) => void): Disposable;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtyOptions {
  name: string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export type SpawnPty = (file: string, args: string[], options: PtyOptions) => PtyLike;

export interface ProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface ProcessDeps {
  spawn?: SpawnPty;
  kill?: (pid: number) => Promise<void>;
}

type Listener<T> = (value: T) => void;

function notify<T>(listeners: Set<Listener<T>>, value: T): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      continue;
    }
  }
}

export class AgentProcess {
  private pty: PtyLike | null = null;
  private terminal: HeadlessTerminal | null = null;
  private serializer: SerializeAddon | null = null;
  private subscriptions: Disposable[] = [];
  private readonly outputListeners = new Set<Listener<string>>();
  private readonly exitListeners = new Set<Listener<number>>();
  private readonly spawnPty: SpawnPty;
  private readonly kill: (pid: number) => Promise<void>;
  private cols: number;
  private rows: number;

  constructor(
    private readonly options: ProcessOptions,
    deps: ProcessDeps = {},
  ) {
    this.spawnPty = deps.spawn ?? spawnNodePty;
    this.kill = deps.kill ?? killTree;
    this.cols = options.cols ?? DEFAULT_TERM_COLS;
    this.rows = options.rows ?? DEFAULT_TERM_ROWS;
  }

  get running(): boolean {
    return this.pty !== null;
  }

  get pid(): number | null {
    return this.pty?.pid ?? null;
  }

  start(): void {
    if (this.pty) throw new Error('process already running');
    this.terminal?.dispose();
    this.terminal = new Terminal({
      cols: this.cols,
      rows: this.rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);

    const { command, args, cwd, env } = this.options;
    const pty = this.spawnPty(command, args, {
      name: 'xterm-256color',
      cwd,
      env,
      cols: this.cols,
      rows: this.rows,
    });
    this.pty = pty;
    this.subscriptions = [
      pty.onData((data) => {
        this.terminal?.write(data);
        notify(this.outputListeners, data);
      }),
      pty.onExit(({ exitCode }) => {
        this.detach();
        notify(this.exitListeners, exitCode);
      }),
    ];
  }

  write(data: string): void {
    this.pty?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.pty?.resize(cols, rows);
    this.terminal?.resize(cols, rows);
  }

  async snapshot(): Promise<string> {
    const terminal = this.terminal;
    if (!terminal || !this.serializer) return '';
    await new Promise<void>((resolve) => {
      terminal.write('', resolve);
    });
    return this.serializer.serialize();
  }

  onOutput(listener: Listener<string>): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onExit(listener: Listener<number>): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  async stop(): Promise<void> {
    const pty = this.pty;
    if (!pty) return;
    this.detach();
    await this.kill(pty.pid);
    try {
      // releases conpty handles on windows
      pty.kill();
    } catch {
      return;
    }
  }

  dispose(): void {
    this.detach();
    this.terminal?.dispose();
    this.terminal = null;
    this.serializer = null;
    this.outputListeners.clear();
    this.exitListeners.clear();
  }

  private detach(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.subscriptions = [];
    this.pty = null;
  }
}
