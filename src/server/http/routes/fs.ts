import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { Router } from 'express';
import { MAX_PATH_LENGTH } from '../../../shared/constants.js';
import type { FsEntry, FsListing } from '../../../shared/fs.js';

export interface FsDeps {
  platform: NodeJS.Platform;
  home: string;
  readDir: (path: string) => Promise<Dirent[]>;
  isDirectory: (path: string) => Promise<boolean>;
}

const DRIVE_LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export function defaultFsDeps(): FsDeps {
  return {
    platform: process.platform,
    home: homedir(),
    readDir: (path) => readdir(path, { withFileTypes: true }),
    isDirectory,
  };
}

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

export async function listRoots(deps: FsDeps): Promise<FsEntry[]> {
  const home: FsEntry = { name: '~', path: deps.home };
  if (deps.platform !== 'win32') return [home, { name: '/', path: '/' }];
  const drives = await Promise.all(
    DRIVE_LETTERS.map(async (letter) => {
      const path = `${letter}:\\`;
      return (await deps.isDirectory(path)) ? { name: `${letter}:`, path } : null;
    }),
  );
  return [home, ...drives.filter((drive): drive is FsEntry => drive !== null)];
}

async function isFolder(dirent: Dirent, path: string, deps: FsDeps): Promise<boolean> {
  if (dirent.isDirectory()) return true;
  return dirent.isSymbolicLink() && deps.isDirectory(path);
}

export async function listDirectory(
  raw: unknown,
  roots: FsEntry[],
  deps: FsDeps,
): Promise<FsListing | null> {
  if (raw === undefined || raw === '') return { path: null, parent: null, entries: [], roots };
  const api = pathApi(deps.platform);
  if (typeof raw !== 'string' || raw.length > MAX_PATH_LENGTH || !api.isAbsolute(raw)) return null;
  const path = api.resolve(raw);
  let dirents: Dirent[];
  try {
    dirents = await deps.readDir(path);
  } catch {
    return null;
  }
  const candidates = dirents.map((dirent) => ({
    dirent,
    entry: { name: dirent.name, path: api.join(path, dirent.name) },
  }));
  const folders = await Promise.all(
    candidates.map(({ dirent, entry }) => isFolder(dirent, entry.path, deps)),
  );
  const entries = candidates
    .filter((_, index) => folders[index])
    .map(({ entry }) => entry)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const parent = api.dirname(path);
  return { path, parent: parent === path ? null : parent, entries, roots };
}

export function fsRouter(deps: FsDeps): Router {
  const router = Router();
  let roots: Promise<FsEntry[]> | null = null;
  router.get('/api/fs', async (req, res) => {
    roots ??= listRoots(deps);
    const listing = await listDirectory(req.query.path, await roots, deps);
    if (listing) res.json(listing);
    else res.status(400).json({ code: 'INVALID_CWD' });
  });
  return router;
}
