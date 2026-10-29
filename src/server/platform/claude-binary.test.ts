import { describe, expect, it } from 'vitest';
import { win32 } from 'node:path';
import type { ResolveOptions } from './claude-binary.js';
import { findClaudeBinary, resolveClaudeBinary } from './claude-binary.js';

const WIN_HOME = String.raw`C:\Users\u`;

function options(overrides: Partial<ResolveOptions> & { files: string[] }): ResolveOptions {
  const { files, ...rest } = overrides;
  return {
    override: null,
    platform: 'linux',
    env: {},
    home: '/home/u',
    exists: (path) => files.includes(path),
    ...rest,
  };
}

describe('resolveClaudeBinary', () => {
  it('finds claude on the unix PATH', () => {
    const result = resolveClaudeBinary(
      options({ env: { PATH: '/usr/bin:/opt/claude' }, files: ['/opt/claude/claude'] }),
    );
    expect(result).toEqual({ command: '/opt/claude/claude', args: [] });
  });

  it('falls back to the native installer location', () => {
    const result = resolveClaudeBinary(options({ files: ['/home/u/.local/bin/claude'] }));
    expect(result).toEqual({ command: '/home/u/.local/bin/claude', args: [] });
  });

  it('falls back to the legacy local install', () => {
    const result = resolveClaudeBinary(options({ files: ['/home/u/.claude/local/claude'] }));
    expect(result?.command).toBe('/home/u/.claude/local/claude');
  });

  it('prefers claude.exe on windows', () => {
    const dir = String.raw`C:\tools`;
    const result = resolveClaudeBinary(
      options({
        platform: 'win32',
        home: WIN_HOME,
        env: { Path: dir },
        files: [win32.join(dir, 'claude.exe'), win32.join(dir, 'claude.cmd')],
      }),
    );
    expect(result).toEqual({ command: win32.join(dir, 'claude.exe'), args: [] });
  });

  it('wraps claude.cmd with cmd.exe', () => {
    const dir = String.raw`C:\npm`;
    const result = resolveClaudeBinary(
      options({
        platform: 'win32',
        home: WIN_HOME,
        env: { PATH: dir, SystemRoot: String.raw`D:\Win` },
        files: [win32.join(dir, 'claude.cmd')],
      }),
    );
    expect(result).toEqual({
      command: String.raw`D:\Win\System32\cmd.exe`,
      args: ['/d', '/s', '/c', win32.join(dir, 'claude.cmd')],
    });
  });

  it('checks the windows native installer location', () => {
    const exe = String.raw`C:\Users\u\.local\bin\claude.exe`;
    const result = resolveClaudeBinary(
      options({ platform: 'win32', home: WIN_HOME, files: [exe] }),
    );
    expect(result?.command).toBe(exe);
  });

  it('uses an existing override', () => {
    const result = resolveClaudeBinary(options({ override: '/x/claude', files: ['/x/claude'] }));
    expect(result).toEqual({ command: '/x/claude', args: [] });
  });

  it('wraps a .bat override on windows', () => {
    const bat = String.raw`D:\c.bat`;
    const result = resolveClaudeBinary(
      options({ override: bat, platform: 'win32', home: WIN_HOME, files: [bat] }),
    );
    expect(result?.command).toBe(String.raw`C:\Windows\System32\cmd.exe`);
  });

  it.each([
    ['windows', 'win32', String.raw`.;tools;C:\bin`, String.raw`C:\bin\claude.exe`],
    ['unix', 'linux', '.:bin:/usr/bin', '/usr/bin/claude'],
  ] as const)('skips relative %s PATH entries', (_, platform, path, installed) => {
    const planted =
      platform === 'win32'
        ? ['claude.exe', String.raw`tools\claude.exe`]
        : ['claude', 'bin/claude'];
    const result = resolveClaudeBinary(
      options({ platform, home: WIN_HOME, env: { PATH: path }, files: [...planted, installed] }),
    );
    expect(result?.command).toBe(installed);
  });

  it('rejects a missing override even when claude is on PATH', () => {
    const result = resolveClaudeBinary(
      options({ override: '/nope', env: { PATH: '/bin' }, files: ['/bin/claude'] }),
    );
    expect(result).toBeNull();
  });

  it('returns null when nothing is installed', () => {
    expect(resolveClaudeBinary(options({ env: { PATH: '/bin' }, files: [] }))).toBeNull();
  });
});

describe('findClaudeBinary', () => {
  it('returns null for a missing override on the real machine', () => {
    expect(findClaudeBinary('/definitely/not/here/claude')).toBeNull();
  });
});
