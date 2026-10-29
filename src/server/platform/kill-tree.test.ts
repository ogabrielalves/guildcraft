import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { killTree } from './kill-tree.js';

const GRANDCHILD = `const g = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(g.pid); setInterval(() => {}, 1000);`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDeath(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe('killTree', () => {
  it('kills a process and its children', async () => {
    const child = spawn(process.execPath, ['-e', GRANDCHILD], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [chunk] = (await once(child.stdout, 'data')) as [Buffer];
    const grandchildPid = Number(chunk.toString().trim());
    const pid = child.pid ?? 0;
    const exited = once(child, 'exit');

    await killTree(pid, 'SIGKILL');
    await exited;

    expect(isAlive(pid)).toBe(false);
    expect(await waitForDeath(grandchildPid)).toBe(true);
  });

  it('resolves for a pid that no longer exists', async () => {
    await expect(killTree(2 ** 22 + 12345)).resolves.toBeUndefined();
  });
});
