import treeKill from 'tree-kill';

export function killTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  return new Promise((resolve) => {
    treeKill(pid, signal, () => {
      resolve();
    });
  });
}
