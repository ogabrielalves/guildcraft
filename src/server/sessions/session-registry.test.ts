import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SessionRegistry,
  claudeConfigDir,
  parseSessionEntry,
  sessionState,
  waitingReason,
} from './session-registry.js';

describe('parseSessionEntry', () => {
  it('reads pid, session, status and waiting reason', () => {
    expect(
      parseSessionEntry(
        JSON.stringify({
          pid: 13888,
          sessionId: 's1',
          cwd: 'C:\\repo',
          status: 'waiting',
          waitingFor: 'permission request',
          updatedAt: 5,
          statusUpdatedAt: 7,
        }),
      ),
    ).toEqual({
      pid: 13888,
      sessionId: 's1',
      state: 'waiting',
      waitingFor: 'permission',
      statusAt: 7,
    });
  });

  it('falls back to updatedAt and drops the reason when not waiting', () => {
    expect(
      parseSessionEntry('{"pid":1,"sessionId":"s","status":"busy","waitingFor":"x","updatedAt":3}'),
    ).toEqual({ pid: 1, sessionId: 's', state: 'busy', waitingFor: null, statusAt: 3 });
  });

  it('tolerates entries from versions without a status', () => {
    expect(parseSessionEntry('{"pid":1,"sessionId":"s"}')).toEqual({
      pid: 1,
      sessionId: 's',
      state: null,
      waitingFor: null,
      statusAt: null,
    });
  });

  it.each(['', 'nope', '[]', 'null', '{"pid":"1","sessionId":"s"}', '{"pid":1,"sessionId":" "}'])(
    'rejects %j',
    (json) => {
      expect(parseSessionEntry(json)).toBeNull();
    },
  );
});

describe('sessionState', () => {
  it.each([
    ['busy', 'busy'],
    ['waiting', 'waiting'],
    ['idle', 'idle'],
    ['shell', 'idle'],
    ['other', null],
    [null, null],
  ] as const)('maps %s to %s', (raw, state) => {
    expect(sessionState(raw)).toBe(state);
  });
});

describe('waitingReason', () => {
  it.each([
    ['input needed', 'question'],
    ['Dialog open', 'dialog'],
    ['trust this folder', 'trust'],
    ['approve a permission', 'permission'],
    ['worker request', 'permission'],
    ['something else', 'other'],
    [null, 'other'],
  ] as const)('maps %s to %s', (raw, reason) => {
    expect(waitingReason(raw)).toBe(reason);
  });
});

describe('claudeConfigDir', () => {
  it('prefers CLAUDE_CONFIG_DIR and falls back to ~/.claude', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u')).toBe('/cfg');
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: ' ' }, '/home/u')).toBe(join('/home/u', '.claude'));
  });
});

describe('SessionRegistry', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'guildcraft-sessions-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads valid pid files and skips the rest', async () => {
    const dir = join(root, 'sessions');
    await mkdir(dir);
    await writeFile(join(dir, '10.json'), '{"pid":10,"sessionId":"a","status":"idle"}');
    await writeFile(join(dir, '11.json'), 'broken');
    await writeFile(join(dir, '12.abc.key'), 'secret');
    await writeFile(join(dir, '13.json'), 'x'.repeat(70 * 1024));
    await mkdir(join(dir, '14.json'));
    const entries = await new SessionRegistry(root).read();
    expect(entries.map((entry) => entry.sessionId)).toEqual(['a']);
  });

  it('returns nothing when the folder is missing', async () => {
    await expect(new SessionRegistry(root).read()).resolves.toEqual([]);
  });
});
