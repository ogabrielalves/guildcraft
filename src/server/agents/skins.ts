import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SKIN_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

async function entries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function listSkins(charactersDir: string): Promise<string[]> {
  const candidates = (await entries(charactersDir)).filter(
    (entry) => entry.isDirectory() && SKIN_PATTERN.test(entry.name),
  );
  const found = await Promise.all(
    candidates.map((entry) => isFile(join(charactersDir, entry.name, `${entry.name}.json`))),
  );
  return candidates
    .filter((_, index) => found[index])
    .map((entry) => entry.name)
    .sort();
}
