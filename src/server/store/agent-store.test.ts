import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredAgent } from './agent-store.js';
import { AgentStore } from './agent-store.js';

const MORTIS: StoredAgent = {
  id: 'a1',
  name: 'Mortis',
  cwd: '/repo/api',
  skin: 'mortis',
  permissionMode: 'acceptEdits',
};

let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guildcraft-store-'));
  dataDir = join(root, 'nested', 'data');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('AgentStore', () => {
  it('returns an empty list when nothing was saved', async () => {
    await expect(new AgentStore(dataDir).load()).resolves.toEqual([]);
  });

  it('round-trips agents and creates the data dir', async () => {
    const store = new AgentStore(dataDir);
    await store.save([MORTIS]);
    await expect(store.load()).resolves.toEqual([MORTIS]);
    expect(await readdir(dataDir)).toEqual(['agents.json']);
  });

  it('writes only known fields', async () => {
    const store = new AgentStore(dataDir);
    await store.save([{ ...MORTIS, extra: 'x' } as StoredAgent]);
    expect(JSON.parse(await readFile(store.filePath, 'utf8'))).toEqual([MORTIS]);
  });

  it('skips invalid entries', async () => {
    const store = new AgentStore(dataDir);
    await store.save([]);
    await writeFile(
      store.filePath,
      JSON.stringify([
        MORTIS,
        { ...MORTIS, name: '' },
        { ...MORTIS, permissionMode: 'x' },
        null,
        3,
      ]),
    );
    await expect(store.load()).resolves.toEqual([MORTIS]);
  });

  it.each([
    ['corrupt json', '{oops'],
    ['a non-array', '{"id":"a1"}'],
  ])('returns an empty list for %s', async (_, content) => {
    const store = new AgentStore(dataDir);
    await store.save([]);
    await writeFile(store.filePath, content);
    await expect(store.load()).resolves.toEqual([]);
  });

  it('places per-agent files under agents/<id>', () => {
    expect(new AgentStore(dataDir).agentDir('a1')).toBe(join(dataDir, 'agents', 'a1'));
  });
});
