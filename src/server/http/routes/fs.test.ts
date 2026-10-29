import type { Dirent } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PATH_LENGTH } from '../../../shared/constants.js';
import type { FsDeps } from './fs.js';
import { isDirectory, listDirectory, listRoots } from './fs.js';

type Kind = 'dir' | 'file' | 'link';

function dirent(name: string, kind: Kind = 'dir'): Dirent {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'link',
  } as Dirent;
}

function deps(overrides: Partial<FsDeps> = {}): FsDeps {
  return {
    platform: 'linux',
    home: '/home/u',
    readDir: (path) =>
      path === '/home/u'
        ? Promise.resolve([
            dirent('zeta'),
            dirent('Alpha'),
            dirent('notes.txt', 'file'),
            dirent('linked', 'link'),
            dirent('broken', 'link'),
          ])
        : Promise.reject(new Error('ENOENT')),
    isDirectory: (path) => Promise.resolve(path === '/home/u/linked'),
    ...overrides,
  };
}

const ROOTS = [{ name: '~', path: '/home/u' }];

describe('isDirectory', () => {
  it('tells directories from files and missing paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'guildcraft-fs-'));
    await writeFile(join(root, 'file.txt'), 'x');
    await expect(isDirectory(root)).resolves.toBe(true);
    await expect(isDirectory(join(root, 'file.txt'))).resolves.toBe(false);
    await expect(isDirectory(join(root, 'missing'))).resolves.toBe(false);
    await rm(root, { recursive: true, force: true });
  });
});

describe('listRoots', () => {
  it('offers home and / on unix', async () => {
    await expect(listRoots(deps())).resolves.toEqual([
      { name: '~', path: '/home/u' },
      { name: '/', path: '/' },
    ]);
  });

  it('offers home and existing drives on windows', async () => {
    const roots = await listRoots(
      deps({
        platform: 'win32',
        home: 'C:\\Users\\u',
        isDirectory: (path) => Promise.resolve(path === 'C:\\' || path === 'D:\\'),
      }),
    );
    expect(roots).toEqual([
      { name: '~', path: 'C:\\Users\\u' },
      { name: 'C:', path: 'C:\\' },
      { name: 'D:', path: 'D:\\' },
    ]);
  });
});

describe('listDirectory', () => {
  it('lists directories and linked directories, sorted, with the parent', async () => {
    await expect(listDirectory('/home/u/', ROOTS, deps())).resolves.toEqual({
      path: '/home/u',
      parent: '/home',
      entries: [
        { name: 'Alpha', path: '/home/u/Alpha' },
        { name: 'linked', path: '/home/u/linked' },
        { name: 'zeta', path: '/home/u/zeta' },
      ],
      roots: ROOTS,
    });
  });

  it('has no parent at the root', async () => {
    const listing = await listDirectory('/', ROOTS, deps({ readDir: () => Promise.resolve([]) }));
    expect(listing?.parent).toBeNull();
  });

  it('returns only roots without a path', async () => {
    await expect(listDirectory(undefined, ROOTS, deps())).resolves.toEqual({
      path: null,
      parent: null,
      entries: [],
      roots: ROOTS,
    });
    await expect(listDirectory('', ROOTS, deps())).resolves.toMatchObject({ path: null });
  });

  it.each([['relative/path'], [['/a', '/b']], [`/${'x'.repeat(MAX_PATH_LENGTH)}`], ['/missing']])(
    'rejects %j',
    async (raw) => {
      await expect(listDirectory(raw, ROOTS, deps())).resolves.toBeNull();
    },
  );

  it('resolves windows paths', async () => {
    const listing = await listDirectory(
      'C:\\Users\\..\\Users',
      ROOTS,
      deps({ platform: 'win32', readDir: () => Promise.resolve([dirent('u')]) }),
    );
    expect(listing).toMatchObject({
      path: 'C:\\Users',
      parent: 'C:\\',
      entries: [{ name: 'u', path: 'C:\\Users\\u' }],
    });
  });
});
