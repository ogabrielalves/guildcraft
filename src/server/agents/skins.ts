import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const MANIFEST = '.json';
const SKIN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

async function entries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function listSkins(charactersDir: string): Promise<string[]> {
  const skins = new Set<string>();
  for (const source of await entries(charactersDir)) {
    if (!source.isDirectory()) continue;
    for (const file of await entries(join(charactersDir, source.name))) {
      if (!file.isFile() || !file.name.endsWith(MANIFEST)) continue;
      const id = file.name.slice(0, -MANIFEST.length);
      if (SKIN_PATTERN.test(id)) skins.add(id);
    }
  }
  return [...skins].sort();
}
