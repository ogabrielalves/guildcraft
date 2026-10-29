import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { listSkins } from './skins.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guildcraft-skins-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('lists every character manifest across sources, sorted and unique', async () => {
  await mkdir(join(root, 'lpc'));
  await mkdir(join(root, 'crawler'));
  await mkdir(join(root, 'lpc', 'nested.json'));
  for (const file of ['lpc/oren.json', 'lpc/oren.png', 'lpc/brom.json', 'crawler/mortis.json']) {
    await writeFile(join(root, file), '{}');
  }
  await writeFile(join(root, 'crawler', 'Bad Name.json'), '{}');
  await writeFile(join(root, 'crawler', 'oren.json'), '{}');
  await writeFile(join(root, 'stray.json'), '{}');
  expect(await listSkins(root)).toEqual(['brom', 'mortis', 'oren']);
});

it('returns nothing when the folder is missing', async () => {
  expect(await listSkins(join(root, 'missing'))).toEqual([]);
});

it('lists the bundled crew', async () => {
  const skins = await listSkins(join(process.cwd(), 'assets', 'characters'));
  expect(skins).toEqual(expect.arrayContaining(['aldwin', 'brom', 'oren']));
});
