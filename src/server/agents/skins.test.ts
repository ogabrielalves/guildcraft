import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { listSkins } from './skins.js';

let root: string;

async function character(id: string, files: string[]) {
  await mkdir(join(root, id), { recursive: true });
  for (const file of files) await writeFile(join(root, id, file), '{}');
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guildcraft-skins-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('lists every folder that holds a manifest named after it, sorted', async () => {
  await character('oren', ['oren.json', 'oren.lpc.json', 'oren.png']);
  await character('brom', ['brom.json']);
  await character('mortis', ['mortis.json', 'idle.png']);
  expect(await listSkins(root)).toEqual(['brom', 'mortis', 'oren']);
});

it('skips folders without their own manifest and invalid ids', async () => {
  await character('lyra', ['idle.png', 'walk.png']);
  await character('aldwin', ['aldwin.lpc.json', 'other.json']);
  await character('Bad Name', ['Bad Name.json']);
  await character('hollow', []);
  await mkdir(join(root, 'hollow', 'hollow.json'));
  await writeFile(join(root, 'stray.json'), '{}');
  await writeFile(join(root, 'lpc-rows.md'), '');
  expect(await listSkins(root)).toEqual([]);
});

it('returns nothing when the folder is missing', async () => {
  expect(await listSkins(join(root, 'missing'))).toEqual([]);
});

it('lists the bundled crew', async () => {
  const skins = await listSkins(join(process.cwd(), 'assets', 'characters'));
  expect(skins).toEqual(expect.arrayContaining(['aldwin', 'brom', 'mortis', 'oren']));
});
