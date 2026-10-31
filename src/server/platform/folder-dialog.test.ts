import { describe, expect, it, vi } from 'vitest';
import type { RunCommand } from './folder-dialog.js';
import { dialogCommands, parseSelection, pickFolder } from './folder-dialog.js';

const missing = () => Object.assign(new Error('spawn'), { code: 'ENOENT' });

describe('dialogCommands', () => {
  it('uses the windows folder dialog and hands the start folder over the environment', () => {
    const [command] = dialogCommands('win32', 'C:\\Users\\me');
    expect(command?.file).toBe('powershell.exe');
    expect(command?.args).toContain('-STA');
    expect(command?.env).toEqual({ GUILDCRAFT_START: 'C:\\Users\\me' });
    expect(dialogCommands('win32', null)[0]?.env).toEqual({});
  });

  it('uses osascript on macos with the start folder as argument', () => {
    const [command] = dialogCommands('darwin', '/Users/me');
    expect(command?.file).toBe('osascript');
    expect(command?.args.at(-1)).toBe('/Users/me');
    expect(dialogCommands('darwin', null)[0]?.args.at(-1)).toContain('end run');
  });

  it('tries zenity then kdialog elsewhere', () => {
    const commands = dialogCommands('linux', '/home/me');
    expect(commands.map((command) => command.file)).toEqual(['zenity', 'kdialog']);
    expect(commands[0]?.args).toContain('--filename=/home/me/');
    expect(dialogCommands('linux', null)[0]?.args).toEqual(['--file-selection', '--directory']);
  });
});

describe('parseSelection', () => {
  it.each([
    ['/home/me/code\n', '/home/me/code'],
    ['/Users/me/code/\n', '/Users/me/code'],
    ['C:\\Users\\me\r\n', 'C:\\Users\\me'],
    ['C:\\', 'C:\\'],
    ['/', '/'],
    ['  \n', null],
    ['', null],
  ])('reads %j', (output, expected) => {
    expect(parseSelection(output)).toBe(expected);
  });
});

describe('pickFolder', () => {
  it('returns the chosen folder', async () => {
    const run = vi.fn<RunCommand>(() => Promise.resolve('/home/me/code\n'));
    await expect(pickFolder('linux', null, run)).resolves.toBe('/home/me/code');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns null when the dialog is cancelled', async () => {
    const run: RunCommand = () =>
      Promise.reject(Object.assign(new Error('cancelled'), { code: 1 }));
    await expect(pickFolder('linux', null, run)).resolves.toBeNull();
    await expect(pickFolder('win32', null, () => Promise.resolve(''))).resolves.toBeNull();
  });

  it('falls back to the next dialog when one is not installed', async () => {
    const run = vi.fn<RunCommand>((command) =>
      command.file === 'zenity' ? Promise.reject(missing()) : Promise.resolve('/srv/app\n'),
    );
    await expect(pickFolder('linux', null, run)).resolves.toBe('/srv/app');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('fails when no dialog is available', async () => {
    await expect(pickFolder('linux', null, () => Promise.reject(missing()))).rejects.toThrow(
      'no native folder dialog',
    );
  });
});
