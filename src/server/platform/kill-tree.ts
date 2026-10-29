import { execFile } from 'node:child_process';
import treeKill from 'tree-kill';
import { systemTool } from './system-tool.js';

export function killTree(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM',
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  return new Promise((resolve) => {
    if (platform === 'win32') {
      const args = ['/pid', String(pid), '/T', '/F'];
      execFile(systemTool(process.env, 'taskkill.exe'), args, { windowsHide: true }, () => {
        resolve();
      });
      return;
    }
    treeKill(pid, signal, () => {
      resolve();
    });
  });
}
