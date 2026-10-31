import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isDirectory } from './fs.js';

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
