import { describe, expect, it, vi } from 'vitest';
import type { PtyLike, PtyOptions } from './agent-process.js';
import { DEFAULT_TERM_COLS, DEFAULT_TERM_ROWS } from '../../shared/constants.js';
import { AgentProcess } from './agent-process.js';

class FakePty implements PtyLike {
  readonly pid = 4242;
  readonly written: string[] = [];
  size: [number, number] | null = null;
  private dataListener: ((data: string) => void) | null = null;
  private exitListener: ((event: { exitCode: number }) => void) | null = null;

  onData(listener: (data: string) => void) {
    this.dataListener = listener;
    return { dispose: () => (this.dataListener = null) };
  }

  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListener = listener;
    return { dispose: () => (this.exitListener = null) };
  }

  write(data: string) {
    this.written.push(data);
  }

  resize(cols: number, rows: number) {
    this.size = [cols, rows];
  }

  kill = vi.fn();

  emit(data: string) {
    this.dataListener?.(data);
  }

  exit(exitCode: number) {
    this.exitListener?.({ exitCode });
  }
}

const OPTIONS = { command: 'agent', args: ['--x'], cwd: '/repo', env: { A: '1' } };

function setup(options: Partial<typeof OPTIONS> & { cols?: number; rows?: number } = {}) {
  const ptys: FakePty[] = [];
  const calls: [string, string[], PtyOptions][] = [];
  const kill = vi.fn(() => Promise.resolve());
  const process = new AgentProcess(
    { ...OPTIONS, ...options },
    {
      spawn: (file, args, ptyOptions) => {
        calls.push([file, args, ptyOptions]);
        const pty = new FakePty();
        ptys.push(pty);
        return pty;
      },
      kill,
    },
  );
  const pty = () => {
    const last = ptys.at(-1);
    if (!last) throw new Error('not started');
    return last;
  };
  return { process, pty, calls, kill };
}

describe('AgentProcess', () => {
  it('spawns the command in a pty with the default size', () => {
    const { process, calls } = setup();
    process.start();
    expect(calls).toEqual([
      [
        'agent',
        ['--x'],
        {
          name: 'xterm-256color',
          cwd: '/repo',
          env: { A: '1' },
          cols: DEFAULT_TERM_COLS,
          rows: DEFAULT_TERM_ROWS,
        },
      ],
    ]);
    expect(process.running).toBe(true);
    expect(process.pid).toBe(4242);
  });

  it('refuses to start twice', () => {
    const { process } = setup();
    process.start();
    expect(() => {
      process.start();
    }).toThrow('already running');
  });

  it('streams output and keeps a screen snapshot', async () => {
    const { process, pty } = setup({ cols: 20, rows: 5 });
    const output: string[] = [];
    process.onOutput((data) => output.push(data));
    process.start();
    pty().emit('hello\r\n');
    pty().emit('\x1b[31mred\x1b[0m');
    expect(output).toEqual(['hello\r\n', '\x1b[31mred\x1b[0m']);
    const snapshot = await process.snapshot();
    expect(snapshot).toContain('hello');
    expect(snapshot).toContain('red');
  });

  it('returns an empty snapshot before starting', async () => {
    await expect(setup().process.snapshot()).resolves.toBe('');
  });

  it('forwards input and resizes', () => {
    const { process, pty } = setup();
    process.start();
    process.write('ls\r');
    process.resize(100, 30);
    expect(pty().written).toEqual(['ls\r']);
    expect(pty().size).toEqual([100, 30]);
  });

  it('keeps the new size for the next start', () => {
    const { process, calls } = setup();
    process.resize(90, 20);
    process.start();
    expect(calls[0]?.[2]).toMatchObject({ cols: 90, rows: 20 });
  });

  it('ignores input while stopped', () => {
    const { process } = setup();
    expect(() => {
      process.write('x');
    }).not.toThrow();
  });

  it('notifies exit and can restart with a fresh screen', async () => {
    const { process, pty, calls } = setup();
    const exits: number[] = [];
    process.onExit((code) => exits.push(code));
    process.start();
    pty().emit('old output');
    pty().exit(3);
    expect(exits).toEqual([3]);
    expect(process.running).toBe(false);
    expect(process.pid).toBeNull();
    expect(await process.snapshot()).toContain('old output');

    process.start();
    expect(calls).toHaveLength(2);
    expect(await process.snapshot()).not.toContain('old output');
  });

  it('unsubscribes listeners', () => {
    const { process, pty } = setup();
    const listener = vi.fn();
    const off = process.onOutput(listener);
    off();
    process.start();
    pty().emit('x');
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not emit exit when stopped on request', async () => {
    const { process, pty } = setup();
    const onExit = vi.fn();
    process.onExit(onExit);
    process.start();
    const started = pty();
    await process.stop();
    started.exit(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(process.running).toBe(false);
  });

  it('kills the process tree and then releases the pty', async () => {
    const { process, pty, kill } = setup();
    process.start();
    const started = pty();
    const order: string[] = [];
    kill.mockImplementation(() => {
      order.push('tree');
      return Promise.resolve();
    });
    started.kill.mockImplementation(() => order.push('pty'));
    await process.stop();
    expect(kill).toHaveBeenCalledWith(4242);
    expect(order).toEqual(['tree', 'pty']);
  });

  it('stops even if the pty was already gone', async () => {
    const { process, pty } = setup();
    process.start();
    pty().kill.mockImplementation(() => {
      throw new Error('already exited');
    });
    await expect(process.stop()).resolves.toBeUndefined();
  });

  it('keeps notifying listeners after one throws', () => {
    const { process, pty } = setup();
    const after = vi.fn();
    const exits = vi.fn();
    process.onOutput(() => {
      throw new Error('boom');
    });
    process.onOutput(after);
    process.onExit(() => {
      throw new Error('boom');
    });
    process.onExit(exits);
    process.start();
    pty().emit('x');
    pty().exit(0);
    expect(after).toHaveBeenCalledWith('x');
    expect(exits).toHaveBeenCalledWith(0);
  });

  it('does nothing when stopping a stopped process', async () => {
    const { process, kill } = setup();
    await process.stop();
    expect(kill).not.toHaveBeenCalled();
  });

  it('releases the terminal on dispose', async () => {
    const { process, pty } = setup();
    process.start();
    pty().emit('x');
    process.dispose();
    await expect(process.snapshot()).resolves.toBe('');
  });

  it('uses the real pty and tree kill by default', async () => {
    const process = new AgentProcess(OPTIONS);
    expect(process.running).toBe(false);
    await expect(process.stop()).resolves.toBeUndefined();
  });
});
