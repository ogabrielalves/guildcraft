import { describe, expect, it, vi } from 'vitest';
import type { CliDeps } from './cli.js';
import { INSTALL_URL, nodeMajor, runCli } from './cli.js';
import { HELP } from './config.js';
import type { RunningServer } from './index.js';
import { BootError } from './index.js';

const URL_WITH_TOKEN = 'http://127.0.0.1:7777/?token=secret';

function setup(overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    argv: [],
    env: {},
    nodeVersion: 'v20.19.0',
    version: '1.0.0',
    defaultDataDir: '/data',
    start: vi.fn(() =>
      Promise.resolve({ port: 7777, url: URL_WITH_TOKEN } as unknown as RunningServer),
    ),
    open: vi.fn(() => Promise.resolve()),
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    ...overrides,
  };
  return { deps, out: () => out.join(''), err: () => err.join('') };
}

describe('runCli', () => {
  it('prints help and version', async () => {
    const help = setup({ argv: ['--help'] });
    await expect(runCli(help.deps)).resolves.toBe(0);
    expect(help.out()).toBe(HELP);
    const version = setup({ argv: ['-v'] });
    await expect(runCli(version.deps)).resolves.toBe(0);
    expect(version.out()).toBe('1.0.0\n');
  });

  it('rejects bad options', async () => {
    const { deps, err } = setup({ argv: ['--nope'] });
    await expect(runCli(deps)).resolves.toBe(2);
    expect(err()).toContain('Run guildcraft --help');
    expect(deps.start).not.toHaveBeenCalled();
  });

  it('requires node 20', async () => {
    const { deps, err } = setup({ nodeVersion: 'v18.20.0' });
    await expect(runCli(deps)).resolves.toBe(1);
    expect(err()).toBe('Guildcraft needs Node.js 20 or newer (found v18.20.0).\n');
  });

  it('starts the server and opens the browser without printing the token', async () => {
    const { deps, out } = setup({ argv: ['--port', '7777'] });
    await expect(runCli(deps)).resolves.toBeNull();
    expect(deps.start).toHaveBeenCalledWith(expect.objectContaining({ port: 7777, open: true }));
    expect(deps.open).toHaveBeenCalledWith(URL_WITH_TOKEN);
    expect(out()).not.toContain('secret');
    expect(out()).toContain('running on http://127.0.0.1:7777');
  });

  it('prints the link with a warning when not opening a browser', async () => {
    const { deps, out } = setup({ argv: ['--no-open'] });
    await expect(runCli(deps)).resolves.toBeNull();
    expect(deps.open).not.toHaveBeenCalled();
    expect(out()).toContain(URL_WITH_TOKEN);
    expect(out()).toContain('Do not share it.');
  });

  it('falls back to the link when the browser fails to open', async () => {
    const { deps, out } = setup({ open: () => Promise.reject(new Error('no browser')) });
    await runCli(deps);
    expect(out()).toContain('Could not open a browser.');
    expect(out()).toContain(URL_WITH_TOKEN);
  });

  it('explains a missing claude code', async () => {
    const { deps, err } = setup({
      start: () => Promise.reject(new BootError('CLAUDE_NOT_FOUND', 'x')),
    });
    await expect(runCli(deps)).resolves.toBe(1);
    expect(err()).toContain('Claude Code was not found.');
    expect(err()).toContain(INSTALL_URL);
  });

  it('explains a busy port', async () => {
    const { deps, err } = setup({
      argv: ['-p', '8080'],
      start: () => Promise.reject(new BootError('PORT_IN_USE', 'x')),
    });
    await expect(runCli(deps)).resolves.toBe(1);
    expect(err()).toBe('Port 8080 is already in use. Pick another one with --port <n>.\n');
  });

  it('rethrows unexpected errors', async () => {
    const { deps } = setup({ start: () => Promise.reject(new Error('boom')) });
    await expect(runCli(deps)).rejects.toThrow('boom');
  });
});

describe('nodeMajor', () => {
  it.each([
    ['v20.1.0', 20],
    ['22.0.0', 22],
    ['weird', 0],
  ])('reads %s', (version, major) => {
    expect(nodeMajor(version)).toBe(major);
  });
});
