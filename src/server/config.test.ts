import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT } from '../shared/constants.js';
import { HELP, dataDirFor, defaultDataDir, parseConfig } from './config.js';

const DATA = '/data/guildcraft';
const WIN_HOME = String.raw`C:\Users\u`;
const WIN_APPDATA = String.raw`C:\Users\u\AppData\Roaming`;
const WIN_DIR = String.raw`C:\Users\u\AppData\Roaming\guildcraft`;

describe('parseConfig', () => {
  it('uses defaults', () => {
    expect(parseConfig([], {}, DATA)).toEqual({
      kind: 'run',
      config: { port: DEFAULT_PORT, open: true, claudeBin: null, dataDir: DATA },
    });
  });

  it('reads every flag', () => {
    const argv = ['-p', '8080', '--no-open', '--claude-bin', '/bin/c'];
    expect(parseConfig([...argv, '--data-dir', '/d'], {}, DATA)).toEqual({
      kind: 'run',
      config: { port: 8080, open: false, claudeBin: '/bin/c', dataDir: '/d' },
    });
  });

  it('falls back to environment variables', () => {
    const env = {
      GUILDCRAFT_PORT: '9000',
      GUILDCRAFT_CLAUDE_BIN: '/env/claude',
      GUILDCRAFT_DATA_DIR: '/env/data',
    };
    expect(parseConfig([], env, DATA)).toMatchObject({
      config: { port: 9000, claudeBin: '/env/claude', dataDir: '/env/data' },
    });
  });

  it('prefers flags over environment variables', () => {
    expect(parseConfig(['--port', '1234'], { GUILDCRAFT_PORT: '9000' }, DATA)).toMatchObject({
      config: { port: 1234 },
    });
  });

  it.each([['-h'], ['--help']])('returns help for %s', (flag) => {
    expect(parseConfig([flag], {}, DATA)).toEqual({ kind: 'help' });
  });

  it.each([['-v'], ['--version']])('returns version for %s', (flag) => {
    expect(parseConfig([flag], {}, DATA)).toEqual({ kind: 'version' });
  });

  it.each(['0', '65536', 'abc', '80.5', '-1'])('rejects port %s', (port) => {
    expect(parseConfig([`--port=${port}`], {}, DATA)).toEqual({
      kind: 'error',
      message: `invalid port: ${port}`,
    });
  });

  it('rejects an invalid port from the environment', () => {
    expect(parseConfig([], { GUILDCRAFT_PORT: 'x' }, DATA)).toMatchObject({ kind: 'error' });
  });

  it.each(['--nope', '--keep-alive'])('rejects the unknown option %s', (flag) => {
    expect(parseConfig([flag], {}, DATA)).toMatchObject({ kind: 'error' });
  });
});

describe('help and data dir', () => {
  it('documents every option', () => {
    for (const flag of ['--port', '--no-open', '--claude-bin', '--data-dir']) {
      expect(HELP).toContain(flag);
    }
  });

  it('resolves a guildcraft data dir for this machine', () => {
    expect(defaultDataDir()).toMatch(/guildcraft$/);
  });
});

describe('dataDirFor', () => {
  it.each([
    ['win32', { APPDATA: WIN_APPDATA }, WIN_DIR],
    ['win32', {}, WIN_DIR],
    ['darwin', {}, '/home/u/Library/Application Support/guildcraft'],
    ['linux', {}, '/home/u/.local/share/guildcraft'],
    ['linux', { XDG_DATA_HOME: '/xdg' }, '/xdg/guildcraft'],
  ] as const)('resolves %s %j', (platform, env, expected) => {
    const home = platform === 'win32' ? WIN_HOME : '/home/u';
    expect(dataDirFor(platform, env, home)).toBe(expected);
  });
});
